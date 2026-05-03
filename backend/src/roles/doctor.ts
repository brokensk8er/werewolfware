import { Role, GameState, Player } from '../types.js';

export const Doctor: Role = {
  id: 'doctor',
  name: 'Doctor',
  team: 'village',
  description: 'A skilled doctor. Each night, you can save someone from death.',
  canVoteDuringDay: true,
  hasNightAction: true,
};
