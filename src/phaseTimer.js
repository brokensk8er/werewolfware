export class PhaseTimer {
  constructor(gameId, duration, onTick, onExpire) {
    this._gameId = gameId;
    this._duration = duration;
    this._onTick = onTick;
    this._onExpire = onExpire;
    this._remaining = Math.floor(duration / 1000);
    this._interval = null;
  }

  start() {
    this._interval = setInterval(() => {
      this._remaining -= 1;
      this._onTick(this._remaining);
      if (this._remaining <= 0) {
        this.cancel();
        this._onExpire();
      }
    }, 1000);
  }

  cancel() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  getSecondsRemaining() {
    return this._remaining;
  }
}
