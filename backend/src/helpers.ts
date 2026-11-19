// Small rules shared by the player and moderator handlers: names, chat pacing,
// handler guarding, rejoin tokens.

import { gameManager, rejoinTokens } from './state.js';

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
export function guardSocket(socket: any) {
  const rawOn = socket.on.bind(socket);
  socket.on = (event: string, handler: (...args: any[]) => any) =>
    rawOn(event, async (...args: any[]) => {
      try {
        if (event !== 'disconnect' && (args[0] === null || typeof args[0] !== 'object')) args[0] = {};
        await handler(...args);
      } catch (err) {
        console.error(`[handler] ${event} failed:`, err);
        socket.emit('error', { message: 'That did not work. Please try again.' });
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

// Phones may send chat at most once a second each.
export const lastChatAt = new Map<string, number>();

export function chatTooFast(socketId: string): boolean {
  const now = Date.now();
  if (now - (lastChatAt.get(socketId) ?? 0) < 1000) return true;
  lastChatAt.set(socketId, now);
  return false;
}
