import { GamePhase } from '../types';

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

  getPhaseDuration(phase: GamePhase): number {
    // TODO: make configurable per game mode
    switch (phase) {
      case 'night':
        return 30; // seconds
      case 'day':
        return 60; // seconds
      default:
        return 0;
    }
  }
}
