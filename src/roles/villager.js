export default {
  id: 'villager',
  name: 'Villager',
  emoji: '👤',
  team: 'villagers',
  description: 'Find and eliminate the wolves before they take over.',
  countFor() { return 0; },
  isFiller: true,
  phases: [],
  actions: {},
  snapshotFor() { return {}; },
  hasWon(game) {
    const living = [...game.players.values()].filter(p => p.isAlive);
    return living.every(p => p.role !== 'werewolf');
  },
};
