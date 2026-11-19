// Game actions shared by players and the moderator: votes, night choices, phase
// resolution and the end of the game.

import { PHASE_DAY, PHASE_NIGHT, SEER_WHISPERS, VOTE_CAST_AMBIGUOUS, VOTE_CAST_PRIVATE, VOTE_DEATHS, WEREWOLF_DEATHS, pick } from './flavor.js';
import { announce, announcePrivate, broadcastAdminPhaseUpdate, broadcastAdminPlayerUpdate, broadcastAdminVoteUpdate, broadcastVotes, emitToAdmins } from './messaging.js';
import { gameManager, io } from './state.js';

// One path for every day vote, whether a player or the moderator casts it.
// Returns an error message, or null when the vote was recorded.
export function applyVote(roomCode: string, voterId: string, targetId: string, byModerator: boolean): string | null {
  const problem = gameManager.castVote(roomCode, voterId, targetId);
  if (problem) return problem;
  const game = gameManager.getGame(roomCode)!;
  const voter = game.players.get(voterId)!;
  const target = game.players.get(targetId)!;

  broadcastVotes(roomCode);

  // Ambiguous town-wide note: says a vote happened, never who or for whom
  io.to(roomCode).emit('chat:message', {
    senderId: '__system__',
    senderName: '📢 Town Square',
    text: pick(VOTE_CAST_AMBIGUOUS),
    timestamp: new Date(),
  });

  const entry = gameManager.pushAdminLog(roomCode, {
    category: 'town',
    senderName: voter.name,
    text: `${byModerator ? '[Moderator] ' : ''}Voted for ${target.name}`,
  });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);

  // The voter's own phone shows their choice, including one the moderator made for them
  io.to(voterId).emit('vote:recorded', { targetId, targetName: target.name });
  announcePrivate(
    voterId,
    `${byModerator ? 'The moderator recorded your vote' : 'You have voted'} for ${target.name}. ${pick(VOTE_CAST_PRIVATE)}`,
    '🗳️ Your Vote',
    'private',
    roomCode,
    `→ ${voter.name}`,
  );
  return null;
}

// One path for every night choice. Returns an error message, or null.
export function applyNightAction(roomCode: string, actorId: string, targetId: string, label = ''): string | null {
  const problem = gameManager.recordNightAction(roomCode, actorId, targetId);
  if (problem) return problem;
  const game = gameManager.getGame(roomCode)!;
  const actor = game.players.get(actorId)!;
  const target = game.players.get(targetId)!;
  io.to(actorId).emit('night:actionRecorded', { targetId });
  const entry = gameManager.pushAdminLog(roomCode, {
    category: actor.role.id === 'werewolf' ? 'werewolf' : 'seer',
    senderName: actor.name,
    text: `${label}${actor.role.name} ${actor.name} → ${target.name}`,
  });
  if (entry) emitToAdmins(roomCode, 'admin:logEntry', entry);
  return null;
}

// Results table for the end screen. Safe even if roles were never dealt.
export function playerSummary(roomCode: string) {
  const game = gameManager.getGame(roomCode);
  if (!game) return [];
  return Array.from(game.players.values()).map((p) => ({
    name: p.name,
    role: p.role?.name ?? '—',
    team: p.team,
    alive: p.alive,
    deathCause: p.alive ? 'Survived' : (p.deathCause ?? 'Eliminated'),
  }));
}

// Announces a win. The moderator's log is kept so the evening can be recapped;
// it is replaced when the next game is created.
export function finishGame(roomCode: string) {
  const game = gameManager.getGame(roomCode);
  if (!game || !game.winner) return;
  io.to(roomCode).emit('game:ended', { winner: game.winner, winReason: game.winReason ?? '', players: playerSummary(roomCode) });
  announce(roomCode, `⚔️ ${game.winner.toUpperCase()} WIN! ${game.winReason ?? ''}`, 'system');
  broadcastAdminPhaseUpdate(roomCode, 'ended', 0);
}

// A removed player's vote and night action go with them, as do choices aimed at them.
export function forgetPlayerChoices(roomCode: string, playerId: string) {
  const game = gameManager.getGame(roomCode);
  if (!game) return;
  game.dayVotes.delete(playerId);
  for (const [voterId, targetId] of game.dayVotes) if (targetId === playerId) game.dayVotes.delete(voterId);
  game.nightActions.delete(playerId);
  for (const [actorId, action] of game.nightActions) if (action.targetId === playerId) game.nightActions.delete(actorId);
  game.protectedPlayers.delete(playerId);
}

// ─── Shared phase resolution (used by both player and admin advance) ──────────

// Returns an error message when the phase cannot be advanced, otherwise null.
export function resolveAndAdvance(roomCode: string): string | null {
  const game = gameManager.getGame(roomCode);
  if (!game) return 'No active game';
  // Advancing from the lobby used to jump to night with no roles dealt, and the
  // end-of-game summary then crashed the server.
  if (game.phase === 'lobby') return 'Start the game first. Advance Phase works once roles are dealt.';
  if (game.phase === 'ended') return 'The game is over. Use End Game to clear it.';

  if (game.phase === 'night') {
    const { eliminated } = gameManager.resolveNight(roomCode);

    if (eliminated.length === 0) {
      announce(roomCode, 'The village stirs uneasily. Somehow, everyone survived the night.', 'system');
    }

    for (const player of eliminated) {
      io.to(roomCode).emit('player:eliminated', {
        playerId: player.id,
        playerName: player.name,
        role: player.role.name,
      });
      announce(roomCode, `${player.name} was ${pick(WEREWOLF_DEATHS)}. They were a ${player.role.name}.`, 'system');
    }

    for (const [seerId, investigation] of game.seerInvestigations) {
      const targetName = game.players.get(investigation.targetId)?.name;
      if (targetName) {
        // Decision 5 (2026-11-16): the Seer learns the team, not the exact role
        const team = investigation.team;
        io.to(seerId).emit('seer:investigation', { targetName, team });
        const seerPlayer = game.players.get(seerId);
        announcePrivate(
          seerId,
          `${pick(SEER_WHISPERS)} ${targetName} is on the ${team === 'werewolf' ? 'WEREWOLF' : 'village'} team.`,
          '🔮 The Spirits',
          'seer',
          roomCode,
          `→ ${seerPlayer?.name ?? seerId}`,
        );
      }
    }
  }

  if (game.phase === 'day') {
    const { eliminated, voteCount, tiedNames } = gameManager.resolveDay(roomCode);
    if (eliminated) {
      io.to(roomCode).emit('vote:result', {
        eliminated: eliminated.id,
        eliminatedName: eliminated.name,
        voteCount,
      });
      io.to(roomCode).emit('player:eliminated', {
        playerId: eliminated.id,
        playerName: eliminated.name,
        role: eliminated.role.name,
      });
      announce(
        roomCode,
        `The village has spoken. ${eliminated.name} was ${pick(VOTE_DEATHS)} with ${voteCount} vote${voteCount !== 1 ? 's' : ''}. They were a ${eliminated.role.name}.`,
        'system',
      );
    } else if (tiedNames.length > 1) {
      // Decision D3: a tie at the top eliminates nobody
      announce(roomCode, `The vote is tied between ${tiedNames.join(' and ')}, with ${voteCount} vote${voteCount !== 1 ? 's' : ''} each. No one is eliminated. The werewolves smirk.`, 'system');
    } else {
      announce(roomCode, 'No votes were cast. No one was eliminated. The werewolves smirk.', 'system');
    }
    broadcastAdminVoteUpdate(roomCode);
  }

  const nextPhase = gameManager.advancePhase(roomCode);

  if (nextPhase === 'ended') {
    finishGame(roomCode);
  } else if (nextPhase === 'night' || nextPhase === 'day') {
    const seconds = gameManager.phaseSeconds(game, nextPhase);
    gameManager.updateTimer(roomCode, seconds);
    announce(roomCode, pick(nextPhase === 'night' ? PHASE_NIGHT : PHASE_DAY), 'system');
    io.to(roomCode).emit('phase:changed', { phase: nextPhase, secondsRemaining: seconds });
    broadcastAdminPhaseUpdate(roomCode, nextPhase, seconds);
  }

  broadcastAdminPlayerUpdate(roomCode);
  console.log(`Phase advanced to ${nextPhase} in room ${roomCode}`);
  return null;
}
