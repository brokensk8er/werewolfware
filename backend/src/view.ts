// One complete picture of the game per phone, and one for the moderator panel.
//
// After every handled event the server rebuilds these and sends them out (see
// guardSocket in helpers.ts). Phones redraw from the latest view alone, so opening
// the page, refreshing and reconnecting all take the same path, and nothing a
// phone shows can go stale because one small update forgot something.

import { AdminView, EndResult, GameState, Player, PlayerView, PublicRole, Role } from './types.js';
import { adminWatchers, adminNS, gameManager, io } from './state.js';

export function publicRole(role: Role | null | undefined): PublicRole | null {
  if (!role) return null;
  return {
    id: role.id,
    name: role.name,
    team: role.team,
    description: role.description,
    hasNightAction: role.hasNightAction,
    canTargetSelf: !!role.canTargetSelf,
    canVoteDuringDay: role.canVoteDuringDay,
  };
}

function round(game: GameState): number {
  return game.phase === 'day' ? game.dayNumber : game.nightNumber;
}

/** Results table for the end screen. Safe even if roles were never dealt. */
export function playerSummary(game: GameState): EndResult['players'] {
  return Array.from(game.players.values()).map((p) => ({
    name: p.name,
    role: p.role?.name ?? '—',
    team: p.team,
    alive: p.alive,
    deathCause: p.alive ? 'Survived' : (p.deathCause ?? 'Eliminated'),
  }));
}

function endResult(game: GameState): EndResult | null {
  if (game.phase !== 'ended' || !game.winner) return null;
  return { winner: game.winner, winReason: game.winReason ?? '', endedByModerator: false, players: playerSummary(game) };
}

export function buildPlayerView(game: GameState, player: Player, ended: EndResult | null = endResult(game)): PlayerView {
  const isWolf = player.team === 'werewolf' && !!player.role;
  return {
    roomCode: game.roomCode,
    phase: ended ? 'ended' : game.phase,
    round: round(game),
    secondsRemaining: ended ? 0 : gameManager.secondsRemaining(game),
    you: {
      id: player.id,
      name: player.name,
      alive: player.alive,
      deathCause: player.deathCause,
      role: publicRole(player.role),
      pack: isWolf
        ? Array.from(game.players.values()).filter((p) => p.id !== player.id && p.team === 'werewolf' && p.role).map((p) => p.name)
        : [],
      voteId: game.phase === 'day' ? (game.dayVotes.get(player.id) ?? null) : null,
      nightTargetId: game.phase === 'night' ? (game.nightActions.get(player.id)?.targetId ?? null) : null,
      notes: player.notes,
    },
    players: Array.from(game.players.values()).map((p) => ({ id: p.id, name: p.name, alive: p.alive, connected: p.connected })),
    ended,
  };
}

export function buildAdminView(game: GameState): AdminView {
  return {
    roomCode: game.roomCode,
    phase: game.phase,
    round: round(game),
    secondsRemaining: gameManager.secondsRemaining(game),
    players: Array.from(game.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: publicRole(p.role),
      team: p.team,
      alive: p.alive,
      connected: p.connected,
      acted: game.phase === 'night' ? game.nightActions.has(p.id) : game.phase === 'day' ? game.dayVotes.has(p.id) : false,
    })),
    votes: Array.from(game.dayVotes.entries()).map(([voterId, targetId]) => ({
      voterId,
      voterName: game.players.get(voterId)?.name || 'Unknown',
      targetId,
      targetName: game.players.get(targetId)?.name || 'Unknown',
    })),
  };
}

/** Sends every phone in the game its view, and every watching moderator theirs. */
export function pushViews(roomCode: string, ended?: EndResult) {
  const game = gameManager.getGame(roomCode);
  if (!game) return;
  for (const player of game.players.values()) {
    if (player.id.startsWith('bot_')) continue; // bots have no phone
    io.to(player.id).emit('game:view', buildPlayerView(game, player, ended ?? endResult(game)));
  }
  const watchers = adminWatchers.get(roomCode);
  if (watchers) {
    const view = buildAdminView(game);
    for (const socketId of watchers) (adminNS.to(socketId) as any).emit('admin:view', view);
  }
}
