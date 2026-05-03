export function checkWinCondition(players) {
  const living = [...players.values()].filter(p => p.isAlive);
  const wolves = living.filter(p => p.role === 'werewolf').length;
  const villagers = living.filter(p => p.role === 'villager').length;
  if (wolves === 0) return 'villagers';
  if (wolves >= villagers) return 'werewolves';
  return null;
}
