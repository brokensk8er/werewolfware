// Action registry — stubs; wired up in later migration steps

const actions = new Map();

export function register(actionId, definition) {
  actions.set(actionId, definition);
}

export function dispatch(game, actor, actionId, payload) {
  return { error: 'Action registry not yet wired' };
}
