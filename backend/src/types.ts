// Game state types
export type GamePhase = 'lobby' | 'night' | 'day' | 'ended';
export type PlayerTeam = 'village' | 'werewolf' | 'solo';

export interface Player {
  id: string;
  name: string;
  role: Role;
  team: PlayerTeam;
  alive: boolean;
  socketId?: string;
}

export interface GameState {
  roomCode: string;
  hostId: string;
  phase: GamePhase;
  players: Map<string, Player>;
  dayNumber: number;
  nightNumber: number;
  gameMode: GameMode;
  createdAt: Date;
  phaseEndsAt?: Date;
  winner?: PlayerTeam;
  winReason?: string;
  dayVotes: Map<string, string>; // playerId -> targetId
  nightActions: Map<string, { playerId: string; targetId: string }>;
  protectedPlayers: Set<string>; // playerIds protected by doctor
  seerInvestigations: Map<string, { seerId: string; targetId: string; role: Role }>;
}

// Role interface
export interface Role {
  id: string;
  name: string;
  team: PlayerTeam;
  description: string;
  canVoteDuringDay: boolean;
  hasNightAction: boolean;
  nightAction?(game: GameState, player: Player, targetId: string): void;
  onDeath?(game: GameState, player: Player): void;
  checkWinCondition?(game: GameState): boolean;
}

// Game mode interface
export interface GameMode {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  getRoles(playerCount: number): Role[];
}

// Socket.io events (client -> server)
export interface ClientEvents {
  'lobby:create': (data: { playerName: string }) => void;
  'lobby:join': (data: { roomCode: string; playerName: string }) => void;
  'game:start': () => void;
  'game:advancePhase': () => void;
  'game:setMode': (data: { modeId: string }) => void;
  'vote:cast': (data: { targetId: string }) => void;
  'night:action': (data: { targetId: string }) => void;
}

// Socket.io events (server -> client)
export interface ServerEvents {
  'lobby:created': (data: { roomCode: string; playerId: string }) => void;
  'lobby:joined': (data: { roomCode: string; playerId: string }) => void;
  'lobby:updated': (data: { players: Array<{ id: string; name: string }> }) => void;
  'game:started': (data: {
    playerId: string;
    role: Role;
    players: Array<{ id: string; name: string }>;
  }) => void;
  'phase:changed': (data: { phase: GamePhase; secondsRemaining: number }) => void;
  'player:eliminated': (data: {
    playerId: string;
    playerName: string;
    role: string;
  }) => void;
  'seer:investigation': (data: { targetName: string; role: string }) => void;
  'night:actionRecorded': (data: { targetId: string }) => void;
  'game:ended': (data: { winner: PlayerTeam; winReason: string }) => void;
  error: (data: { message: string }) => void;
}
