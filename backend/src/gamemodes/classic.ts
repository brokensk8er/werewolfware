import { GameMode, Role } from '../types';
import { Villager } from '../roles/villager';
import { Werewolf } from '../roles/werewolf';
import { Seer } from '../roles/seer';
import { Doctor } from '../roles/doctor';

export const ClassicMode: GameMode = {
  id: 'classic',
  name: 'Classic',
  description: 'Village vs Werewolves — Seer and Doctor included',
  minPlayers: 5,
  maxPlayers: 20,
  getRoles(playerCount: number): Role[] {
    // TODO: balance these counts based on player count
    const roles: Role[] = [];

    // Example: for 5-8 players, use 1 werewolf, 1 seer, 1 doctor, rest villagers
    if (playerCount >= 5) {
      roles.push(Werewolf);
      roles.push(Seer);
      roles.push(Doctor);
      for (let i = 0; i < playerCount - 3; i++) {
        roles.push(Villager);
      }
    }

    // Shuffle roles
    return roles.sort(() => Math.random() - 0.5);
  },
};
