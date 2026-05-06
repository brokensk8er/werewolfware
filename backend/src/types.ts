// Admin log
export type LogCategory = 'town' | 'werewolf' | 'seer' | 'private' | 'system' | 'chat' | 'ghost';

export interface AdminLogEntry {
  id: string;
  timestamp: Date;
  category: LogCategory;
  senderName: string;
  text: string;
  meta?: string; // e.g. "→ Alice" for targeted private messages
}

// Game state types
export type GamePhase = 'lobby' | 'night' | 'day' | 'ended';
export type PlayerTeam = 'village' | 'werewolf' | 'solo';

export interface Player {
  id: string;
  name: string;
  role: Role;
  team: PlayerTeam;
  alive: boolean;
  connected: boolean;
  rejoinToken: string;
  deathCause?: string;
}

export interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: Date;
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
  customPhaseDuration?: number; // seconds; persists across phase advances
  winner?: PlayerTeam;
  winReason?: string;
  dayVotes: Map<string, string>; // playerId -> targetId
  nightActions: Map<string, { playerId: string; targetId: string }>;
  protectedPlayers: Set<string>; // playerIds protected by doctor
  seerInvestigations: Map<string, { seerId: string; targetId: string; role: Role }>;
  chatMessages: ChatMessage[]; // town square chat
  adminLog: AdminLogEntry[];
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

// Admin socket events (client -> server, /admin namespace)
export interface AdminClientEvents {
  'admin:auth': (data: { token: string; roomCode: string }) => void;
  'admin:forcePhase': () => void;
  'admin:changeRole': (data: { playerId: string; roleId: string }) => void;
  'admin:eliminate': (data: { playerId: string }) => void;
  'admin:kick': (data: { playerId: string }) => void;
  'admin:setTimer': (data: { seconds: number }) => void;
}

// Admin socket events (server -> client, /admin namespace)
export interface AdminServerEvents {
  'admin:authed': (data: { uid: string; roomCode: string }) => void;
  'admin:state': (data: {
    roomCode: string;
    phase: string;
    secondsRemaining: number;
    players: Array<{ id: string; name: string; role: Role; team: string; alive: boolean; connected: boolean }>;
    log: AdminLogEntry[];
    votes: Array<{ voterId: string; voterName: string; targetId: string; targetName: string }>;
  }) => void;
  'admin:logEntry': (data: AdminLogEntry) => void;
  'admin:playerUpdate': (data: {
    players: Array<{ id: string; name: string; role: Role; team: string; alive: boolean; connected: boolean }>;
  }) => void;
  'admin:phaseUpdate': (data: { phase: string; secondsRemaining: number }) => void;
  'admin:voteUpdate': (data: {
    votes: Array<{ voterId: string; voterName: string; targetId: string; targetName: string }>;
  }) => void;
  error: (data: { message: string }) => void;
}

// Socket.io events (client -> server)
export interface ClientEvents {
  'lobby:create': (data: { playerName: string }) => void;
  'lobby:join': (data: { roomCode: string; playerName: string }) => void;
  'game:start': () => void;
  'game:advancePhase': () => void;
  'game:setMode': (data: { modeId: string }) => void;
  'game:rejoin': (data: { token: string }) => void;
  'vote:cast': (data: { targetId: string }) => void;
  'night:action': (data: { targetId: string }) => void;
  'chat:send': (data: { text: string }) => void;
  'ghost:send': (data: { text: string }) => void;
}

// Socket.io events (server -> client)
export interface ServerEvents {
  'lobby:created': (data: { roomCode: string; playerId: string; token: string }) => void;
  'lobby:joined': (data: { roomCode: string; playerId: string; token: string }) => void;
  'lobby:updated': (data: { players: Array<{ id: string; name: string }> }) => void;
  'game:reconnected': (data: {
    playerId: string;
    role: Role;
    players: Array<{ id: string; name: string; alive: boolean; connected: boolean }>;
    phase: GamePhase;
    secondsRemaining: number;
    recentMessages: ChatMessage[];
  }) => void;
  'player:connectionChanged': (data: { playerId: string; playerName: string; connected: boolean }) => void;
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
  'vote:updated': (data: {
    votes: Array<{ voterId: string; voterName: string; targetId: string; targetName: string }>;
  }) => void;
  'vote:result': (data: {
    eliminated: string;
    eliminatedName: string;
    voteCount: number;
  }) => void;
  'chat:message': (data: ChatMessage) => void;
  'ghost:message': (data: ChatMessage) => void;
  'game:ended': (data: { winner: PlayerTeam; winReason: string }) => void;
  error: (data: { message: string }) => void;
}
