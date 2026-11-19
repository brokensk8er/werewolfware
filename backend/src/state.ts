// Shared server state: the HTTP and socket servers, the game manager, and the maps
// that outlive a single connection.

import express, { Express } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameManager } from './engine/gameManager.js';
import { ClientEvents, ServerEvents } from './types.js';
import { Villager } from './roles/villager.js';
import { Werewolf } from './roles/werewolf.js';
import { Seer } from './roles/seer.js';
import { Doctor } from './roles/doctor.js';
import { Mayor } from './roles/mayor.js';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app: Express = express();

export const httpServer = createServer(app);

export const io = new SocketIOServer<ClientEvents, ServerEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Admin Socket.io namespace
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adminNS: any = io.of('/admin');

// Roles available for on-the-fly changes
export const ROLE_REGISTRY: Record<string, any> = {
  villager: Villager,
  werewolf: Werewolf,
  seer: Seer,
  doctor: Doctor,
  mayor: Mayor,
};

// Track which admin sockets are watching which room: roomCode -> Set<socketId>
export const adminWatchers = new Map<string, Set<string>>();

// Reconnection token -> { roomCode, playerId }
export const rejoinTokens = new Map<string, { roomCode: string; playerId: string }>();

export const gameManager = new GameManager();

export const PORT = process.env.PORT || 3000;
