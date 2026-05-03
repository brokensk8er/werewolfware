// Win checker — stubs; wired up in later migration steps

/**
 * Iterate distinct teams in activeRoles. For each role whose team hasn't been
 * checked yet, call role.hasWon(game). Return the winning team string, or null
 * if no team has won yet.
 *
 * @param {object} game        - game object from gameManager
 * @param {Array}  activeRoles - role definition objects for roles with ≥1 living player
 * @returns {string|null} winning team id (e.g. 'villagers', 'werewolves'), or null
 */
export function check(game, activeRoles) {
  return null;
}
