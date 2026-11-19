// Socket handlers for phones (the default namespace).
//
// A player's id is fixed when they join. Each connection a phone opens is attached
// to that id (see attachPlayerSocket), so a reconnect never changes who they are.
// Every handler here only changes the game; the fresh view each phone needs is
// sent by guardSocket after the handler returns.

import { randomUUID } from 'node:crypto';
import { applyNightAction, applyVote } from '../actions.js';
import { chatTooFast, cleanName, guardSocket, nameProblem } from '../helpers.js';
import { attachPlayerSocket, getActiveRoomCode, getRoomCode, logForAdmins, noteForAdmins, playerStillConnected } from '../messaging.js';
import { gameManager, io, rejoinTokens } from '../state.js';

export function registerPlayerHandlers() {
  io.on('connection', (socket) => {
    guardSocket(socket);
    console.log(`Player connected: ${socket.id}`);

    // Players cannot create, start or advance a game. The moderator panel is the
    // only driver (decision D1).

    const me = () => {
      const roomCode = getRoomCode(socket);
      const playerId: string | undefined = socket.data.playerId;
      const game = roomCode ? gameManager.getGame(roomCode) : undefined;
      const player = game && playerId ? game.players.get(playerId) : undefined;
      return { roomCode, game, player };
    };

    socket.on('lobby:join', (data) => {
      const playerName = cleanName(data.playerName);
      // There is one active game at a time; join it
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
      if (socket.data.playerId && game.players.has(socket.data.playerId)) {
        socket.emit('error', { message: 'You have already joined.' });
        return;
      }

      const player = gameManager.addPlayer(roomCode, randomUUID(), playerName);
      if (!player) {
        socket.emit('error', { message: 'Could not join room' });
        return;
      }

      rejoinTokens.set(player.rejoinToken, { roomCode, playerId: player.id });
      attachPlayerSocket(socket, roomCode, player.id);
      socket.emit('session', { playerId: player.id, token: player.rejoinToken });
      console.log(`Player ${playerName} joined room ${roomCode}`);
    });

    socket.on('game:rejoin', (data) => {
      const entry = rejoinTokens.get(data.token);
      if (!entry) {
        socket.emit('error', { message: 'Rejoin token invalid or expired' });
        return;
      }
      const { roomCode, playerId } = entry;
      const game = gameManager.getGame(roomCode);
      const player = game?.players.get(playerId);
      if (!game || !player) {
        // The game ended, or the moderator removed this player
        rejoinTokens.delete(data.token);
        socket.emit('error', { message: 'You are no longer in this game.' });
        return;
      }

      const wasConnected = player.connected;
      attachPlayerSocket(socket, roomCode, playerId);
      gameManager.setConnected(roomCode, playerId, true);
      socket.emit('session', { playerId, token: data.token });
      socket.emit('chat:history', { messages: game.chatMessages.slice(-30) });
      if (!wasConnected) noteForAdmins(roomCode, `${player.name} reconnected.`);
      console.log(`Player ${player.name} reattached on ${socket.id}`);
    });

    socket.on('vote:cast', (data) => {
      const { roomCode, player } = me();
      if (!roomCode || !player) { socket.emit('error', { message: 'Not in a game' }); return; }
      const problem = applyVote(roomCode, player.id, data.targetId, false);
      if (problem) socket.emit('error', { message: problem });
    });

    socket.on('night:action', (data) => {
      const { roomCode, player } = me();
      if (!roomCode || !player) { socket.emit('error', { message: 'Not in a game' }); return; }
      const problem = applyNightAction(roomCode, player.id, data.targetId);
      if (problem) socket.emit('error', { message: problem });
    });

    socket.on('chat:send', (data) => {
      const { roomCode, player } = me();
      if (!roomCode || !player) { socket.emit('error', { message: 'Not in a game' }); return; }
      if (!player.alive) { socket.emit('error', { message: 'The dead speak only in ghost chat.' }); return; }

      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) return;
      if (text.length > 300) { socket.emit('error', { message: 'Messages can be up to 300 characters.' }); return; }
      if (chatTooFast(player.id)) { socket.emit('error', { message: 'Slow down: one message a second.' }); return; }

      const message = { senderId: player.id, senderName: player.name, text, timestamp: new Date() };
      gameManager.addChatMessage(roomCode, player.id, player.name, text);
      io.to(roomCode).emit('chat:message', message);
      logForAdmins(roomCode, 'chat', player.name, text);
    });

    socket.on('ghost:send', (data) => {
      const { roomCode, game, player } = me();
      if (!roomCode || !game || !player || player.alive) return; // only the dead may ghost-chat

      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) return;
      if (text.length > 300) { socket.emit('error', { message: 'Messages can be up to 300 characters.' }); return; }
      if (chatTooFast(player.id)) { socket.emit('error', { message: 'Slow down: one message a second.' }); return; }

      const msg = { senderId: player.id, senderName: player.name, text, timestamp: new Date() };
      // Relay to every dead real player (bots have no phone)
      for (const p of game.players.values()) {
        if (!p.alive && !p.id.startsWith('bot_')) io.to(p.id).emit('ghost:message', msg);
      }
      logForAdmins(roomCode, 'ghost', player.name, text);
    });

    socket.on('disconnect', () => {
      const { roomCode, player } = me();
      // Only offline once the player's last connection has gone
      if (roomCode && player && !playerStillConnected(player.id)) {
        gameManager.setConnected(roomCode, player.id, false);
        noteForAdmins(roomCode, `${player.name} lost connection.`);
      }
      console.log(`Player disconnected: ${socket.id}`);
    });
  });
}
