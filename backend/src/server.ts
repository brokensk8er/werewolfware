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
};

// Track which admin sockets are watching which room: roomCode -> Set<socketId>
const adminWatchers = new Map<string, Set<string>>();

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

async function verifyAdminToken(token: string): Promise<string | null> {
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

// Helper to get room code from socket
function getRoomCode(socket: any): string | null {
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
  console.log(`Player connected: ${socket.id}`);

  socket.on('lobby:create', (data) => {
    const roomCode = Math.random().toString(36).substring(7).toUpperCase();
    gameManager.createGame(roomCode, socket.id, ClassicMode);
    gameManager.addPlayer(roomCode, socket.id, data.playerName);

    socket.join(roomCode);
    socket.emit('lobby:created', { roomCode, playerId: socket.id });

    const snapshot = gameManager.getSnapshot(roomCode);
    io.to(roomCode).emit('lobby:updated', {
      players: snapshot.players.map((p: any) => ({ id: p.id, name: p.name })),
    });
    broadcastAdminPlayerUpdate(roomCode);
    console.log(`Game created: ${roomCode}`);
  });

  socket.on('lobby:join', (data) => {
    const { playerName } = data;
    // Auto-resolve the single active game; ignore any client-supplied roomCode
    const roomCode = getActiveRoomCode();
    const game = roomCode ? gameManager.getGame(roomCode) : null;

    if (!game || !roomCode) {
      socket.emit('error', { message: 'No active game found' });
      return;
    }

    const player = gameManager.addPlayer(roomCode, socket.id, playerName);
    if (!player) {
      socket.emit('error', { message: 'Could not join room' });
      return;
    }

    socket.join(roomCode);
    socket.emit('lobby:joined', { roomCode, playerId: socket.id });

    const snapshot = gameManager.getSnapshot(roomCode);
    io.to(roomCode).emit('lobby:updated', {
      players: snapshot.players.map((p: any) => ({ id: p.id, name: p.name })),
    });
    broadcastAdminPlayerUpdate(roomCode);
    console.log(`Player ${playerName} joined room ${roomCode}`);
  });

  socket.on('game:start', () => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) { socket.emit('error', { message: 'Not in a room' }); return; }

    if (!gameManager.startGame(roomCode)) {
      socket.emit('error', { message: 'Cannot start game yet' });
      return;
    }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

    for (const [playerId, player] of game.players) {
      io.to(playerId).emit('game:started', {
        playerId,
        role: player.role,
        players: Array.from(game.players.values()).map((p) => ({
          id: p.id,
          name: p.name,
          alive: p.alive,
        })),
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

    announce(roomCode, `The game begins with ${game.players.size} souls. May the innocent survive.`, 'system');
    announce(roomCode, pick(PHASE_NIGHT), 'system');
    const startSeconds = game.customPhaseDuration ?? 30;

    io.to(roomCode).emit('phase:changed', { phase: 'night', secondsRemaining: startSeconds });
    broadcastAdminPlayerUpdate(roomCode);
    broadcastAdminPhaseUpdate(roomCode, 'night', startSeconds);
    console.log(`Game started in room ${roomCode}`);
  });

  socket.on('game:advancePhase', () => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) { socket.emit('error', { message: 'Not in a room' }); return; }
    resolveAndAdvance(roomCode);
  });

  socket.on('game:setMode', (_data) => {
    // TODO: implement game mode switching in lobby
  });

  socket.on('vote:cast', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) { socket.emit('error', { message: 'Not in a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game || game.phase !== 'day') {
      socket.emit('error', { message: 'Not in day phase' });
      return;
    }

    const voter = game.players.get(socket.id);
    if (!voter) return;

    gameManager.castVote(roomCode, socket.id, data.targetId);
    const target = game.players.get(data.targetId);

    const votes = Array.from(game.dayVotes.entries()).map(([voterId, targetId]) => ({
      voterId,
      voterName: game.players.get(voterId)?.name || 'Unknown',
      targetId,
      targetName: game.players.get(targetId)?.name || 'Unknown',
    }));

    io.to(roomCode).emit('vote:updated', { votes });
    emitToAdmins(roomCode, 'admin:voteUpdate', { votes });

    // Ambiguous town-wide message (players only — not logged to admin)
    io.to(roomCode).emit('chat:message', {
      senderId: '__system__',
      senderName: '📢 Town Square',
      text: pick(VOTE_CAST_AMBIGUOUS),
      timestamp: new Date(),
    });

    // Clear admin log entry
    const voteEntry = gameManager.pushAdminLog(roomCode, {
      category: 'town',
      senderName: voter.name,
      text: `Voted for ${target?.name ?? 'unknown'}`,
    });
    if (voteEntry) emitToAdmins(roomCode, 'admin:logEntry', voteEntry);

    // Private confirmation to voter
    announcePrivate(
      socket.id,
      `You have voted for ${target?.name ?? 'someone'}. ${pick(VOTE_CAST_PRIVATE)}`,
      '🗳️ Your Vote',
      'private',
      roomCode,
      `→ ${voter.name}`,
    );

    console.log(`${voter.name} voted for ${target?.name}`);
  });

  socket.on('night:action', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) { socket.emit('error', { message: 'Not in a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game || game.phase !== 'night') {
      socket.emit('error', { message: 'Not in night phase' });
      return;
    }

    const player = game.players.get(socket.id);
    if (!player || !player.role.hasNightAction) {
      socket.emit('error', { message: 'You do not have a night action' });
      return;
    }

    gameManager.recordNightAction(roomCode, socket.id, data.targetId);
    socket.emit('night:actionRecorded', { targetId: data.targetId });

    const target = game.players.get(data.targetId);
    const logText = `${player.role.name} ${player.name} targeted ${target?.name ?? data.targetId}`;
    const entry = gameManager.pushAdminLog(roomCode, {
      category: player.role.id === 'werewolf' ? 'werewolf' : 'seer',
      senderName: player.name,
      text: logText,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
    console.log(logText);
  });

  socket.on('chat:send', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) { socket.emit('error', { message: 'Not in a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

    const sender = game.players.get(socket.id);
    if (!sender) return;

    const message = {
      senderId: socket.id,
      senderName: sender.name,
      text: data.text,
      timestamp: new Date(),
    };

    gameManager.addChatMessage(roomCode, socket.id, sender.name, data.text);
    io.to(roomCode).emit('chat:message', message);

    const entry = gameManager.pushAdminLog(roomCode, {
      category: 'chat',
      senderName: sender.name,
      text: data.text,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
    console.log(`${sender.name}: ${data.text}`);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

// ─── Shared phase resolution (used by both player and admin advance) ──────────

function resolveAndAdvance(roomCode: string) {
  const game = gameManager.getGame(roomCode);
  if (!game) return;

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
        io.to(seerId).emit('seer:investigation', { targetName, role: investigation.role.name });
        const seerPlayer = game.players.get(seerId);
        announcePrivate(
          seerId,
          `${pick(SEER_WHISPERS)} ${targetName} is a ${investigation.role.name}.`,
          '🔮 The Spirits',
          'seer',
          roomCode,
          `→ ${seerPlayer?.name ?? seerId}`,
        );
      }
    }
  }

  if (game.phase === 'day') {
    const { eliminated, voteCount } = gameManager.resolveDay(roomCode);
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
    } else {
      announce(roomCode, 'The vote was inconclusive. No one was eliminated. The werewolves smirk.', 'system');
    }
    broadcastAdminVoteUpdate(roomCode);
  }

  const nextPhase = gameManager.advancePhase(roomCode);

  if (nextPhase === 'ended' && game.winner && game.winReason) {
    io.to(roomCode).emit('game:ended', { winner: game.winner, winReason: game.winReason });
    announce(roomCode, `⚔️ ${game.winner.toUpperCase()} WIN! ${game.winReason}`, 'system');
    broadcastAdminPhaseUpdate(roomCode, 'ended', 0);
  } else if (nextPhase === 'night' || nextPhase === 'day') {
    const seconds = game.customPhaseDuration ?? 30;
    gameManager.updateTimer(roomCode, seconds);
    announce(roomCode, pick(nextPhase === 'night' ? PHASE_NIGHT : PHASE_DAY), 'system');
    io.to(roomCode).emit('phase:changed', { phase: nextPhase, secondsRemaining: seconds });
    broadcastAdminPhaseUpdate(roomCode, nextPhase, seconds);
  }

  broadcastAdminPlayerUpdate(roomCode);
  console.log(`Phase advanced to ${nextPhase} in room ${roomCode}`);
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
    resolveAndAdvance(roomCode);
  });

  socket.on('admin:changeRole', (data: { playerId: string; roleId: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const newRole = ROLE_REGISTRY[data.roleId];
    if (!newRole) { socket.emit('error', { message: `Unknown role: ${data.roleId}` }); return; }

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

    // Disconnect their socket
    const playerSocket = io.sockets.sockets.get(data.playerId);
    if (playerSocket) {
      playerSocket.leave(roomCode);
      playerSocket.emit('error', { message: 'You have been removed from the game by the moderator.' });
    }

    // Notify room
    const snapshot = gameManager.getSnapshot(roomCode);
    io.to(roomCode).emit('lobby:updated', {
      players: snapshot.players.map((p: any) => ({ id: p.id, name: p.name })),
    });
    announce(roomCode, `${player.name} was removed from the game.`, 'system');
    broadcastAdminPlayerUpdate(roomCode);
  });

  socket.on('admin:startGame', () => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    if (!gameManager.startGame(roomCode)) {
      socket.emit('error', { message: `Need at least ${5} players to start` });
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
    const adminStartSeconds = game.customPhaseDuration ?? 30;

    io.to(roomCode).emit('phase:changed', { phase: 'night', secondsRemaining: adminStartSeconds });
    broadcastAdminPlayerUpdate(roomCode);
    broadcastAdminPhaseUpdate(roomCode, 'night', adminStartSeconds);
    console.log(`[Admin] Game started in room ${roomCode}`);
  });

  socket.on('admin:endGame', () => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    io.to(roomCode).emit('game:ended', { winner: 'village' as any, winReason: 'Game ended by moderator.' });
    announce(roomCode, '🛑 The game has been ended by the moderator.', 'system');

    const watchers = adminWatchers.get(roomCode);
    adminWatchers.delete(roomCode);
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

    const botId = `bot_${Math.random().toString(36).slice(2, 10)}`;
    const player = gameManager.addPlayer(roomCode, botId, data.playerName.trim());
    if (!player) { socket.emit('error', { message: 'Could not add player' }); return; }

    const snapshot = gameManager.getSnapshot(roomCode);
    io.to(roomCode).emit('lobby:updated', {
      players: snapshot.players.map((p: any) => ({ id: p.id, name: p.name })),
    });

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

    if (!data.playerId.startsWith('bot_')) {
      const playerSocket = io.sockets.sockets.get(data.playerId);
      if (playerSocket) {
        playerSocket.leave(roomCode);
        playerSocket.emit('error', { message: 'You have been removed from the game by the moderator.' });
      }
    }

    const snapshot = gameManager.getSnapshot(roomCode);
    io.to(roomCode).emit('lobby:updated', {
      players: snapshot.players.map((p: any) => ({ id: p.id, name: p.name })),
    });

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
    const renamed = gameManager.renamePlayer(roomCode, data.playerId, data.newName.trim());
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

    const game = gameManager.getGame(roomCode);
    if (!game || game.phase !== 'day') { socket.emit('error', { message: 'Not in day phase' }); return; }

    gameManager.castVote(roomCode, data.voterId, data.targetId);

    const votes = Array.from(game.dayVotes.entries()).map(([voterId, targetId]) => ({
      voterId,
      voterName: game.players.get(voterId)?.name || 'Unknown',
      targetId,
      targetName: game.players.get(targetId)?.name || 'Unknown',
    }));
    io.to(roomCode).emit('vote:updated', { votes });
    emitToAdmins(roomCode, 'admin:voteUpdate', { votes });
  });

  socket.on('admin:submitNightAction', (data: { actorId: string; targetId: string }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game || game.phase !== 'night') { socket.emit('error', { message: 'Not in night phase' }); return; }

    const actor = game.players.get(data.actorId);
    if (!actor || !actor.role?.hasNightAction) { socket.emit('error', { message: 'Player has no night action' }); return; }

    gameManager.recordNightAction(roomCode, data.actorId, data.targetId);

    const target = game.players.get(data.targetId);
    const logText = `${actor.role.name} ${actor.name} targeted ${target?.name ?? data.targetId}`;
    const entry = gameManager.pushAdminLog(roomCode, {
      category: actor.role.id === 'werewolf' ? 'werewolf' : 'seer',
      senderName: actor.name,
      text: logText,
    });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
  });

  socket.on('admin:setTimer', (data: { seconds: number }) => {
    const roomCode: string | undefined = socket.data.roomCode;
    if (!roomCode) { socket.emit('error', { message: 'Not watching a room' }); return; }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

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

initFirebaseAdmin().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
  });
});
