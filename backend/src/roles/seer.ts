import { Role, GameState, Player } from '../types.js';

export const Seer: Role = {
  id: 'seer',
  name: 'Seer',
  team: 'village',
  description: 'A mystical seer. Each night, you learn the true role of another player.',
  canVoteDuringDay: true,
  hasNightAction: true,
};
