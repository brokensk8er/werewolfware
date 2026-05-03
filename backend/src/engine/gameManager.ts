import { GameState, GamePhase, Player, Role, GameMode } from '../types.js';
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
    };
    this.games.set(roomCode, game);
    return game;
  }

  getGame(roomCode: string): GameState | undefined {
    return this.games.get(roomCode);
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
    };
    game.players.set(playerId, player);
    return player;
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
    game.phaseEndsAt = new Date(Date.now() + 30 * 1000); // 30 seconds
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
