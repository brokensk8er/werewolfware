import { randomBytes } from 'crypto';
import { GameState, GamePhase, Player, Role, GameMode, AdminLogEntry, LogCategory } from '../types.js';
import { PhaseManager } from './phaseManager.js';
import { WinChecker } from './winChecker.js';

export class GameManager {
  private games: Map<string, GameState> = new Map();
  private phaseManager: PhaseManager;
  private winChecker: WinChecker;

  constructor() {
    this.phaseManager = new PhaseManager();
    this.winChecker = new WinChecker();
  }

  createGame(roomCode: string, hostId: string, gameMode: GameMode): GameState {
    const game: GameState = {
      roomCode,
      hostId,
      phase: 'lobby',
      players: new Map(),
      dayNumber: 0,
      nightNumber: 0,
      gameMode,
      createdAt: new Date(),
      dayVotes: new Map(),
      nightActions: new Map(),
      protectedPlayers: new Set(),
      seerInvestigations: new Map(),
      chatMessages: [],
      adminLog: [],
    };
    this.games.set(roomCode, game);
    return game;
  }

  pushAdminLog(roomCode: string, entry: Omit<AdminLogEntry, 'id' | 'timestamp'>): AdminLogEntry | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    const full: AdminLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      ...entry,
    };
    game.adminLog.push(full);
    return full;
  }

  clearAdminLog(roomCode: string): void {
    const game = this.games.get(roomCode);
    if (game) game.adminLog = [];
  }

  getGame(roomCode: string): GameState | undefined {
    return this.games.get(roomCode);
  }

  getActiveRoomCode(): string | null {
    for (const [code] of this.games) {
      return code;
    }
    return null;
  }

  addPlayer(roomCode: string, playerId: string, playerName: string): Player | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    const player: Player = {
      id: playerId,
      name: playerName,
      role: null as any, // assigned during startGame
      team: 'village',
      alive: true,
      connected: true,
      rejoinToken: randomBytes(32).toString('hex'),
    };
    game.players.set(playerId, player);
    return player;
  }

  setConnected(roomCode: string, playerId: string, connected: boolean): Player | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    const player = game.players.get(playerId);
    if (!player) return null;
    player.connected = connected;
    return player;
  }

  reassignPlayerId(roomCode: string, oldId: string, newId: string): boolean {
    if (oldId === newId) return true;
    const game = this.games.get(roomCode);
    if (!game) return false;
    const player = game.players.get(oldId);
    if (!player) return false;

    player.id = newId;
    game.players.delete(oldId);
    game.players.set(newId, player);

    // dayVotes: update voter keys and target values
    const voteTarget = game.dayVotes.get(oldId);
    if (voteTarget !== undefined) { game.dayVotes.delete(oldId); game.dayVotes.set(newId, voteTarget); }
    for (const [vid, tid] of game.dayVotes) {
      if (tid === oldId) game.dayVotes.set(vid, newId);
    }

    // nightActions: update actor keys and target values
    const action = game.nightActions.get(oldId);
    if (action) { action.playerId = newId; game.nightActions.delete(oldId); game.nightActions.set(newId, action); }
    for (const [, act] of game.nightActions) {
      if (act.targetId === oldId) act.targetId = newId;
    }

    // protectedPlayers
    if (game.protectedPlayers.has(oldId)) { game.protectedPlayers.delete(oldId); game.protectedPlayers.add(newId); }

    // seerInvestigations: update seer keys and target values
    const inv = game.seerInvestigations.get(oldId);
    if (inv) { inv.seerId = newId; game.seerInvestigations.delete(oldId); game.seerInvestigations.set(newId, inv); }
    for (const [, investigation] of game.seerInvestigations) {
      if (investigation.targetId === oldId) investigation.targetId = newId;
    }

    if (game.hostId === oldId) game.hostId = newId;
    return true;
  }

  startGame(roomCode: string): boolean {
    const game = this.games.get(roomCode);
    if (!game || game.players.size < game.gameMode.minPlayers) return false;

    // Assign roles
    const roles = game.gameMode.getRoles(game.players.size);
    const players = Array.from(game.players.values());
    players.forEach((p, i) => {
      p.role = roles[i];
      p.team = roles[i].team;
    });

    // Start with night phase
    game.phase = 'night';
    game.nightNumber = 1;
    const startDuration = game.customPhaseDuration ?? 30;
    game.phaseEndsAt = new Date(Date.now() + startDuration * 1000);
    return true;
  }

  castVote(roomCode: string, playerId: string, targetId: string): void {
    const game = this.games.get(roomCode);
    if (!game) return;
    game.dayVotes.set(playerId, targetId);
  }

  recordNightAction(roomCode: string, playerId: string, targetId: string): void {
    const game = this.games.get(roomCode);
    if (!game) return;
    game.nightActions.set(playerId, { playerId, targetId });
  }

  resolveDay(roomCode: string): { eliminated: Player | null; voteCount: number } {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== 'day') return { eliminated: null, voteCount: 0 };

    // Tally votes
    const voteTally = new Map<string, number>();
    for (const targetId of game.dayVotes.values()) {
      voteTally.set(targetId, (voteTally.get(targetId) || 0) + 1);
    }

    // Find player with most votes
    let maxVotes = 0;
    let eliminatedId: string | null = null;
    for (const [targetId, votes] of voteTally) {
      if (votes > maxVotes) {
        maxVotes = votes;
        eliminatedId = targetId;
      }
    }

    // Eliminate if votes > 0
    let eliminated: Player | null = null;
    if (eliminatedId && maxVotes > 0) {
      const target = game.players.get(eliminatedId);
      if (target && target.alive) {
        target.alive = false;
        target.deathCause = 'Voted out by the village';
        eliminated = target;
        target.role.onDeath?.(game, target);
      }
    }

    // Clear votes for next day
    game.dayVotes.clear();

    return { eliminated, voteCount: maxVotes };
  }

  addChatMessage(roomCode: string, senderId: string, senderName: string, text: string): void {
    const game = this.games.get(roomCode);
    if (!game) return;

    game.chatMessages.push({
      senderId,
      senderName,
      text,
      timestamp: new Date(),
    });
  }

  resolveNight(roomCode: string): { eliminated: Player[]; investigations: any[] } {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== 'night') return { eliminated: [], investigations: [] };

    const eliminated: Player[] = [];
    const investigations: any[] = [];
    const killTargets = new Set<string>(); // players marked for death

    // Reset protection and investigation state
    game.protectedPlayers.clear();
    game.seerInvestigations.clear();

    // Phase 1: Collect all night actions by role
    for (const [playerId, action] of game.nightActions) {
      const player = game.players.get(playerId);
      if (!player || !player.alive || !player.role.hasNightAction) continue;

      const target = game.players.get(action.targetId);
      if (!target) continue;

      // Werewolf: mark for death
      if (player.role.id === 'werewolf') {
        killTargets.add(action.targetId);
      }

      // Doctor: protect
      if (player.role.id === 'doctor') {
        game.protectedPlayers.add(action.targetId);
      }

      // Seer: investigate (store for later broadcast)
      if (player.role.id === 'seer') {
        game.seerInvestigations.set(playerId, {
          seerId: playerId,
          targetId: action.targetId,
          role: target.role,
        });
        investigations.push({
          seerId: player.name,
          targetName: target.name,
          role: target.role.name,
        });
      }
    }

    // Phase 2: Apply kills (skip protected players)
    for (const targetId of killTargets) {
      const target = game.players.get(targetId);
      if (target && target.alive && !game.protectedPlayers.has(targetId)) {
        target.alive = false;
        target.deathCause = 'Killed by werewolves';
        eliminated.push(target);
        target.role.onDeath?.(game, target);
      }
    }

    // Clear night actions for next round
    game.nightActions.clear();

    return { eliminated, investigations };
  }

  advancePhase(roomCode: string): GamePhase | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    const nextPhase = this.phaseManager.getNextPhase(game.phase);
    game.phase = nextPhase;

    if (nextPhase === 'night') {
      game.nightNumber++;
    } else if (nextPhase === 'day') {
      game.dayNumber++;
    }

    // Check win conditions
    const winner = this.winChecker.checkWin(game);
    if (winner) {
      game.phase = 'ended';
      game.winner = winner;
      return 'ended';
    }

    game.phaseEndsAt = new Date(Date.now() + 30 * 1000);
    return nextPhase;
  }

  deleteGame(roomCode: string): void {
    this.games.delete(roomCode);
  }

  getFullSnapshot(roomCode: string): any {
    const game = this.games.get(roomCode);
    if (!game) return null;
    const secondsRemaining = game.phaseEndsAt
      ? Math.max(0, Math.round((game.phaseEndsAt.getTime() - Date.now()) / 1000))
      : 0;
    return {
      roomCode: game.roomCode,
      phase: game.phase,
      secondsRemaining,
      players: Array.from(game.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        team: p.team,
        alive: p.alive,
        connected: p.connected,
      })),
      votes: Array.from(game.dayVotes.entries()).map(([voterId, targetId]) => ({
        voterId,
        voterName: game.players.get(voterId)?.name || 'Unknown',
        targetId,
        targetName: game.players.get(targetId)?.name || 'Unknown',
      })),
      log: game.adminLog,
    };
  }

  changePlayerRole(roomCode: string, playerId: string, newRole: Role): Player | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    const player = game.players.get(playerId);
    if (!player) return null;
    player.role = newRole;
    player.team = newRole.team;
    return player;
  }

  forceEliminate(roomCode: string, playerId: string): Player | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    const player = game.players.get(playerId);
    if (!player || !player.alive) return null;
    player.alive = false;
    player.deathCause = 'Removed by moderator';
    return player;
  }

  renamePlayer(roomCode: string, playerId: string, newName: string): Player | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    const player = game.players.get(playerId);
    if (!player) return null;
    player.name = newName;
    return player;
  }

  updateTimer(roomCode: string, seconds: number): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;
    game.customPhaseDuration = seconds;
    game.phaseEndsAt = new Date(Date.now() + seconds * 1000);
    return true;
  }

  getSnapshot(roomCode: string, playerId?: string): any {
    const game = this.games.get(roomCode);
    if (!game) return null;

    const playerList = Array.from(game.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      role: playerId === p.id ? p.role : undefined, // only reveal own role
    }));

    return {
      roomCode: game.roomCode,
      phase: game.phase,
      players: playerList,
      dayNumber: game.dayNumber,
      nightNumber: game.nightNumber,
      winner: game.winner,
    };
  }
}
