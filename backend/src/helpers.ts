// Small rules shared by the player and moderator handlers: names, chat pacing,
// handler guarding, rejoin tokens.

import { gameManager, rejoinTokens } from './state.js';
import { pushViews } from './view.js';

// Forget a removed player's rejoin token so a refresh cannot bring them back.
export function dropRejoinTokens(roomCode: string, playerId?: string) {
  for (const [token, entry] of rejoinTokens) {
    if (entry.roomCode === roomCode && (playerId === undefined || entry.playerId === playerId)) {
      rejoinTokens.delete(token);
    }
  }
}

// Wrap every handler on a socket: a missing payload becomes {}, and a thrown error
// is logged and reported to that one client instead of stopping the server.
// After each handler, every phone and moderator in the room gets a fresh view, so
// no handler has to remember who needs telling about what it changed.
export function guardSocket(socket: any) {
  const rawOn = socket.on.bind(socket);
  socket.on = (event: string, handler: (...args: any[]) => any) =>
    rawOn(event, async (...args: any[]) => {
      const roomBefore: string | undefined = socket.data.roomCode;
      try {
        if (event !== 'disconnect' && (args[0] === null || typeof args[0] !== 'object')) args[0] = {};
        await handler(...args);
      } catch (err) {
        console.error(`[handler] ${event} failed:`, err);
        socket.emit('error', { message: 'That did not work. Please try again.' });
      }
      try {
        const room = socket.data.roomCode ?? roomBefore;
        if (room) pushViews(room);
      } catch (err) {
        console.error(`[views] after ${event} failed:`, err);
      }
    });
}

// Strips control characters and outer spaces from a name typed by a person.
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

// Returns why a name cannot be used in this game, or null if it is fine.
export function nameProblem(roomCode: string, name: string, exceptId?: string): string | null {
  const game = gameManager.getGame(roomCode);
  if (!game) return 'No active game';
  if (name.length < 1 || name.length > 20) return 'Please enter a name of 1 to 20 characters.';
  const lower = name.toLowerCase();
  const taken = Array.from(game.players.values()).some(
    (p) => p.id !== exceptId && (p.name.toLowerCase() === lower || p.name.toLowerCase() === `mayor ${lower}`),
  );
  return taken ? 'That name is taken. Add an initial or a nickname.' : null;
}

// Each player may send chat at most once a second (keyed by player id, so a
// refresh does not reset it).
export const lastChatAt = new Map<string, number>();

export function chatTooFast(playerId: string): boolean {
  const now = Date.now();
  if (now - (lastChatAt.get(playerId) ?? 0) < 1000) return true;
  lastChatAt.set(playerId, now);
  return false;
}
