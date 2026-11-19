// Sending things to phones and to moderator panels.

import { LogCategory } from './types.js';
import { adminNS, adminWatchers, gameManager, io } from './state.js';

// Helper to get room code from socket. The room is recorded on the socket when a
// player joins or rejoins, because socket.rooms is already empty by the time the
// 'disconnect' event fires.
export function getRoomCode(socket: any): string | null {
  if (socket.data?.roomCode) return socket.data.roomCode as string;
  for (const room of socket.rooms) {
    if (room !== socket.id) return room as string;
  }
  return null;
}

// Emit to all admins watching a room
export function emitToAdmins(roomCode: string, event: string, data: any) {
  const watchers = adminWatchers.get(roomCode);
  if (!watchers) return;
  for (const socketId of watchers) {
    (adminNS.to(socketId) as any).emit(event, data);
  }
}

export function broadcastAdminPlayerUpdate(roomCode: string) {
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

export function broadcastAdminPhaseUpdate(roomCode: string, phase: string, secondsRemaining: number) {
  emitToAdmins(roomCode, 'admin:phaseUpdate', { phase, secondsRemaining });
}

export function broadcastAdminVoteUpdate(roomCode: string) {
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
export function publicPlayers(roomCode: string) {
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
export function noteForAdmins(roomCode: string, text: string) {
  const entry = gameManager.pushAdminLog(roomCode, { category: 'system', senderName: '📶 Connection', text });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
}

// Votes are hidden from phones until voting closes (decision 4, 2026-11-16), so
// only the moderator receives the running tally. Player ids change on reconnect,
// so it is resent after a reconnect or a removal.
export function broadcastVotes(roomCode: string) {
  broadcastAdminVoteUpdate(roomCode);
}

// Announce to room + log to admin
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
  const entry = gameManager.pushAdminLog(roomCode, { category, senderName, text });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
}

// Private message to one player + log to admin (with meta)
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
  if (roomCode) {
    const entry = gameManager.pushAdminLog(roomCode, { category, senderName, text, meta });
    if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
  }
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

  const fullSnapshot = gameManager.getFullSnapshot(roomCode);
  if (fullSnapshot) {
    socket.emit('admin:state', fullSnapshot);
  }

  console.log(`[Admin] uid=${uid} watching room ${roomCode}`);
}
