// Entry point: static files, the health check, handler registration and boot.

import express from 'express';
import path from 'path';
import { initFirebaseAdmin } from './adminAuth.js';
import { registerPlayerHandlers } from './handlers/player.js';
import { registerAdminHandlers } from './handlers/admin.js';
import { PORT, __dirname, app, httpServer } from './state.js';

app.use(express.static(path.join(__dirname, '../frontend')));

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

registerPlayerHandlers();
registerAdminHandlers();

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Last resort: all game state is in memory, so one stray error must not end the night.
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

initFirebaseAdmin().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
  });
});
