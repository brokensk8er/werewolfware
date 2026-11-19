import { randomUUID } from 'node:crypto';
import { GameState, GamePhase, Player, Role, GameMode, AdminLogEntry, LogCategory, PlayerTeam } from '../types.js';
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
      rejoinToken: randomUUID(),
      notes: [],
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

  /** Seconds for a phase: the moderator's timer if they set one, else the default. */
  phaseSeconds(game: GameState, phase: GamePhase): number {
    return game.customPhaseDuration ?? this.phaseManager.getPhaseDuration(phase);
  }

  /** Deals roles and starts night 1. Returns an error message, or null on success. */
  startGame(roomCode: string): string | null {
    const game = this.games.get(roomCode);
    if (!game) return 'No active game';
    if (game.phase !== 'lobby') return 'The game has already started.';
    const { minPlayers, maxPlayers } = game.gameMode;
    if (game.players.size < minPlayers) return `Need at least ${minPlayers} players to start (${game.players.size} joined).`;
    if (game.players.size > maxPlayers) return `Too many players: the limit is ${maxPlayers}.`;

    // Assign roles
    const roles = game.gameMode.getRoles(game.players.size);
    const players = Array.from(game.players.values());
    players.forEach((p, i) => {
      p.role = roles[i];
      p.team = roles[i].team;
      if (roles[i].id === 'mayor') p.name = `Mayor ${p.name}`;
    });

    // Start with night phase
    game.phase = 'night';
    game.nightNumber = 1;
    game.phaseEndsAt = new Date(Date.now() + this.phaseSeconds(game, 'night') * 1000);
    return null;
  }

  /** Records a day vote after checking it. Returns an error message, or null. */
  castVote(roomCode: string, voterId: string, targetId: string): string | null {
    const game = this.games.get(roomCode);
    if (!game) return 'No active game';
    if (game.phase !== 'day') return 'Voting is only open during the day.';
    const voter = game.players.get(voterId);
    if (!voter || !voter.alive) return 'Only living players can vote.';
    if (voter.role && !voter.role.canVoteDuringDay) return 'Your role cannot vote.';
    const target = game.players.get(targetId);
    if (!target || !target.alive) return 'That player cannot be voted for.';
    if (voterId === targetId) return 'You cannot vote for yourself.';
    game.dayVotes.set(voterId, targetId);
    return null;
  }

  /** Records a night choice after checking it. Returns an error message, or null. */
  recordNightAction(roomCode: string, actorId: string, targetId: string): string | null {
    const game = this.games.get(roomCode);
    if (!game) return 'No active game';
    if (game.phase !== 'night') return 'Night actions are only open at night.';
    const actor = game.players.get(actorId);
    if (!actor || !actor.alive) return 'Only living players can act at night.';
    if (!actor.role?.hasNightAction) return 'You have no action tonight.';
    const target = game.players.get(targetId);
    if (!target || !target.alive) return 'That player cannot be chosen.';
    if (actorId === targetId && !actor.role.canTargetSelf) return 'You cannot choose yourself.';
    if (actor.team === 'werewolf' && target.team === 'werewolf') return 'Werewolves cannot target their own pack.';
    game.nightActions.set(actorId, { playerId: actorId, targetId });
    return null;
  }

  /**
   * Counts the day's votes. Only living voters and living targets count, and the
   * Mayor's vote counts twice. A tie at the top eliminates nobody (decision D3).
   */
  resolveDay(roomCode: string): { eliminated: Player | null; voteCount: number; tiedNames: string[] } {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== 'day') return { eliminated: null, voteCount: 0, tiedNames: [] };

    const voteTally = new Map<string, number>();
    for (const [voterId, targetId] of game.dayVotes.entries()) {
      const voter = game.players.get(voterId);
      const target = game.players.get(targetId);
      if (!voter || !voter.alive || !target || !target.alive) continue;
      const weight = voter.role?.id === 'mayor' ? 2 : 1;
      voteTally.set(targetId, (voteTally.get(targetId) || 0) + weight);
    }
    game.dayVotes.clear();

    const maxVotes = Math.max(0, ...voteTally.values());
    const leaders = [...voteTally.entries()].filter(([, v]) => v === maxVotes && v > 0).map(([id]) => id);
    if (leaders.length !== 1) {
      const tiedNames = leaders.map((id) => game.players.get(id)!.name);
      return { eliminated: null, voteCount: maxVotes, tiedNames };
    }

    const target = game.players.get(leaders[0])!;
    target.alive = false;
    target.deathCause = 'Voted out by the village';
    target.role.onDeath?.(game, target);
    return { eliminated: target, voteCount: maxVotes, tiedNames: [] };
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
    const wolfPicks = new Map<string, number>(); // target -> number of wolves choosing them

    // Reset protection and investigation state
    game.protectedPlayers.clear();
    game.seerInvestigations.clear();

    // Phase 1: Collect all night actions by role
    for (const [playerId, action] of game.nightActions) {
      const player = game.players.get(playerId);
      if (!player || !player.alive || !player.role.hasNightAction) continue;

      const target = game.players.get(action.targetId);
      if (!target || !target.alive) continue;

      // Werewolf: one vote towards the pack's single kill
      if (player.role.id === 'werewolf') {
        if (target.team !== 'werewolf') wolfPicks.set(target.id, (wolfPicks.get(target.id) || 0) + 1);
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
          team: target.team,
        });
        investigations.push({
          seerId: player.name,
          targetName: target.name,
          team: target.team,
        });
      }
    }

    // Phase 2: the pack kills one player: the most-chosen target. If the wolves
    // split evenly, one of the tied targets is picked at random (decision D2).
    const most = Math.max(0, ...wolfPicks.values());
    const tied = [...wolfPicks.entries()].filter(([, n]) => n === most && n > 0).map(([id]) => id);
    const killTargets = tied.length ? [tied[Math.floor(Math.random() * tied.length)]] : [];
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

    game.phaseEndsAt = new Date(Date.now() + this.phaseSeconds(game, nextPhase) * 1000);
    return nextPhase;
  }

  /** Ends the game if a side has won (used after a moderator elimination). */
  checkWinNow(roomCode: string): PlayerTeam | null {
    const game = this.games.get(roomCode);
    if (!game || game.phase === 'lobby' || game.phase === 'ended') return null;
    const winner = this.winChecker.checkWin(game);
    if (winner) {
      game.phase = 'ended';
      game.winner = winner;
    }
    return winner;
  }

  deleteGame(roomCode: string): void {
    this.games.delete(roomCode);
  }

  /** Seconds left in the current phase (0 when no countdown is running). */
  secondsRemaining(game: GameState): number {
    if (!game.phaseEndsAt || (game.phase !== 'night' && game.phase !== 'day')) return 0;
    return Math.max(0, Math.round((game.phaseEndsAt.getTime() - Date.now()) / 1000));
  }

  changePlayerRole(roomCode: string, playerId: string, newRole: Role): Player | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    const player = game.players.get(playerId);
    if (!player) return null;
    player.role = newRole;
    player.team = newRole.team;
    // The Mayor is public and carries the title in their name; it comes and goes with the role
    const baseName = player.name.replace(/^Mayor /, '');
    player.name = newRole.id === 'mayor' ? `Mayor ${baseName}` : baseName;
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
}
