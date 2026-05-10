import { GameMode, Role } from '../types.js';
import { Villager } from '../roles/villager.js';
import { Werewolf } from '../roles/werewolf.js';
import { Seer } from '../roles/seer.js';
import { Doctor } from '../roles/doctor.js';
import { Mayor } from '../roles/mayor.js';

export const ClassicMode: GameMode = {
  id: 'classic',
  name: 'Classic',
  description: 'Village vs Werewolves — Seer and Doctor included',
  minPlayers: 5,
  maxPlayers: 20,
  getRoles(playerCount: number): Role[] {
    const roles: Role[] = [];

    if (playerCount >= 5) {
      let wolfCount: number;
      if (playerCount <= 7) wolfCount = 1;
      else if (playerCount <= 10) wolfCount = 2;
      else if (playerCount <= 15) wolfCount = 3;
      else wolfCount = 4;

      for (let i = 0; i < wolfCount; i++) roles.push(Werewolf);
      roles.push(Seer);
      roles.push(Doctor);
      roles.push(Mayor);
      for (let i = 0; i < playerCount - wolfCount - 3; i++) {
        roles.push(Villager);
      }
    }

    // Shuffle roles
    return roles.sort(() => Math.random() - 0.5);
  },
};
