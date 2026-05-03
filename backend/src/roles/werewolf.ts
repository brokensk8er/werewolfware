import { Role, GameState, Player } from '../types.js';

export const Werewolf: Role = {
  id: 'werewolf',
  name: 'Werewolf',
  team: 'werewolf',
  description: 'A fearsome werewolf. You kill someone each night.',
  canVoteDuringDay: true,
  hasNightAction: true,
  nightAction(game: GameState, player: Player, targetId: string) {
    // TODO: resolve kill logic — mark target for death
    const target = game.players.get(targetId);
    if (target && target.alive) {
      target.alive = false;
    }
  },
  onDeath(game: GameState, player: Player) {
    // TODO: notify other werewolves or trigger events
  },
  checkWinCondition(game: GameState): boolean {
    // Werewolves win if they equal or outnumber village
    const werewolves = Array.from(game.players.values()).filter(
      (p) => p.alive && p.team === 'werewolf'
    ).length;
    const villagers = Array.from(game.players.values()).filter(
      (p) => p.alive && p.team === 'village'
    ).length;
    return werewolves >= villagers;
  },
};
