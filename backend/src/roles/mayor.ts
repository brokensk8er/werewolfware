import { Role } from '../types.js';

export const Mayor: Role = {
  id: 'mayor',
  name: 'Mayor',
  team: 'village',
  description: 'The elected Mayor. Your vote counts twice during the day.',
  canVoteDuringDay: true,
  hasNightAction: false,
};
