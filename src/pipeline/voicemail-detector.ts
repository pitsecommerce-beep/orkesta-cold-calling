import { VOICEMAIL_PATTERNS } from './voicemail-patterns';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export class VoicemailDetector {
  private active = true;
  private timer: NodeJS.Timeout;

  constructor(windowMs = 20_000) {
    this.timer = setTimeout(() => {
      this.active = false;
    }, windowMs);
  }

  check(transcript: string): boolean {
    if (!this.active) return false;
    const normalized = normalize(transcript);
    return VOICEMAIL_PATTERNS.some((p) => normalized.includes(p));
  }

  dispose() {
    this.active = false;
    clearTimeout(this.timer);
  }
}
