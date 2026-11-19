// Socket handlers for phones (the default namespace).

import { applyNightAction, applyVote } from '../actions.js';
import { chatTooFast, cleanName, guardSocket, lastChatAt, nameProblem } from '../helpers.js';
import { broadcastAdminPlayerUpdate, broadcastVotes, emitToAdmins, getActiveRoomCode, getRoomCode, noteForAdmins, publicPlayers } from '../messaging.js';
import { gameManager, io, rejoinTokens } from '../state.js';

export function registerPlayerHandlers() {
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
}
