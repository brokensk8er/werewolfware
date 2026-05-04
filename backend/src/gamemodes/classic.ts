import { GameMode, Role } from '../types.js';
import { Villager } from '../roles/villager.js';
import { Werewolf } from '../roles/werewolf.js';
import { Seer } from '../roles/seer.js';
import { Doctor } from '../roles/doctor.js';

export const ClassicMode: GameMode = {
  id: 'classic',
  name: 'Classic',
  description: 'Village vs Werewolves — Seer and Doctor included',
  minPlayers: 5,
  maxPlayers: 20,
  getRoles(playerCount: number): Role[] {
    // TODO (post-MVP): scale wolf count by player count. Suggested table:
    //   5-7 players  → 1 wolf
    //   8-10 players → 2 wolves
    //   11-15 players → 3 wolves
    //   16-20 players → 4 wolves
    // Currently assigns exactly 1 wolf regardless of player count.
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
