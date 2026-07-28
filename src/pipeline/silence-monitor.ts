type State = 'disarmed' | 'armed' | 'nudged' | 'done';

export interface SilenceMonitorCallbacks {
  canFire: () => boolean;
  onNudge: () => void;
  onGoodbye: () => void;
}

export interface SilenceMonitorConfig {
  nudgeAfterQuestionMs: number;
  nudgeAfterStatementMs: number;
  goodbyeAfterMs: number;
  watchdogMs?: number;
}

export class SilenceMonitor {
  private state: State = 'disarmed';
  private timer: NodeJS.Timeout | null = null;
  private callbacks: SilenceMonitorCallbacks;
  private config: SilenceMonitorConfig;
  private lastEndsWithQuestion = false;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private watchdogMs: number;

  constructor(callbacks: SilenceMonitorCallbacks, monitorConfig: SilenceMonitorConfig) {
    this.callbacks = callbacks;
    this.config = monitorConfig;
    this.watchdogMs = monitorConfig.watchdogMs ?? 45_000;
  }

  arm(endsWithQuestion: boolean) {
    if (this.state === 'done') return;
    this.clearTimer();
    this.lastEndsWithQuestion = endsWithQuestion;
    this.state = 'armed';

    const delay = endsWithQuestion
      ? this.config.nudgeAfterQuestionMs
      : this.config.nudgeAfterStatementMs;

    this.timer = setTimeout(() => this.fire(), delay);
  }

  disarm() {
    if (this.state === 'done') return;
    this.clearTimer();
    this.state = 'disarmed';
  }

  prospectActivity() {
    if (this.state === 'armed' || this.state === 'nudged') {
      this.clearTimer();
      this.state = 'disarmed';
    }
  }

  rearm() {
    if (this.state === 'done') return;
    this.arm(this.lastEndsWithQuestion);
  }

  resetWatchdog() {
    if (this.state === 'done') return;
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => this.fireWatchdog(), this.watchdogMs);
  }

  startWatchdog() {
    this.resetWatchdog();
  }

  dispose() {
    this.clearTimer();
    this.clearWatchdog();
    this.state = 'done';
  }

  get currentState(): State {
    return this.state;
  }

  private fire() {
    if (!this.callbacks.canFire()) {
      this.rearm();
      return;
    }

    if (this.state === 'armed') {
      this.state = 'nudged';
      this.callbacks.onNudge();
      this.timer = setTimeout(() => this.fire(), this.config.goodbyeAfterMs);
    } else if (this.state === 'nudged') {
      this.state = 'done';
      this.clearWatchdog();
      this.callbacks.onGoodbye();
    }
  }

  private fireWatchdog() {
    if (this.state === 'done') return;
    if (!this.callbacks.canFire()) {
      this.resetWatchdog();
      return;
    }
    console.log('[SilenceMonitor] Watchdog fired — no STT activity for 45s');
    this.clearTimer();
    this.state = 'done';
    this.callbacks.onGoodbye();
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
