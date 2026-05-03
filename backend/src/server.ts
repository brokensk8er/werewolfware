import express, { Express } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameManager } from './engine/gameManager.js';
import { ClassicMode } from './gamemodes/classic.js';
import { ClientEvents, ServerEvents } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app: Express = express();
const httpServer = createServer(app);
const io = new SocketIOServer<ClientEvents, ServerEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const gameManager = new GameManager();
const PORT = process.env.PORT || 3000;

// Serve frontend from /frontend directory (or public)
app.use(express.static(path.join(__dirname, '../../frontend')));
app.use(express.json());

// API routes for development
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Helper to get room code from socket
function getRoomCode(socket: any): string | null {
  for (const room of Object.values(socket.rooms)) {
    if (room !== socket.id) return room as string;
  }
  return null;
}

// Socket.io handlers
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('lobby:create', (data) => {
    const roomCode = Math.random().toString(36).substring(7).toUpperCase();
    const game = gameManager.createGame(roomCode, socket.id, ClassicMode);
    gameManager.addPlayer(roomCode, socket.id, data.playerName);

    socket.join(roomCode);
    socket.emit('lobby:created', { roomCode, playerId: socket.id });
    console.log(`Game created: ${roomCode}`);
  });

  socket.on('lobby:join', (data) => {
    const { roomCode, playerName } = data;
    const game = gameManager.getGame(roomCode);

    if (!game) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const player = gameManager.addPlayer(roomCode, socket.id, playerName);
    if (!player) {
      socket.emit('error', { message: 'Could not join room' });
      return;
    }

    socket.join(roomCode);
    socket.emit('lobby:joined', { roomCode, playerId: socket.id });

    // Notify all players in room of updated lobby
    const snapshot = gameManager.getSnapshot(roomCode);
    io.to(roomCode).emit('lobby:updated', {
      players: snapshot.players.map((p: any) => ({ id: p.id, name: p.name })),
    });
    console.log(`Player ${playerName} joined room ${roomCode}`);
  });

  socket.on('game:start', () => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    if (!gameManager.startGame(roomCode)) {
      socket.emit('error', { message: 'Cannot start game yet' });
      return;
    }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

    // Notify all players game started with their role
    for (const [playerId, player] of game.players) {
      io.to(playerId).emit('game:started', {
        playerId,
        role: player.role,
        players: Array.from(game.players.values()).map((p) => ({
          id: p.id,
          name: p.name,
        })),
      });
    }

    io.to(roomCode).emit('phase:changed', {
      phase: 'night',
      secondsRemaining: 30,
    });

    console.log(`Game started in room ${roomCode}`);
  });

  socket.on('game:advancePhase', () => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const game = gameManager.getGame(roomCode);
    if (!game) return;

    // If ending night phase, resolve night actions
    if (game.phase === 'night') {
      const { eliminated, investigations } = gameManager.resolveNight(roomCode);

      // Broadcast eliminations
      for (const player of eliminated) {
        io.to(roomCode).emit('player:eliminated', {
          playerId: player.id,
          playerName: player.name,
          role: player.role.name,
        });
      }

      // Send investigation results only to seers
      for (const [seerId, investigation] of game.seerInvestigations) {
        const targetName = game.players.get(investigation.targetId)?.name;
        if (targetName) {
          io.to(seerId).emit('seer:investigation', {
            targetName,
            role: investigation.role.name,
          });
        }
      }
    }

    // Clear votes before transitioning
    if (game.phase === 'day') {
      game.dayVotes.clear();
    }

    // Advance to next phase
    const nextPhase = gameManager.advancePhase(roomCode);

    if (nextPhase === 'ended' && game.winner && game.winReason) {
      io.to(roomCode).emit('game:ended', {
        winner: game.winner,
        winReason: game.winReason,
      });
    } else if (nextPhase) {
      io.to(roomCode).emit('phase:changed', {
        phase: nextPhase,
        secondsRemaining: 30,
      });
    }

    console.log(`Phase advanced to ${nextPhase} in room ${roomCode}`);
  });

  socket.on('game:setMode', (data) => {
    // TODO: implement game mode switching in lobby
  });

  socket.on('vote:cast', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const game = gameManager.getGame(roomCode);
    if (!game || game.phase !== 'day') {
      socket.emit('error', { message: 'Not in day phase' });
      return;
    }

    gameManager.castVote(roomCode, socket.id, data.targetId);
    console.log(`Player ${socket.id} voted for ${data.targetId}`);
  });

  socket.on('night:action', (data) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

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
    console.log(`${player.role.name} ${player.name} targeted ${game.players.get(data.targetId)?.name}`);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
