import { randomUUID } from 'crypto';
import os from 'os';
import qrcode from 'qrcode';
import { PhaseTimer } from './phaseTimer.js';
import { checkWinCondition } from './roles.js';
import { assignRoles } from './engine/roleRegistry.js';

const games = new Map();
let _io = null;

export function init(io) {
  _io = io;
}

function getServerHost() {
  if (process.env.HOST) return process.env.HOST;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

export async function createGame(hostSocketId, hostName, { dayDuration = 120000, nightDuration = 60000 } = {}) {
  const id = 'GAME';
  const port = process.env.PORT || 3000;
  const joinUrl = `http://${getServerHost()}:${port}/join`;
  const qrDataUrl = await qrcode.toDataURL(joinUrl);

  const host = { socketId: hostSocketId, name: hostName, role: null, isAlive: true, isHost: true };
  const game = {
    id,
    hostSocketId,
    phase: 'lobby',
    dayDuration,
    nightDuration,
    phaseEndsAt: null,
    timer: null,
    players: new Map([[hostSocketId, host]]),
    votes: new Map(),
    werewolfTarget: null,
    winner: null,
    messages: { main: [], dead: [], werewolf: [] },
  };
  games.set(id, game);
  return { game, qrDataUrl, joinUrl };
}

export function joinGame(gameId, socketId, playerName) {
  const game = games.get(gameId);
  if (!game) return { error: 'Game not found' };
  if (game.phase === 'ended') return { error: 'Game has ended' };

  // Reconnect: player with this name already exists — update their socket ID
  const existing = [...game.players.values()].find(p => p.name === playerName);
  if (existing) {
    game.players.delete(existing.socketId);
    if (game.hostSocketId === existing.socketId) game.hostSocketId = socketId;
    existing.socketId = socketId;
    game.players.set(socketId, existing);
    return { player: existing, game, reconnected: true };
  }

  // New player joining a lobby
  if (game.phase === 'lobby') {
    const player = { socketId, name: playerName, role: null, isAlive: true, isHost: false };
    game.players.set(socketId, player);
    return { player, game, reconnected: false };
  }

  // New player joining a game in progress — assigned villager role
  const player = { socketId, name: playerName, role: 'villager', isAlive: true, isHost: false };
  game.players.set(socketId, player);
  return { player, game, reconnected: false, lateJoin: true };
}

export function startGame(gameId) {
  const game = games.get(gameId);
  if (!game || game.phase !== 'lobby') return { error: 'Cannot start game' };
  if (game.players.size < 3) return { error: 'Need at least 3 players' };

  const roleMap = assignRoles(game.players);
  for (const [id, role] of roleMap) {
    game.players.get(id).role = role;
  }

  _startPhase(game, 'day');
  return { game };
}

export function setTimers(gameId, dayDuration, nightDuration) {
  const game = games.get(gameId);
  if (!game || game.phase !== 'lobby') return { error: 'Cannot change timers now' };
  game.dayDuration = dayDuration;
  game.nightDuration = nightDuration;
  return { game };
}

export function castVote(gameId, voterSocketId, targetSocketId) {
  const game = games.get(gameId);
  if (!game || game.phase !== 'day') return { error: 'Not day phase' };
  const voter = game.players.get(voterSocketId);
  const target = game.players.get(targetSocketId);
  if (!voter || !voter.isAlive) return { error: 'You cannot vote' };
  if (!target || !target.isAlive) return { error: 'Invalid target' };
  if (voterSocketId === targetSocketId) return { error: 'Cannot vote for yourself' };
  game.votes.set(voterSocketId, targetSocketId);
  return { game };
}

export function setWerewolfTarget(gameId, wolfSocketId, targetSocketId) {
  const game = games.get(gameId);
  if (!game || game.phase !== 'night') return { error: 'Not night phase' };
  const wolf = game.players.get(wolfSocketId);
  const target = game.players.get(targetSocketId);
  if (!wolf || wolf.role !== 'werewolf' || !wolf.isAlive) return { error: 'Not a werewolf' };
  if (!target || !target.isAlive || target.role === 'werewolf') return { error: 'Invalid target' };
  game.werewolfTarget = targetSocketId;
  return { game };
}

export function addMessage(gameId, senderSocketId, room, text) {
  const game = games.get(gameId);
  if (!game) return { error: 'Game not found' };
  const sender = game.players.get(senderSocketId);
  if (!sender) return { error: 'Not in game' };
  if (!sender.isAlive && room !== 'dead') return { error: 'Dead players can only use the dead chat' };
  if (room === 'werewolf' && sender.role !== 'werewolf') return { error: 'Access denied' };
  if (room === 'dead' && sender.isAlive) return { error: 'Living players cannot use dead chat' };
  if (room === 'main' && !sender.isAlive) return { error: 'Dead players cannot use main chat' };

  const msg = {
    id: randomUUID(),
    senderName: sender.name,
    senderId: senderSocketId,
    room,
    text: text.trim().slice(0, 500),
    timestamp: Date.now(),
  };
  game.messages[room].push(msg);
  return { message: msg };
}

export function advancePhase(gameId) {
  const game = games.get(gameId);
  if (!game || game.phase === 'lobby' || game.phase === 'ended') return;
  if (game.timer) game.timer.cancel();

  if (game.phase === 'day') {
    _resolveDayVotes(game);
    const winner = checkWinCondition(game.players);
    if (winner) { _endGame(game, winner); return; }
    _startPhase(game, 'night');
  } else if (game.phase === 'night') {
    _resolveNightKill(game);
    const winner = checkWinCondition(game.players);
    if (winner) { _endGame(game, winner); return; }
    _startPhase(game, 'day');
  }
}

function _startPhase(game, phase) {
  game.phase = phase;
  game.votes = new Map();
  game.werewolfTarget = null;
  const duration = phase === 'day' ? game.dayDuration : game.nightDuration;
  game.phaseEndsAt = Date.now() + duration;

  game.timer = new PhaseTimer(
    game.id,
    duration,
    (secondsRemaining) => {
      _io.to(`game:${game.id}:all`).emit('phase:tick', { secondsRemaining });
    },
    () => advancePhase(game.id),
  );
  game.timer.start();

  _io.to(`game:${game.id}:all`).emit('phase:changed', { phase, phaseEndsAt: game.phaseEndsAt });
}

function _resolveDayVotes(game) {
  const tally = new Map();
  for (const targetId of game.votes.values()) {
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }
  if (tally.size === 0) {
    _io.to(`game:${game.id}:all`).emit('vote:result', { eliminated: null, reason: 'No votes were cast.' });
    return;
  }

  const livingVoters = [...game.players.values()].filter(p => p.isAlive).length;
  const majority = Math.floor(livingVoters / 2) + 1;
  let topId = null, topCount = 0, tied = false;

  for (const [id, count] of tally) {
    if (count > topCount) { topId = id; topCount = count; tied = false; }
    else if (count === topCount) { tied = true; }
  }

  if (tied || topCount < majority) {
    _io.to(`game:${game.id}:all`).emit('vote:result', { eliminated: null, reason: "The village couldn't reach a majority." });
    return;
  }

  _eliminatePlayer(game, topId, 'vote');
}

function _resolveNightKill(game) {
  if (!game.werewolfTarget) {
    _io.to(`game:${game.id}:all`).emit('night:result', { eliminated: null, reason: 'The wolves held back tonight.' });
    return;
  }
  _eliminatePlayer(game, game.werewolfTarget, 'wolf');
}

function _eliminatePlayer(game, socketId, cause) {
  const player = game.players.get(socketId);
  if (!player) return;
  player.isAlive = false;

  const socket = _io.sockets.sockets.get(socketId);
  if (socket) {
    socket.leave(`game:${game.id}:main`);
    socket.join(`game:${game.id}:dead`);
  }

  _io.to(`game:${game.id}:all`).emit('player:eliminated', {
    playerName: player.name,
    playerId: socketId,
    wasWerewolf: player.role === 'werewolf',
    cause,
  });
}

function _endGame(game, winner) {
  game.phase = 'ended';
  game.winner = winner;
  if (game.timer) game.timer.cancel();

  const roles = [...game.players.values()].map(p => ({ name: p.name, role: p.role, isAlive: p.isAlive }));
  _io.to(`game:${game.id}:all`).emit('game:ended', { winner, roles });
}

export function removePlayer(gameId, socketId) {
  const game = games.get(gameId);
  if (!game) return;
  game.players.delete(socketId);
  if (game.phase === 'lobby') {
    _io.to(`game:${game.id}:all`).emit('lobby:updated', { players: getLobbyPlayers(game) });
  }
  if (game.players.size === 0) games.delete(gameId);
}

export function getGame(gameId) {
  return games.get(gameId) || null;
}

export function getPlayer(gameId, socketId) {
  return games.get(gameId)?.players.get(socketId) || null;
}

export function getLobbyPlayers(game) {
  return [...game.players.values()].map(p => ({ socketId: p.socketId, name: p.name, isHost: p.isHost }));
}

export function getStateSnapshot(game, requestingSocketId) {
  const me = game.players.get(requestingSocketId);
  const players = [...game.players.values()].map(p => ({
    socketId: p.socketId,
    name: p.name,
    isAlive: p.isAlive,
    isHost: p.isHost,
    // expose role only for wolves so they can see fellow wolves
    role: (me?.role === 'werewolf' && p.role === 'werewolf') ? 'werewolf' : undefined,
  }));

  const messages = { main: game.messages.main };
  if (me && !me.isAlive) messages.dead = game.messages.dead;
  if (me && me.role === 'werewolf') messages.werewolf = game.messages.werewolf;

  return {
    gameId: game.id,
    phase: game.phase,
    phaseEndsAt: game.phaseEndsAt,
    players,
    myRole: me ? me.role : null,
    myName: me ? me.name : null,
    isHost: me ? me.isHost : false,
    isAlive: me ? me.isAlive : false,
    dayDuration: game.dayDuration,
    nightDuration: game.nightDuration,
    messages,
    winner: game.winner,
  };
}

// Admin-only snapshot: exposes every player's role
export function getAdminSnapshot(game) {
  return {
    gameId: game.id,
    phase: game.phase,
    phaseEndsAt: game.phaseEndsAt,
    dayDuration: game.dayDuration,
    nightDuration: game.nightDuration,
    winner: game.winner,
    players: [...game.players.values()].map(p => ({
      socketId: p.socketId,
      name: p.name,
      role: p.role,
      isAlive: p.isAlive,
      isHost: p.isHost,
    })),
  };
}
