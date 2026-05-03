import { Role } from '../types';

export const Villager: Role = {
  id: 'villager',
  name: 'Villager',
  team: 'village',
  description: 'A humble villager. You have no special powers.',
  canVoteDuringDay: true,
  hasNightAction: false,
};
