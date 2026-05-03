// Role registry — register() and assignRoles() live here

const registry = new Map();

export function register(roleDef) {
  registry.set(roleDef.id, roleDef);
}

export function getRole(id) {
  return registry.get(id) || null;
}

export function assignRoles(players) {
  const ids = [...players.keys()];
  const total = ids.length;
  const shuffled = [...ids].sort(() => Math.random() - 0.5);

  const specials = [...registry.values()].filter(r => !r.isFiller);
  const filler = [...registry.values()].find(r => r.isFiller);

  const result = new Map();
  let cursor = 0;

  for (const role of specials) {
    const count = role.countFor(total);
    for (let i = 0; i < count && cursor < shuffled.length; i++, cursor++) {
      result.set(shuffled[cursor], role.id);
    }
  }

  while (cursor < shuffled.length) {
    result.set(shuffled[cursor], filler ? filler.id : 'villager');
    cursor++;
  }

  return result;
}
