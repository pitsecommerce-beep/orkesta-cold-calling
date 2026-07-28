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
}

export class SilenceMonitor {
  private state: State = 'disarmed';
  private timer: NodeJS.Timeout | null = null;
  private callbacks: SilenceMonitorCallbacks;
  private config: SilenceMonitorConfig;
  private lastEndsWithQuestion = false;

  constructor(callbacks: SilenceMonitorCallbacks, monitorConfig: SilenceMonitorConfig) {
    this.callbacks = callbacks;
    this.config = monitorConfig;
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

  dispose() {
    this.clearTimer();
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
      this.callbacks.onGoodbye();
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
