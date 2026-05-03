import { GameState, PlayerTeam } from '../types';

export class WinChecker {
  checkWin(game: GameState): PlayerTeam | null {
    const alive = Array.from(game.players.values()).filter((p) => p.alive);

    // No one alive = werewolf win (village couldn't survive)
    if (alive.length === 0) {
      game.winReason = 'All players eliminated';
      return 'werewolf';
    }

    const werewolves = alive.filter((p) => p.team === 'werewolf');
    const villagers = alive.filter((p) => p.team === 'village');

    // Village wins if all werewolves are dead
    if (werewolves.length === 0) {
      game.winReason = 'All werewolves eliminated';
      return 'village';
    }

    // Werewolves win if they equal or outnumber villagers
    if (werewolves.length >= villagers.length) {
      game.winReason = 'Werewolves outnumber villagers';
      return 'werewolf';
    }

    // Game continues
    return null;
  }
}
