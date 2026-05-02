export function assignRoles(players) {
  const ids = [...players.keys()];
  const wolfCount = Math.max(1, Math.floor(ids.length / 3));
  const shuffled = ids.sort(() => Math.random() - 0.5);
  const roles = new Map();
  shuffled.forEach((id, i) => {
    roles.set(id, i < wolfCount ? 'werewolf' : 'villager');
  });
  return roles;
}

export function checkWinCondition(players) {
  const living = [...players.values()].filter(p => p.isAlive);
  const wolves = living.filter(p => p.role === 'werewolf').length;
  const villagers = living.filter(p => p.role === 'villager').length;
  if (wolves === 0) return 'villagers';
  if (wolves >= villagers) return 'werewolves';
  return null;
}
