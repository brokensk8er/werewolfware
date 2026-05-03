import { Role, GameState, Player } from '../types';

export const Seer: Role = {
  id: 'seer',
  name: 'Seer',
  team: 'village',
  description: 'A mystical seer. Each night, you learn the true role of another player.',
  canVoteDuringDay: true,
  hasNightAction: true,
  nightAction(game: GameState, player: Player, targetId: string) {
    // TODO: store revealed role info in game state, send only to seer
    const target = game.players.get(targetId);
    if (target) {
      console.log(`Seer ${player.name} investigated ${target.name}: ${target.role.name}`);
    }
  },
};
