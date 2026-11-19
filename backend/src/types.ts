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
  /** Fixed for the whole game. A phone's connections join a socket room with this name. */
  id: string;
  name: string;
  role: Role;
  team: PlayerTeam;
  alive: boolean;
  connected: boolean;
  rejoinToken: string;
  deathCause?: string;
  /** Private results kept for the whole game, e.g. the Seer's findings. */
  notes: PlayerNote[];
}

export interface PlayerNote {
  at: string; // e.g. "Night 2"
  text: string;
}

/** What a phone may know. Sent after every change; the phone redraws from it alone. */
export interface PlayerView {
  roomCode: string;
  phase: GamePhase;
  /** Night number at night, day number by day. */
  round: number;
  secondsRemaining: number;
  you: {
    id: string;
    name: string;
    alive: boolean;
    deathCause?: string;
    role: PublicRole | null;
    /** Fellow werewolves' names, for werewolves only (decision D6). */
    pack: string[];
    voteId: string | null;
    nightTargetId: string | null;
    notes: PlayerNote[];
  };
  players: Array<{ id: string; name: string; alive: boolean; connected: boolean }>;
  ended: EndResult | null;
}

export interface PublicRole {
  id: string;
  name: string;
  team: PlayerTeam;
  description: string;
  hasNightAction: boolean;
  canTargetSelf: boolean;
  canVoteDuringDay: boolean;
}

export interface EndResult {
  winner: PlayerTeam | 'none';
  winReason: string;
  endedByModerator: boolean;
  players: Array<{ name: string; role: string; team: PlayerTeam; alive: boolean; deathCause: string }>;
}

/** What the moderator panel shows (without the log, which streams separately). */
export interface AdminView {
  roomCode: string;
  phase: GamePhase;
  round: number;
  secondsRemaining: number;
  players: Array<{
    id: string;
    name: string;
    role: PublicRole | null;
    team: PlayerTeam;
    alive: boolean;
    connected: boolean;
    /** Has made this phase's choice (a night action at night, a vote by day). */
    acted: boolean;
  }>;
  votes: Array<{ voterId: string; voterName: string; targetId: string; targetName: string }>;
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
  seerInvestigations: Map<string, { seerId: string; targetId: string; role: Role; team: PlayerTeam }>;
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
  /** May choose themselves as a night target (the Doctor protecting themselves). */
  canTargetSelf?: boolean;
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
  /** The full log, once, when a moderator starts watching. */
  'admin:state': (data: { log: AdminLogEntry[] }) => void;
  'admin:logEntry': (data: AdminLogEntry) => void;
  /** Sent after every change, like the phones' game:view. */
  'admin:view': (data: AdminView) => void;
  error: (data: { message: string }) => void;
}

// Socket.io events (client -> server)
export interface ClientEvents {
  // Players cannot create, start or advance a game; the moderator panel does that.
  'lobby:join': (data: { playerName: string }) => void;
  'game:rejoin': (data: { token: string }) => void;
  'vote:cast': (data: { targetId: string }) => void;
  'night:action': (data: { targetId: string }) => void;
  'chat:send': (data: { text: string }) => void;
  'ghost:send': (data: { text: string }) => void;
}

// Socket.io events (server -> client)
// State reaches phones only through game:view. The other events are messages
// (chat, errors) or the one-time hand-over of the rejoin token.
export interface ServerEvents {
  session: (data: { playerId: string; token: string }) => void;
  'game:view': (data: PlayerView) => void;
  'chat:history': (data: { messages: ChatMessage[] }) => void;
  'chat:message': (data: ChatMessage) => void;
  'ghost:message': (data: ChatMessage) => void;
  'player:removed': (data: { message: string }) => void;
  error: (data: { message: string }) => void;
}
