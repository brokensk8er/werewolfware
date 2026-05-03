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
    // TODO: determine which room this socket belongs to
    // For now, find the game containing this socket
    let roomCode: string | null = null;
    for (const room of Object.values(socket.rooms)) {
      if (room !== socket.id) {
        roomCode = room;
        break;
      }
    }

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

  socket.on('game:setMode', (data) => {
    // TODO: implement game mode switching in lobby
  });

  socket.on('vote:cast', (data) => {
    // TODO: find room, validate player is in day phase, record vote
  });

  socket.on('night:action', (data) => {
    // TODO: find room, validate player has night action, record action
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
