import express, { Express } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameManager } from './engine/gameManager.js';
import { ClassicMode } from './gamemodes/classic.js';
import { ClientEvents, ServerEvents, AdminClientEvents, AdminServerEvents, LogCategory } from './types.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Villager } from './roles/villager.js';
import { Werewolf } from './roles/werewolf.js';
import { Seer } from './roles/seer.js';
import { Doctor } from './roles/doctor.js';
import { Mayor } from './roles/mayor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app: Express = express();
const httpServer = createServer(app);
const io = new SocketIOServer<ClientEvents, ServerEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Admin Socket.io namespace
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminNS: any = io.of('/admin');

// Roles available for on-the-fly changes
const ROLE_REGISTRY: Record<string, any> = {
  villager: Villager,
  werewolf: Werewolf,
  seer: Seer,
  doctor: Doctor,
  mayor: Mayor,
};

// Track which admin sockets are watching which room: roomCode -> Set<socketId>
const adminWatchers = new Map<string, Set<string>>();

// Reconnection token -> { roomCode, playerId }
const rejoinTokens = new Map<string, { roomCode: string; playerId: string }>();

// Firebase Admin SDK — initialized when FIREBASE_SERVICE_ACCOUNT env var is set
let firebaseAdminAuth: any = null;
let firebaseAdminDb: any = null;

async function initFirebaseAdmin() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) {
    console.warn('[Admin] FIREBASE_SERVICE_ACCOUNT not set — admin auth disabled');
    return;
  }
  try {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    const serviceAccount = JSON.parse(sa);
    const adminApp = initializeApp({ credential: cert(serviceAccount) }, 'admin');
    firebaseAdminAuth = getAuth(adminApp);
    firebaseAdminDb = getFirestore(adminApp);
    console.log('[Admin] Firebase Admin initialized');
  } catch (e) {
    console.error('[Admin] Firebase Admin init failed:', e);
  }
}

// Local test runs only: lets the phone-size check open the moderator page without
// Google sign-in. Refused whenever the server is deployed (Fly sets both of these).
const TEST_ADMIN_ALLOWED =
  process.env.ALLOW_TEST_ADMIN === '1' &&
  process.env.NODE_ENV !== 'production' &&
  !process.env.FLY_APP_NAME;

async function verifyAdminToken(token: string): Promise<string | null> {
  if (TEST_ADMIN_ALLOWED && token === 'local-test') return 'local-test-admin';
  if (!firebaseAdminAuth || !firebaseAdminDb) return null;
  try {
    const decoded = await firebaseAdminAuth.verifyIdToken(token);
    const uid: string = decoded.uid;
    const userDoc = await firebaseAdminDb.collection('users').doc(uid).get();
    if (!userDoc.exists) return null;
    const data = userDoc.data();
    return data?.isAdmin === true ? uid : null;
  } catch {
    return null;
  }
}

const gameManager = new GameManager();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Helper to get room code from socket. The room is recorded on the socket when a
// player joins or rejoins, because socket.rooms is already empty by the time the
// 'disconnect' event fires.
function getRoomCode(socket: any): string | null {
  if (socket.data?.roomCode) return socket.data.roomCode as string;
  for (const room of socket.rooms) {
    if (room !== socket.id) return room as string;
  }
  return null;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const VOTE_CAST_AMBIGUOUS = [
  'Somewhere, the clink of a pebble falls into a counting jar. A vote has been cast.',
  'A name is written in chalk. The tally grows by one.',
  'A stone is placed, quietly and with purpose. The count shifts.',
  'The scratch of a quill on parchment. Someone has made their choice.',
  'A bead slides on the abacus. The village inches toward a verdict.',
  'One more finger points in silence. The reckoning draws closer.',
  'A notch is carved. The count does not lie.',
];

const VOTE_CAST_PRIVATE = [
  'Your vote is cast. May your deity of choice have mercy on their soul.',
  'It is done. History will judge you — probably harshly.',
  'Your stone is in the jar. What you have started, the village will finish.',
  'You have spoken. Whether wisely or not remains to be seen.',
  'The name is written. Light a candle for them tonight.',
  'Your conscience is your own business. The vote, however, is now everyone\'s.',
  'Done. Try not to think about it too much.',
];

const WEREWOLF_DEATHS = [
  'found torn apart at the edge of the woods',
  'discovered in several pieces behind the mill',
  'dragged from their bed and left in the square',
  'found with claw marks too large to be any dog',
  'heard screaming at midnight — nothing left by dawn',
  'pulled into the dark, only their shoes remained',
];

const VOTE_DEATHS = [
  'hoisted up by the angry mob',
  'pelted with vegetables until lifeless',
  'dragged to the gallows amid wild cheering',
  'driven out of town and never seen again — officially',
  'given a very strongly worded farewell',
  'met the pointy end of village justice',
];

const SEER_WHISPERS = [
  'Your third eye twitches. The spirits reveal',
  'The visions crash over you like a wave —',
  'The crow lands on your shoulder and croaks:',
  'You gaze into the flame and see the truth:',
  'A cold certainty washes over you:',
];

const PHASE_NIGHT = [
  '🌙 Darkness falls. The village sleeps — or pretends to.',
  '🌙 Night descends. Something stirs in the shadows.',
  '🌙 The torches flicker out. Pray for dawn.',
  '🌙 Night again. Lock your doors. Not that it helps.',
];

const PHASE_DAY = [
  '☀️ Dawn breaks. Someone is missing. Surprise.',
  '☀️ The sun rises on a smaller village.',
  '☀️ Day breaks. Time to point fingers and argue.',
  '☀️ Morning. The survivors gather in the square.',
];

// Emit to all admins watching a room
function emitToAdmins(roomCode: string, event: string, data: any) {
  const watchers = adminWatchers.get(roomCode);
  if (!watchers) return;
  for (const socketId of watchers) {
    (adminNS.to(socketId) as any).emit(event, data);
  }
}

function broadcastAdminPlayerUpdate(roomCode: string) {
  const game = gameManager.getGame(roomCode);
  if (!game) return;
  const players = Array.from(game.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    team: p.team,
    alive: p.alive,
    connected: p.connected,
  }));
  emitToAdmins(roomCode, 'admin:playerUpdate', { players });
}

function broadcastAdminPhaseUpdate(roomCode: string, phase: string, secondsRemaining: number) {
  emitToAdmins(roomCode, 'admin:phaseUpdate', { phase, secondsRemaining });
}

function broadcastAdminVoteUpdate(roomCode: string) {
  const game = gameManager.getGame(roomCode);
  if (!game) return;
  const votes = Array.from(game.dayVotes.entries()).map(([voterId, targetId]) => ({
    voterId,
    voterName: game.players.get(voterId)?.name || 'Unknown',
    targetId,
    targetName: game.players.get(targetId)?.name || 'Unknown',
  }));
  emitToAdmins(roomCode, 'admin:voteUpdate', { votes });
}

// Player list as phones see it. Always carries the alive and connected flags, so a
// list sent mid-game (after a removal) cannot make every player look dead.
function publicPlayers(roomCode: string) {
  const game = gameManager.getGame(roomCode);
  if (!game) return [];
  return Array.from(game.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    connected: p.connected,
  }));
}

// Moderator-only note. Connection changes go here, not into the room chat:
// with 30 phones sleeping and waking they would bury everything else.
function noteForAdmins(roomCode: string, text: string) {
  const entry = gameManager.pushAdminLog(roomCode, { category: 'system', senderName: '📶 Connection', text });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
}

// Forget a removed player's rejoin token so a refresh cannot bring them back.
function dropRejoinTokens(roomCode: string, playerId?: string) {
  for (const [token, entry] of rejoinTokens) {
    if (entry.roomCode === roomCode && (playerId === undefined || entry.playerId === playerId)) {
      rejoinTokens.delete(token);
    }
  }
}

// Wrap every handler on a socket: a missing payload becomes {}, and a thrown error
// is logged and reported to that one client instead of stopping the server.
function guardSocket(socket: any) {
  const rawOn = socket.on.bind(socket);
  socket.on = (event: string, handler: (...args: any[]) => any) =>
    rawOn(event, async (...args: any[]) => {
      try {
        if (event !== 'disconnect' && (args[0] === null || typeof args[0] !== 'object')) args[0] = {};
        await handler(...args);
      } catch (err) {
        console.error(`[handler] ${event} failed:`, err);
        socket.emit('error', { message: 'That did not work. Please try again.' });
      }
    });
}

// Votes are hidden from phones until voting closes (decision 4, 2026-11-16), so
// only the moderator receives the running tally. Player ids change on reconnect,
// so it is resent after a reconnect or a removal.
function broadcastVotes(roomCode: string) {
  broadcastAdminVoteUpdate(roomCode);
}

// Strips control characters and outer spaces from a name typed by a person.
function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

// Returns why a name cannot be used in this game, or null if it is fine.
function nameProblem(roomCode: string, name: string, exceptId?: string): string | null {
  const game = gameManager.getGame(roomCode);
  if (!game) return 'No active game';
  if (name.length < 1 || name.length > 20) return 'Please enter a name of 1 to 20 characters.';
  const lower = name.toLowerCase();
  const taken = Array.from(game.players.values()).some(
    (p) => p.id !== exceptId && (p.name.toLowerCase() === lower || p.name.toLowerCase() === `mayor ${lower}`),
  );
  return taken ? 'That name is taken. Add an initial or a nickname.' : null;
}

// Phones may send chat at most once a second each.
const lastChatAt = new Map<string, number>();
function chatTooFast(socketId: string): boolean {
  const now = Date.now();
  if (now - (lastChatAt.get(socketId) ?? 0) < 1000) return true;
  lastChatAt.set(socketId, now);
  return false;
}

// One path for every day vote, whether a player or the moderator casts it.
// Returns an error message, or null when the vote was recorded.
function applyVote(roomCode: string, voterId: string, targetId: string, byModerator: boolean): string | null {
  const problem = gameManager.castVote(roomCode, voterId, targetId);
  if (problem) return problem;
  const game = gameManager.getGame(roomCode)!;
  const voter = game.players.get(voterId)!;
  const target = game.players.get(targetId)!;

  broadcastVotes(roomCode);

  // Ambiguous town-wide note: says a vote happened, never who or for whom
  io.to(roomCode).emit('chat:message', {
    senderId: '__system__',
    senderName: '📢 Town Square',
    text: pick(VOTE_CAST_AMBIGUOUS),
    timestamp: new Date(),
  });

  const entry = gameManager.pushAdminLog(roomCode, {
    category: 'town',
    senderName: voter.name,
    text: `${byModerator ? '[Moderator] ' : ''}Voted for ${target.name}`,
  });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);

  // The voter's own phone shows their choice, including one the moderator made for them
  io.to(voterId).emit('vote:recorded', { targetId, targetName: target.name });
  announcePrivate(
    voterId,
    `${byModerator ? 'The moderator recorded your vote' : 'You have voted'} for ${target.name}. ${pick(VOTE_CAST_PRIVATE)}`,
    '🗳️ Your Vote',
    'private',
    roomCode,
    `→ ${voter.name}`,
  );
  return null;
}

// One path for every night choice. Returns an error message, or null.
function applyNightAction(roomCode: string, actorId: string, targetId: string, label = ''): string | null {
  const problem = gameManager.recordNightAction(roomCode, actorId, targetId);
  if (problem) return problem;
  const game = gameManager.getGame(roomCode)!;
  const actor = game.players.get(actorId)!;
  const target = game.players.get(targetId)!;
  io.to(actorId).emit('night:actionRecorded', { targetId });
  const entry = gameManager.pushAdminLog(roomCode, {
    category: actor.role.id === 'werewolf' ? 'werewolf' : 'seer',
    senderName: actor.name,
    text: `${label}${actor.role.name} ${actor.name} → ${target.name}`,
  });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
  return null;
}

// Results table for the end screen. Safe even if roles were never dealt.
function playerSummary(roomCode: string) {
  const game = gameManager.getGame(roomCode);
  if (!game) return [];
  return Array.from(game.players.values()).map((p) => ({
    name: p.name,
    role: p.role?.name ?? '—',
    team: p.team,
    alive: p.alive,
    deathCause: p.alive ? 'Survived' : (p.deathCause ?? 'Eliminated'),
  }));
}

// Announces a win. The moderator's log is kept so the evening can be recapped;
// it is replaced when the next game is created.
function finishGame(roomCode: string) {
  const game = gameManager.getGame(roomCode);
  if (!game || !game.winner) return;
  io.to(roomCode).emit('game:ended', { winner: game.winner, winReason: game.winReason ?? '', players: playerSummary(roomCode) });
  announce(roomCode, `⚔️ ${game.winner.toUpperCase()} WIN! ${game.winReason ?? ''}`, 'system');
  broadcastAdminPhaseUpdate(roomCode, 'ended', 0);
}

// A removed player's vote and night action go with them, as do choices aimed at them.
function forgetPlayerChoices(roomCode: string, playerId: string) {
  const game = gameManager.getGame(roomCode);
  if (!game) return;
  game.dayVotes.delete(playerId);
  for (const [voterId, targetId] of game.dayVotes) if (targetId === playerId) game.dayVotes.delete(voterId);
  game.nightActions.delete(playerId);
  for (const [actorId, action] of game.nightActions) if (action.targetId === playerId) game.nightActions.delete(actorId);
  game.protectedPlayers.delete(playerId);
}

// Announce to room + log to admin
function announce(
  roomCode: string,
  text: string,
  category: LogCategory = 'system',
  senderName = '📢 Announcement',
) {
  io.to(roomCode).emit('chat:message', {
    senderId: '__system__',
    senderName,
    text,
    timestamp: new Date(),
  });
  const entry = gameManager.pushAdminLog(roomCode, { category, senderName, text });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
}

// Private message to one player + log to admin (with meta)
function announcePrivate(
  targetId: string,
  text: string,
  senderName = '🔮 The Spirits',
  category: LogCategory = 'private',
  roomCode?: string,
  meta?: string,
) {
  io.to(targetId).emit('chat:message', {
    senderId: '__system__',
    senderName,
    text,
    timestamp: new Date(),
  });
  if (roomCode) {
    const entry = gameManager.pushAdminLog(roomCode, { category, senderName, text, meta });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
  }
}

// ─── Player namespace ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  guardSocket(socket);
  console.log(`Player connected: ${socket.id}`);

  // Players cannot create, start or advance a game. The moderator panel is the
  // only driver (decision D1); those handlers were removed on purpose.

  socket.on('lobby:join', (data) => {
    const playerName = cleanName(data.playerName);
    // Auto-resolve the single active game; ignore any client-supplied roomCode
    const roomCode = getActiveRoomCode();
    const game = roomCode ? gameManager.getGame(roomCode) : null;

    if (!game || !roomCode) {
      socket.emit('error', { message: 'No active game found' });
      return;
    }
    if (game.phase !== 'lobby') {
      socket.emit('error', { message: 'The game has already started. Ask the moderator.' });
      return;
    }
    if (game.players.size >= game.gameMode.maxPlayers) {
      socket.emit('error', { message: `The game is full (${game.gameMode.maxPlayers} players).` });
      return;
    }
    const badName = nameProblem(roomCode, playerName);
    if (badName) {
      socket.emit('error', { message: badName });
      return;
    }
    if (game.players.has(socket.id)) {
      socket.emit('error', { message: 'You have already joined.' });
      return;
    }

    const player = gameManager.addPlayer(roomCode, socket.id, playerName);
    if (!player) {
      socket.emit('error', { message: 'Could not join room' });
      return;
    }

    rejoinTokens.set(player.rejoinToken, { roomCode, playerId: socket.id });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.emit('lobby:joined', { roomCode, playerId: socket.id, token: player.rejoinToken, playerName: player.name });

    io.to(roomCode).emit('lobby:updated', { players: publicPlayers(roomCode) });
    broadcastAdminPlayerUpdate(roomCode);
    console.log(`Player ${playerName} joined room ${roomCode}`);
  });

  socket.on('vote:cast', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) { socket.emit('error', { message: 'Not in a room' }); return; }
    const problem = applyVote(roomCode, socket.id, data.targetId, false);
    if (problem) socket.emit('error', { message: problem });
  });

  socket.on('night:action', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) { socket.emit('error', { message: 'Not in a room' }); return; }
    const problem = applyNightAction(roomCode, socket.id, data.targetId);
    if (problem) socket.emit('error', { message: problem });
  });

  socket.on('chat:send', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) { socket.emit('error', { message: 'Not in a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

    const sender = game.players.get(socket.id);
    if (!sender) return;
    if (!sender.alive) { socket.emit('error', { message: 'The dead speak only in ghost chat.' }); return; }

    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) return;
    if (text.length > 300) { socket.emit('error', { message: 'Messages can be up to 300 characters.' }); return; }
    if (chatTooFast(socket.id)) { socket.emit('error', { message: 'Slow down: one message a second.' }); return; }

    const message = {
      senderId: socket.id,
      senderName: sender.name,
      text,
      timestamp: new Date(),
    };

    gameManager.addChatMessage(roomCode, socket.id, sender.name, text);
    io.to(roomCode).emit('chat:message', message);

    const entry = gameManager.pushAdminLog(roomCode, {
      category: 'chat',
      senderName: sender.name,
      text,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
  });

  socket.on('ghost:send', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) return;
    const game = gameManager.getGame(roomCode);
    if (!game) return;
    const player = game.players.get(socket.id);
    if (!player || player.alive) return; // only the dead may ghost-chat

    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) return;
    if (text.length > 300) { socket.emit('error', { message: 'Messages can be up to 300 characters.' }); return; }
    if (chatTooFast(socket.id)) { socket.emit('error', { message: 'Slow down: one message a second.' }); return; }

    const msg = { senderId: socket.id, senderName: player.name, text, timestamp: new Date() };

    // Relay to every dead real player (bots have no socket)
    for (const [pid, p] of game.players) {
      if (!p.alive && !pid.startsWith('bot_')) {
        io.to(pid).emit('ghost:message', msg);
      }
    }

    const entry = gameManager.pushAdminLog(roomCode, {
      category: 'ghost',
      senderName: player.name,
      text,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
  });

  socket.on('game:rejoin', (data) => {
    const entry = rejoinTokens.get(data.token);
    if (!entry) {
      socket.emit('error', { message: 'Rejoin token invalid or expired' });
      return;
    }

    const { roomCode, playerId: oldId } = entry;
    const game = gameManager.getGame(roomCode);
    if (!game) {
      rejoinTokens.delete(data.token);
      socket.emit('error', { message: 'Game no longer exists' });
      return;
    }

    const newId = socket.id;
    if (!game.players.has(oldId)) {
      // Removed by the moderator since the token was issued
      rejoinTokens.delete(data.token);
      socket.emit('error', { message: 'You are no longer in this game.' });
      return;
    }
    gameManager.reassignPlayerId(roomCode, oldId, newId);
    rejoinTokens.set(data.token, { roomCode, playerId: newId });
    gameManager.setConnected(roomCode, newId, true);

    const player = game.players.get(newId);
    if (!player) return;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    if (game.phase === 'lobby') {
      socket.emit('lobby:joined', { roomCode, playerId: newId, token: data.token, playerName: player.name });
      socket.emit('lobby:updated', { players: publicPlayers(roomCode) });
    } else {
      const secondsRemaining = game.phaseEndsAt
        ? Math.max(0, Math.round((game.phaseEndsAt.getTime() - Date.now()) / 1000))
        : 0;
      socket.emit('game:reconnected', {
        playerId: newId,
        playerName: player.name,
        role: player.role,
        players: publicPlayers(roomCode),
        phase: game.phase,
        secondsRemaining,
        recentMessages: game.chatMessages.slice(-20),
      });
    }

    // The player's id changed, so phones need the whole list, not a one-row patch
    io.to(roomCode).emit('lobby:updated', { players: publicPlayers(roomCode) });
    if (game.phase === 'day') broadcastVotes(roomCode);
    noteForAdmins(roomCode, `${player.name} reconnected.`);
    broadcastAdminPlayerUpdate(roomCode);
    console.log(`Player ${player.name} reconnected: ${oldId} -> ${newId}`);
  });

  socket.on('disconnect', () => {
    const roomCode = getRoomCode(socket);
    if (roomCode) {
      const game = gameManager.getGame(roomCode);
      const player = game?.players.get(socket.id);
      if (player) {
        gameManager.setConnected(roomCode, socket.id, false);
        io.to(roomCode).emit('player:connectionChanged', { playerId: socket.id, playerName: player.name, connected: false });
        noteForAdmins(roomCode, `${player.name} lost connection.`);
        broadcastAdminPlayerUpdate(roomCode);
      }
    }
    lastChatAt.delete(socket.id);
    console.log(`Player disconnected: ${socket.id}`);
  });
});

// ─── Shared phase resolution (used by both player and admin advance) ──────────

// Returns an error message when the phase cannot be advanced, otherwise null.
function resolveAndAdvance(roomCode: string): string | null {
  const game = gameManager.getGame(roomCode);
  if (!game) return 'No active game';
  // Advancing from the lobby used to jump to night with no roles dealt, and the
  // end-of-game summary then crashed the server.
  if (game.phase === 'lobby') return 'Start the game first. Advance Phase works once roles are dealt.';
  if (game.phase === 'ended') return 'The game is over. Use End Game to clear it.';

  if (game.phase === 'night') {
    const { eliminated } = gameManager.resolveNight(roomCode);

    if (eliminated.length === 0) {
      announce(roomCode, 'The village stirs uneasily. Somehow, everyone survived the night.', 'system');
    }

    for (const player of eliminated) {
      io.to(roomCode).emit('player:eliminated', {
        playerId: player.id,
        playerName: player.name,
        role: player.role.name,
      });
      announce(roomCode, `${player.name} was ${pick(WEREWOLF_DEATHS)}. They were a ${player.role.name}.`, 'system');
    }

    for (const [seerId, investigation] of game.seerInvestigations) {
      const targetName = game.players.get(investigation.targetId)?.name;
      if (targetName) {
        // Decision 5 (2026-11-16): the Seer learns the team, not the exact role
        const team = investigation.team;
        io.to(seerId).emit('seer:investigation', { targetName, team });
        const seerPlayer = game.players.get(seerId);
        announcePrivate(
          seerId,
          `${pick(SEER_WHISPERS)} ${targetName} is on the ${team === 'werewolf' ? 'WEREWOLF' : 'village'} team.`,
          '🔮 The Spirits',
          'seer',
          roomCode,
          `→ ${seerPlayer?.name ?? seerId}`,
        );
      }
    }
  }

  if (game.phase === 'day') {
    const { eliminated, voteCount, tiedNames } = gameManager.resolveDay(roomCode);
    if (eliminated) {
      io.to(roomCode).emit('vote:result', {
        eliminated: eliminated.id,
        eliminatedName: eliminated.name,
        voteCount,
      });
      io.to(roomCode).emit('player:eliminated', {
        playerId: eliminated.id,
        playerName: eliminated.name,
        role: eliminated.role.name,
      });
      announce(
        roomCode,
        `The village has spoken. ${eliminated.name} was ${pick(VOTE_DEATHS)} with ${voteCount} vote${voteCount !== 1 ? 's' : ''}. They were a ${eliminated.role.name}.`,
        'system',
      );
    } else if (tiedNames.length > 1) {
      // Decision D3: a tie at the top eliminates nobody
      announce(roomCode, `The vote is tied between ${tiedNames.join(' and ')}, with ${voteCount} vote${voteCount !== 1 ? 's' : ''} each. No one is eliminated. The werewolves smirk.`, 'system');
    } else {
      announce(roomCode, 'No votes were cast. No one was eliminated. The werewolves smirk.', 'system');
    }
    broadcastAdminVoteUpdate(roomCode);
  }

  const nextPhase = gameManager.advancePhase(roomCode);

  if (nextPhase === 'ended') {
    finishGame(roomCode);
  } else if (nextPhase === 'night' || nextPhase === 'day') {
    const seconds = gameManager.phaseSeconds(game, nextPhase);
    gameManager.updateTimer(roomCode, seconds);
    announce(roomCode, pick(nextPhase === 'night' ? PHASE_NIGHT : PHASE_DAY), 'system');
    io.to(roomCode).emit('phase:changed', { phase: nextPhase, secondsRemaining: seconds });
    broadcastAdminPhaseUpdate(roomCode, nextPhase, seconds);
  }

  broadcastAdminPlayerUpdate(roomCode);
  console.log(`Phase advanced to ${nextPhase} in room ${roomCode}`);
  return null;
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

function getActiveRoomCode(): string | null {
  return gameManager.getActiveRoomCode();
}

function attachAdminToRoom(socket: any, uid: string, roomCode: string) {
  if (!adminWatchers.has(roomCode)) adminWatchers.set(roomCode, new Set());
  adminWatchers.get(roomCode)!.add(socket.id);
  socket.data.roomCode = roomCode;
  socket.data.adminUid = uid;

  socket.emit('admin:authed', { uid, roomCode });

  const fullSnapshot = gameManager.getFullSnapshot(roomCode);
  if (fullSnapshot) {
    socket.emit('admin:state', fullSnapshot);
  }

  console.log(`[Admin] uid=${uid} watching room ${roomCode}`);
}

// ─── Admin namespace ──────────────────────────────────────────────────────────

adminNS.on('connection', (socket: any) => {
  guardSocket(socket);
  console.log(`[Admin] socket connected: ${socket.id}`);

  socket.on('admin:auth', async (data: { token: string }) => {
    const { token } = data;

    const uid = await verifyAdminToken(token);
    if (!uid) {
      socket.emit('error', { message: 'Unauthorized — not an admin account' });
      return;
    }

    // Find the single active game
    const roomCode = getActiveRoomCode();

    if (!roomCode) {
      socket.data.adminUid = uid;
      socket.emit('admin:authed', { uid });
      socket.emit('admin:noGame');
      console.log(`[Admin] uid=${uid} connected — no active game`);
      return;
    }

    attachAdminToRoom(socket, uid, roomCode);
  });

  socket.on('admin:createGame', () => {
    if (!socket.data.adminUid) { socket.emit('error', { message: 'Unauthorized' }); return; }

    // Only allow creating a game when none is active
    if (getActiveRoomCode()) {
      socket.emit('error', { message: 'A game is already active' });
      return;
    }

    const roomCode = Math.random().toString(36).substring(7).toUpperCase();
    gameManager.createGame(roomCode, '', ClassicMode);
    console.log(`[Admin] Game created: ${roomCode}`);

    attachAdminToRoom(socket, socket.data.adminUid, roomCode);
  });

  socket.on('admin:forcePhase', () => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }
    const problem = resolveAndAdvance(roomCode);
    if (problem) socket.emit('error', { message: problem });
  });

  socket.on('admin:changeRole', (data: { playerId: string; roleId: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const newRole = ROLE_REGISTRY[data.roleId];
    if (!newRole) { socket.emit('error', { message: `Unknown role: ${data.roleId}` }); return; }
    const phase = gameManager.getGame(roomCode)?.phase;
    // In the lobby a change was thrown away at Start and left the phone on a broken screen
    if (phase === 'lobby') { socket.emit('error', { message: 'Roles are dealt when the game starts. Change Role works after Start.' }); return; }
    if (phase === 'ended') { socket.emit('error', { message: 'The game is over.' }); return; }

    const player = gameManager.changePlayerRole(roomCode, data.playerId, newRole);
    if (!player) { socket.emit('error', { message: 'Player not found' }); return; }

    // Notify the player of their new role
    io.to(data.playerId).emit('game:started', {
      playerId: data.playerId,
      role: player.role,
      players: Array.from(gameManager.getGame(roomCode)!.players.values()).map((p) => ({
        id: p.id, name: p.name, alive: p.alive,
      })),
    });
    announcePrivate(
      data.playerId,
      `Your role has been changed to ${player.role.name}. ${player.role.description}`,
      '🎭 Role Change',
      'private',
      roomCode,
      `→ ${player.name}`,
    );

    const entry = gameManager.pushAdminLog(roomCode, {
      category: 'system',
      senderName: '🎭 Admin',
      text: `Role of ${player.name} changed to ${player.role.name}`,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
    broadcastAdminPlayerUpdate(roomCode);
  });

  socket.on('admin:eliminate', (data: { playerId: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const player = gameManager.forceEliminate(roomCode, data.playerId);
    if (!player) { socket.emit('error', { message: 'Player not found or already eliminated' }); return; }

    io.to(roomCode).emit('player:eliminated', {
      playerId: player.id,
      playerName: player.name,
      role: player.role.name,
    });
    announce(roomCode, `⚡ ${player.name} was removed from the game by the moderator.`, 'system');
    // The removal can decide the game
    if (gameManager.checkWinNow(roomCode)) finishGame(roomCode);
    broadcastAdminPlayerUpdate(roomCode);
  });

  socket.on('admin:kick', (data: { playerId: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

    const player = game.players.get(data.playerId);
    if (!player) { socket.emit('error', { message: 'Player not found' }); return; }

    // Remove from game state
    game.players.delete(data.playerId);
    dropRejoinTokens(roomCode, data.playerId);
    forgetPlayerChoices(roomCode, data.playerId);

    // Detach their socket from the room
    const playerSocket = io.sockets.sockets.get(data.playerId);
    if (playerSocket) {
      playerSocket.leave(roomCode);
      playerSocket.data.roomCode = undefined;
      playerSocket.emit('player:removed', { message: 'You have been removed from the game by the moderator.' });
    }

    // Notify room
    io.to(roomCode).emit('lobby:updated', { players: publicPlayers(roomCode) });
    if (game.phase === 'day') broadcastVotes(roomCode);
    announce(roomCode, `${player.name} was removed from the game.`, 'system');
    broadcastAdminPlayerUpdate(roomCode);
  });

  socket.on('admin:startGame', () => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const startProblem = gameManager.startGame(roomCode);
    if (startProblem) {
      socket.emit('error', { message: startProblem });
      return;
    }

    const game = gameManager.getGame(roomCode)!;

    for (const [playerId, player] of game.players) {
      if (!playerId.startsWith('bot_')) {
        io.to(playerId).emit('game:started', {
          playerId,
          role: player.role,
          players: Array.from(game.players.values()).map((p) => ({ id: p.id, name: p.name, alive: p.alive })),
        });
        announcePrivate(
          playerId,
          `You are the ${player.role.name}. ${player.role.description}`,
          '🃏 Your Role',
          'private',
          roomCode,
          `→ ${player.name}`,
        );
      }
    }

    announce(roomCode, `The game begins with ${game.players.size} souls. May the innocent survive.`, 'system');
    announce(roomCode, pick(PHASE_NIGHT), 'system');
    const adminStartSeconds = gameManager.phaseSeconds(game, 'night');

    io.to(roomCode).emit('phase:changed', { phase: 'night', secondsRemaining: adminStartSeconds });
    broadcastAdminPlayerUpdate(roomCode);
    broadcastAdminPhaseUpdate(roomCode, 'night', adminStartSeconds);
    console.log(`[Admin] Game started in room ${roomCode}`);
  });

  socket.on('admin:endGame', () => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    // No side won: phones say the moderator ended it, and still show who was what
    io.to(roomCode).emit('game:ended', {
      winner: 'none',
      winReason: 'The moderator ended the game.',
      endedByModerator: true,
      players: gameManager.getGame(roomCode)?.phase === 'lobby' ? [] : playerSummary(roomCode),
    });
    announce(roomCode, '🛑 The game has been ended by the moderator.', 'system');

    const watchers = adminWatchers.get(roomCode);
    adminWatchers.delete(roomCode);
    dropRejoinTokens(roomCode);
    gameManager.deleteGame(roomCode);

    if (watchers) {
      for (const socketId of watchers) {
        const s = adminNS.sockets.get(socketId);
        if (s) {
          s.data.roomCode = undefined;
          s.emit('admin:noGame');
        }
      }
    }
    console.log(`[Admin] Game ${roomCode} ended by admin`);
  });

  socket.on('admin:addPlayer', (data: { playerName: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game) return;
    if (game.phase !== 'lobby') { socket.emit('error', { message: 'Can only add players in lobby' }); return; }
    if (game.players.size >= game.gameMode.maxPlayers) {
      socket.emit('error', { message: `The game is full (${game.gameMode.maxPlayers} players).` });
      return;
    }
    const name = cleanName(data.playerName);
    const badName = nameProblem(roomCode, name);
    if (badName) { socket.emit('error', { message: badName }); return; }

    const botId = `bot_${Math.random().toString(36).slice(2, 10)}`;
    const player = gameManager.addPlayer(roomCode, botId, name);
    if (!player) { socket.emit('error', { message: 'Could not add player' }); return; }

    io.to(roomCode).emit('lobby:updated', { players: publicPlayers(roomCode) });

    const entry = gameManager.pushAdminLog(roomCode, {
      category: 'system',
      senderName: '🎭 Admin',
      text: `Added player: ${player.name}`,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
    broadcastAdminPlayerUpdate(roomCode);
    console.log(`[Admin] Added player ${player.name} (${botId})`);
  });

  socket.on('admin:removePlayer', (data: { playerId: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

    const player = game.players.get(data.playerId);
    if (!player) { socket.emit('error', { message: 'Player not found' }); return; }

    game.players.delete(data.playerId);
    dropRejoinTokens(roomCode, data.playerId);
    forgetPlayerChoices(roomCode, data.playerId);

    if (!data.playerId.startsWith('bot_')) {
      const playerSocket = io.sockets.sockets.get(data.playerId);
      if (playerSocket) {
        playerSocket.leave(roomCode);
        playerSocket.data.roomCode = undefined;
        playerSocket.emit('player:removed', { message: 'You have been removed from the game by the moderator.' });
      }
    }

    io.to(roomCode).emit('lobby:updated', { players: publicPlayers(roomCode) });

    const entry = gameManager.pushAdminLog(roomCode, {
      category: 'system',
      senderName: '🎭 Admin',
      text: `Removed player: ${player.name}`,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
    broadcastAdminPlayerUpdate(roomCode);
  });

  socket.on('admin:renamePlayer', (data: { playerId: string; newName: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const oldName = gameManager.getGame(roomCode)?.players.get(data.playerId)?.name;
    const newName = cleanName(data.newName);
    const badName = nameProblem(roomCode, newName, data.playerId);
    if (badName) { socket.emit('error', { message: badName }); return; }
    const renamed = gameManager.renamePlayer(roomCode, data.playerId, newName);
    if (!renamed) { socket.emit('error', { message: 'Player not found' }); return; }

    const entry = gameManager.pushAdminLog(roomCode, {
      category: 'system',
      senderName: '🎭 Admin',
      text: `Renamed "${oldName}" → "${renamed.name}"`,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
    broadcastAdminPlayerUpdate(roomCode);
  });

  socket.on('admin:castVote', (data: { voterId: string; targetId: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }
    const problem = applyVote(roomCode, data.voterId, data.targetId, true);
    if (problem) socket.emit('error', { message: problem });
  });

  socket.on('admin:submitNightAction', (data: { actorId: string; targetId: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }
    const problem = applyNightAction(roomCode, data.actorId, data.targetId, '[Moderator] ');
    if (problem) socket.emit('error', { message: problem });
  });

  socket.on('admin:randomizeActions', () => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

    const alive = Array.from(game.players.values()).filter((p) => p.alive);

    if (game.phase === 'night') {
      const actors = alive.filter((p) => p.role?.hasNightAction);
      let actorCount = 0;
      for (const actor of actors) {
        // Same rules as a real choice: self only if the role allows, no wolf on wolf
        const eligible = alive.filter((p) =>
          (p.id !== actor.id || actor.role.canTargetSelf) &&
          !(actor.team === 'werewolf' && p.team === 'werewolf'));
        if (eligible.length === 0) continue;
        const target = eligible[Math.floor(Math.random() * eligible.length)];
        if (!applyNightAction(roomCode, actor.id, target.id, '[Auto] ')) actorCount++;
      }
      const summary = gameManager.pushAdminLog(roomCode, {
        category: 'system',
        senderName: '🎲 Admin',
        text: `Randomized night actions for ${actorCount} player(s)`,
      });
      if (summary) emitToAdmins(roomCode, 'admin:logEntry', summary);

    } else if (game.phase === 'day') {
      let voteCount = 0;
      for (const voter of alive) {
        const eligible = alive.filter((p) => p.id !== voter.id);
        if (eligible.length === 0) continue;
        const target = eligible[Math.floor(Math.random() * eligible.length)];
        if (!gameManager.castVote(roomCode, voter.id, target.id)) voteCount++;
      }
      broadcastVotes(roomCode);
      const summary = gameManager.pushAdminLog(roomCode, {
        category: 'system',
        senderName: '🎲 Admin',
        text: `Randomized day votes for ${voteCount} player(s)`,
      });
      if (summary) emitToAdmins(roomCode, 'admin:logEntry', summary);
    }
  });

  socket.on('admin:setTimer', (data: { seconds: number }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game) return;
    const seconds = Number(data.seconds);
    if (!Number.isFinite(seconds) || seconds < 5 || seconds > 3600) {
      socket.emit('error', { message: 'Set the timer between 5 seconds and 60 minutes.' });
      return;
    }
    data.seconds = Math.round(seconds);

    gameManager.updateTimer(roomCode, data.seconds);
    io.to(roomCode).emit('phase:changed', { phase: game.phase, secondsRemaining: data.seconds });
    broadcastAdminPhaseUpdate(roomCode, game.phase, data.seconds);
    console.log(`[Admin] Timer set to ${data.seconds}s in room ${roomCode}`);
  });

  socket.on('disconnect', () => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (roomCode) {
      adminWatchers.get(roomCode)?.delete(socket.id);
      if (adminWatchers.get(roomCode)?.size === 0) adminWatchers.delete(roomCode);
    }
    console.log(`[Admin] socket disconnected: ${socket.id}`);
  });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Last resort: all game state is in memory, so one stray error must not end the night.
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

initFirebaseAdmin().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
  });
});
