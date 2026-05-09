import { GamePhase, GameMode } from '../types.js';

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

  getPhaseDuration(phase: GamePhase, gameMode?: GameMode): number {
    switch (phase) {
      case 'night':
        return gameMode?.phaseDurations?.night ?? 30;
      case 'day':
        return gameMode?.phaseDurations?.day ?? 60;
      default:
        return 0;
    }
  }
}
