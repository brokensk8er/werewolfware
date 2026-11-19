// Socket handlers for the moderator panel (the /admin namespace).

import { ClassicMode } from '../gamemodes/classic.js';
import { applyNightAction, applyVote, finishGame, forgetPlayerChoices, playerSummary, resolveAndAdvance } from '../actions.js';
import { verifyAdminToken } from '../adminAuth.js';
import { PHASE_NIGHT, pick } from '../flavor.js';
import { cleanName, dropRejoinTokens, guardSocket, nameProblem } from '../helpers.js';
import { announce, announcePrivate, attachAdminToRoom, broadcastAdminPhaseUpdate, broadcastAdminPlayerUpdate, broadcastVotes, emitToAdmins, getActiveRoomCode, publicPlayers } from '../messaging.js';
import { ROLE_REGISTRY, adminNS, adminWatchers, gameManager, io } from '../state.js';

export function registerAdminHandlers() {
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
}
