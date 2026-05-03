import { Role, GameState, Player } from '../types.js';

export const Doctor: Role = {
  id: 'doctor',
  name: 'Doctor',
  team: 'village',
  description: 'A skilled doctor. Each night, you can save someone from death.',
  canVoteDuringDay: true,
  hasNightAction: true,
  nightAction(game: GameState, player: Player, targetId: string) {
    // TODO: mark target as protected, apply protection during night resolution
    console.log(`Doctor ${player.name} is protecting ${game.players.get(targetId)?.name}`);
  },
};
