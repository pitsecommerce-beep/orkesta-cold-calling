import { EventEmitter } from 'events';

export interface TurnCompleteEvent {
  text: string;
  durationMs: number;
}

export class TurnDetector extends EventEmitter {
  private buffer = '';
  private lastFinalTimestamp = 0;
  private pendingTimeout: NodeJS.Timeout | null = null;
  private safetyTimeout: NodeJS.Timeout | null = null;
  private turnStartTime = 0;

  handleTranscript(text: string, isFinal: boolean, speechFinal: boolean) {
    if (!this.turnStartTime && text.trim()) {
      this.turnStartTime = Date.now();
    }

    if (isFinal) {
      this.buffer += (this.buffer ? ' ' : '') + text;
      this.lastFinalTimestamp = Date.now();
      this.resetSafetyTimer();

      if (speechFinal) {
        this.scheduleTurnComplete(200);
      }
    }
  }

  handleUtteranceEnd() {
    if (this.buffer.trim()) {
      this.fireTurnComplete();
    }
  }

  private scheduleTurnComplete(delayMs: number) {
    this.clearPendingTimeout();
    this.pendingTimeout = setTimeout(() => {
      if (this.buffer.trim()) {
        this.fireTurnComplete();
      }
    }, delayMs);
  }

  private resetSafetyTimer() {
    if (this.safetyTimeout) clearTimeout(this.safetyTimeout);
    this.safetyTimeout = setTimeout(() => {
      if (this.buffer.trim()) {
        this.fireTurnComplete();
      }
    }, 1500);
  }

  private fireTurnComplete() {
    this.clearPendingTimeout();
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }

    const text = this.buffer.trim();
    if (!text) return;

    const durationMs = this.turnStartTime ? Date.now() - this.turnStartTime : 0;

    this.buffer = '';
    this.turnStartTime = 0;

    this.emit('turn_complete', { text, durationMs } as TurnCompleteEvent);
  }

  private clearPendingTimeout() {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  reset() {
    this.buffer = '';
    this.turnStartTime = 0;
    this.lastFinalTimestamp = 0;
    this.clearPendingTimeout();
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }
  }
}
