import * as gm from './gameManager.js';

// Auth middleware stub — attaches identity from handshake to socket.data.
// Replace next() logic here with Firebase ID token verification when auth is added.
export function authMiddleware(socket, next) {
  const { playerName, gameId, isAdmin } = socket.handshake.auth;
  socket.data.playerName = playerName || null;
  socket.data.gameId = gameId || null;
  socket.data.isAdmin = !!isAdmin;
  next();
}

export function registerHandlers(io, socket) {
  gm.init(io);

  // ---- game:create (admin) ----
  socket.on('game:create', async ({ hostName, dayDuration, nightDuration }) => {
    if (!hostName?.trim()) return socket.emit('error', { code: 'INVALID', message: 'Name required' });
    const { game, qrDataUrl, joinUrl } = await gm.createGame(socket.id, hostName.trim(), { dayDuration, nightDuration });
    socket.join(`game:${game.id}:all`);
    socket.join(`game:${game.id}:admin`);
    socket.emit('game:created', { gameId: game.id, qrDataUrl, joinUrl });
    socket.emit('admin:state', gm.getAdminSnapshot(game));
  });

  // ---- game:join (player) ----
  socket.on('game:join', ({ gameId, playerName }) => {
    if (!gameId || !playerName?.trim()) return socket.emit('error', { code: 'INVALID', message: 'Game ID and name required' });
    const result = gm.joinGame(gameId.toUpperCase(), socket.id, playerName.trim());
    if (result.error) return socket.emit('error', { code: 'JOIN_FAILED', message: result.error });

    const { game, player, lateJoin } = result;

    // Set up socket room membership based on current player state
    _enforceRoomMembership(socket, game, player);

    socket.emit('game:state', gm.getStateSnapshot(game, socket.id));

    if (game.phase === 'lobby') {
      io.to(`game:${game.id}:all`).emit('lobby:updated', { players: gm.getLobbyPlayers(game) });
      io.to(`game:${game.id}:admin`).emit('admin:state', gm.getAdminSnapshot(game));
    } else if (lateJoin) {
      // Notify everyone a player joined mid-game
      io.to(`game:${game.id}:all`).emit('player:lateJoin', { playerName: player.name, role: player.role });
      io.to(`game:${game.id}:admin`).emit('admin:state', gm.getAdminSnapshot(game));
    }
  });

  // ---- game:start (admin) ----
  socket.on('game:start', ({ gameId }) => {
    const game = gm.getGame(gameId);
    if (!game) return socket.emit('error', { code: 'NOT_FOUND', message: 'Game not found' });
    if (game.hostSocketId !== socket.id) return socket.emit('error', { code: 'FORBIDDEN', message: 'Only the host can start' });
    const result = gm.startGame(gameId);
    if (result.error) return socket.emit('error', { code: 'START_FAILED', message: result.error });

    for (const player of result.game.players.values()) {
      const playerSocket = io.sockets.sockets.get(player.socketId);
      if (playerSocket) {
        if (player.role === 'werewolf') playerSocket.join(`game:${gameId}:werewolf`);
        playerSocket.emit('game:started', {
          role: player.role,
          phase: result.game.phase,
          phaseEndsAt: result.game.phaseEndsAt,
        });
        playerSocket.emit('game:state', gm.getStateSnapshot(result.game, player.socketId));
      }
    }

    // Send admin the full role-aware snapshot
    io.to(`game:${gameId}:admin`).emit('admin:state', gm.getAdminSnapshot(result.game));
  });

  // ---- game:advancePhase (admin) ----
  socket.on('game:advancePhase', ({ gameId }) => {
    const game = gm.getGame(gameId);
    if (!game) return socket.emit('error', { code: 'NOT_FOUND', message: 'Game not found' });
    if (game.hostSocketId !== socket.id) return socket.emit('error', { code: 'FORBIDDEN', message: 'Only the host can advance phase' });
    gm.advancePhase(gameId);
  });

  // ---- game:setTimers (admin) ----
  socket.on('game:setTimers', ({ gameId, dayDuration, nightDuration }) => {
    const game = gm.getGame(gameId);
    if (!game) return socket.emit('error', { code: 'NOT_FOUND', message: 'Game not found' });
    if (game.hostSocketId !== socket.id) return socket.emit('error', { code: 'FORBIDDEN', message: 'Only the host can change timers' });
    gm.setTimers(gameId, dayDuration, nightDuration);
  });

  // ---- vote:cast (player) ----
  socket.on('vote:cast', ({ gameId, targetId }) => {
    const result = gm.castVote(gameId, socket.id, targetId);
    if (result.error) return socket.emit('error', { code: 'VOTE_FAILED', message: result.error });
    const tally = _buildVoteTally(result.game);
    io.to(`game:${gameId}:all`).emit('vote:updated', { votes: tally });
    io.to(`game:${gameId}:admin`).emit('vote:updated', { votes: tally });
  });

  // ---- werewolf:target (player) ----
  socket.on('werewolf:target', ({ gameId, targetId }) => {
    const result = gm.setWerewolfTarget(gameId, socket.id, targetId);
    if (result.error) return socket.emit('error', { code: 'TARGET_FAILED', message: result.error });
    const wolf = gm.getPlayer(gameId, socket.id);
    io.to(`game:${gameId}:werewolf`).emit('werewolf:targetSelected', {
      byName: wolf.name,
      targetId,
      targetName: result.game.players.get(targetId)?.name,
    });
  });

  // ---- chat:send ----
  socket.on('chat:send', ({ gameId, room, text }) => {
    if (!text?.trim()) return;
    if (!['main', 'dead', 'werewolf'].includes(room)) return socket.emit('error', { code: 'INVALID', message: 'Invalid chat room' });
    const result = gm.addMessage(gameId, socket.id, room, text);
    if (result.error) return socket.emit('error', { code: 'CHAT_FAILED', message: result.error });
    io.to(`game:${gameId}:${room}`).emit('chat:message', result.message);
  });

  // ---- disconnect ----
  socket.on('disconnect', () => {
    for (const room of socket.rooms) {
      const match = room.match(/^game:([^:]+):all$/);
      if (match) gm.removePlayer(match[1], socket.id);
    }
  });
}

// ---- helpers ----

function _enforceRoomMembership(socket, game, player) {
  socket.join(`game:${game.id}:all`);
  if (player.isAlive) {
    socket.join(`game:${game.id}:main`);
  } else {
    socket.join(`game:${game.id}:dead`);
  }
  if (player.role === 'werewolf') {
    socket.join(`game:${game.id}:werewolf`);
  }
}

function _buildVoteTally(game) {
  const counts = new Map();
  for (const targetId of game.votes.values()) {
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => ({
    targetId: id,
    targetName: game.players.get(id)?.name,
    count,
  }));
}
