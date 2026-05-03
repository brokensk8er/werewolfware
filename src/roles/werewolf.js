function tallyByTarget(recordedActions) {
  const tally = new Map();
  for (const action of recordedActions.values()) {
    const { targetId } = action;
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }
  return tally;
}

function pickConsensus(tally) {
  if (tally.size === 0) return null;
  let topId = null, topCount = 0, tied = false;
  for (const [id, count] of tally) {
    if (count > topCount) { topId = id; topCount = count; tied = false; }
    else if (count === topCount) { tied = true; }
  }
  return tied ? null : topId;
}

export default {
  id: 'werewolf',
  name: 'Werewolf',
  emoji: '🐺',
  team: 'werewolves',
  description: 'Eliminate villagers under cover of night.',

  countFor(totalPlayers) {
    return Math.max(1, Math.floor(totalPlayers / 3));
  },

  phases: [
    {
      id: 'night:werewolf',
      order: 200,
      durationKey: 'nightDuration',
      chatRoom: 'werewolf',
      allowedActions: ['wolf:select'],
      resolve(ctx) {
        const tally = tallyByTarget(ctx.recordedActions);
        const target = pickConsensus(tally);
        if (target) ctx.eliminate(target, 'wolf');
        else ctx.broadcast('night:result', { reason: 'The wolves disagreed.' });
      },
    },
  ],

  actions: {
    'wolf:select': {
      phase: 'night:werewolf',
      validate(ctx, payload) {
        const target = ctx.game.players.get(payload.targetId);
        return target?.isAlive && target.role !== 'werewolf';
      },
      apply(ctx, payload) {
        ctx.recordAction({ actorId: ctx.actor.socketId, targetId: payload.targetId });
        ctx.broadcastToRoom('werewolf', 'wolf:selectionUpdate', {
          byName: ctx.actor.name,
          targetName: ctx.game.players.get(payload.targetId).name,
        });
      },
    },
  },

  snapshotFor(game, me) {
    if (me.role !== 'werewolf') return {};
    return {
      teammates: [...game.players.values()]
        .filter(p => p.role === 'werewolf' && p.socketId !== me.socketId)
        .map(p => ({ socketId: p.socketId, name: p.name })),
    };
  },

  hasWon(game) {
    const living = [...game.players.values()].filter(p => p.isAlive);
    const wolves = living.filter(p => p.role === 'werewolf').length;
    const others = living.length - wolves;
    return wolves > 0 && wolves >= others;
  },
};
