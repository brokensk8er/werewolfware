import { Role, GameState, Player } from '../types.js';

export const Werewolf: Role = {
  id: 'werewolf',
  name: 'Werewolf',
  team: 'werewolf',
  description: 'A fearsome werewolf. You kill someone each night.',
  canVoteDuringDay: true,
  hasNightAction: true,
  checkWinCondition(game: GameState): boolean {
    const werewolves = Array.from(game.players.values()).filter(
      (p) => p.alive && p.team === 'werewolf'
    ).length;
    const villagers = Array.from(game.players.values()).filter(
      (p) => p.alive && p.team === 'village'
    ).length;
    return werewolves >= villagers;
  },
};
