import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { registerHandlers, authMiddleware } from './src/socketHandlers.js';
import { register as registerRole } from './src/engine/roleRegistry.js';
import villager from './src/roles/villager.js';
import werewolf from './src/roles/werewolf.js';

registerRole(werewolf);
registerRole(villager);

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Explicit page routes (allows per-route auth middleware later)
app.get('/',       (_req, res) => res.sendFile('index.html',  { root: publicDir }));
app.get('/join',   (_req, res) => res.sendFile('join.html',   { root: publicDir }));
app.get('/player', (_req, res) => res.sendFile('player.html', { root: publicDir }));
app.get('/admin',  (_req, res) => res.sendFile('admin.html',  { root: publicDir }));

// Static assets (js, css, images)
app.use(express.static(publicDir));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Socket.io auth middleware stub — attach identity to socket.data
io.use(authMiddleware);

io.on('connection', (socket) => {
  registerHandlers(io, socket);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Werewolfware running on http://localhost:${PORT}`);
});
