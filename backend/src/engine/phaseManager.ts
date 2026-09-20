import { GamePhase } from '../types.js';

export class PhaseManager {
  getNextPhase(currentPhase: GamePhase): GamePhase {
    switch (currentPhase) {
      case 'lobby':
        return 'night';
      case 'night':
        return 'day';
      case 'day':
        return 'night';
      case 'ended':
        return 'ended';
      default:
        return 'lobby';
    }
  }
}
