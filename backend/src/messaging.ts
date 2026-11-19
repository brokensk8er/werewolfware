// Sending things to phones and to moderator panels. Game state reaches them as
// views (view.ts); this file handles messages, the log and connections.

import { LogCategory } from './types.js';
import { adminNS, adminWatchers, gameManager, io } from './state.js';
import { buildAdminView } from './view.js';

// The room a socket belongs to. Recorded on the socket when a player joins or
// rejoins, because socket.rooms is already empty by the time 'disconnect' fires.
export function getRoomCode(socket: any): string | null {
  return (socket.data?.roomCode as string | undefined) ?? null;
}

// Puts a phone's connection into the game room and into a room named after the
// player's permanent id, so messages to that player reach every tab they have open.
export function attachPlayerSocket(socket: any, roomCode: string, playerId: string) {
  socket.join(roomCode);
  socket.join(playerId);
  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
}

// True if the player still has another connection open (a second tab, or a new
// connection that arrived before the old one timed out).
export function playerStillConnected(playerId: string): boolean {
  return (io.sockets.adapter.rooms.get(playerId)?.size ?? 0) > 0;
}

// Detaches every connection a removed player has and tells them.
export function detachPlayer(roomCode: string, playerId: string, message: string) {
  const ids = io.sockets.adapter.rooms.get(playerId);
  for (const socketId of ids ? [...ids] : []) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    s.emit('player:removed', { message });
    s.leave(roomCode);
    s.leave(playerId);
    s.data.roomCode = undefined;
    s.data.playerId = undefined;
  }
}

// Emit to all admins watching a room
export function emitToAdmins(roomCode: string, event: string, data: any) {
  const watchers = adminWatchers.get(roomCode);
  if (!watchers) return;
  for (const socketId of watchers) {
    (adminNS.to(socketId) as any).emit(event, data);
  }
}

// Moderator-only note. Connection changes go here, not into the room chat:
// with 30 phones sleeping and waking they would bury everything else.
export function noteForAdmins(roomCode: string, text: string) {
  const entry = gameManager.pushAdminLog(roomCode, { category: 'system', senderName: '📶 Connection', text });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
}

// Adds a line to the moderator log.
export function logForAdmins(roomCode: string, category: LogCategory, senderName: string, text: string, meta?: string) {
  const entry = gameManager.pushAdminLog(roomCode, { category, senderName, text, meta });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
}

// Announce to room + log to admin. Kept in the chat history, so a phone that
// refreshes still sees what happened.
export function announce(
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
  gameManager.addChatMessage(roomCode, '__system__', senderName, text);
  logForAdmins(roomCode, category, senderName, text);
}

// Private message to one player + log to admin (with meta). Not kept: anything a
// player needs to keep belongs in their notes (see PlayerView).
export function announcePrivate(
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
  if (roomCode) logForAdmins(roomCode, category, senderName, text, meta);
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

export function getActiveRoomCode(): string | null {
  return gameManager.getActiveRoomCode();
}

export function attachAdminToRoom(socket: any, uid: string, roomCode: string) {
  if (!adminWatchers.has(roomCode)) adminWatchers.set(roomCode, new Set());
  adminWatchers.get(roomCode)!.add(socket.id);
  socket.data.roomCode = roomCode;
  socket.data.adminUid = uid;

  socket.emit('admin:authed', { uid, roomCode });

  // The full log once; after this it streams entry by entry
  const game = gameManager.getGame(roomCode);
  if (game) {
    socket.emit('admin:state', { log: game.adminLog });
    socket.emit('admin:view', buildAdminView(game));
  }

  console.log(`[Admin] uid=${uid} watching room ${roomCode}`);
}
