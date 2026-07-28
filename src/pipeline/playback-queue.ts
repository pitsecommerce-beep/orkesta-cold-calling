import WebSocket from 'ws';

const FRAME_SIZE = 160; // 20ms of 8kHz mu-law audio
const FRAME_INTERVAL_MS = 20;

export class PlaybackQueue {
  private markCounter = 0;
  private pendingMarks = new Set<string>();
  private frameQueue: Array<{ type: 'audio'; payload: string } | { type: 'mark'; name: string }> = [];
  private draining = false;
  private drainId = 0;
  private ws: WebSocket | null = null;
  private streamSid: string | null = null;
  private markTexts = new Map<string, string>();
  private confirmedTexts: string[] = [];

  get isPlaying(): boolean {
    return this.pendingMarks.size > 0 || this.frameQueue.length > 0;
  }

  setTarget(ws: WebSocket, streamSid: string) {
    this.ws = ws;
    this.streamSid = streamSid;
  }

  sendAudio(audioBuffer: Buffer) {
    for (let i = 0; i < audioBuffer.length; i += FRAME_SIZE) {
      const frame = audioBuffer.subarray(i, Math.min(i + FRAME_SIZE, audioBuffer.length));
      this.frameQueue.push({ type: 'audio', payload: frame.toString('base64') });
    }
    this.startDrain();
  }

  sendMark(text?: string): string {
    this.markCounter++;
    const markName = `phrase_${this.markCounter}`;
    this.pendingMarks.add(markName);
    if (text) {
      this.markTexts.set(markName, text);
    }
    this.frameQueue.push({ type: 'mark', name: markName });
    this.startDrain();
    return markName;
  }

  handleMarkReceived(markName: string) {
    this.pendingMarks.delete(markName);
    const text = this.markTexts.get(markName);
    if (text) {
      this.confirmedTexts.push(text);
      this.markTexts.delete(markName);
    }
  }

  getConfirmedText(): string {
    return this.confirmedTexts.join(' ');
  }

  resetTracking() {
    this.markTexts.clear();
    this.confirmedTexts = [];
  }

  sendClear() {
    this.frameQueue.length = 0;
    this.draining = false;
    this.drainId++;
    if (this.ws?.readyState === WebSocket.OPEN && this.streamSid) {
      this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
    }
    this.pendingMarks.clear();
    this.markTexts.clear();
  }

  reset() {
    this.frameQueue.length = 0;
    this.pendingMarks.clear();
    this.draining = false;
    this.drainId++;
    this.markTexts.clear();
    this.confirmedTexts = [];
  }

  private startDrain() {
    if (this.draining) return;
    this.draining = true;
    const id = ++this.drainId;
    this.drainNext(id);
  }

  private drainNext(id: number) {
    if (id !== this.drainId) return;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.streamSid) {
      this.draining = false;
      return;
    }

    const item = this.frameQueue.shift();
    if (!item) {
      this.draining = false;
      return;
    }

    if (item.type === 'audio') {
      this.ws.send(JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: item.payload },
      }));
      setTimeout(() => this.drainNext(id), FRAME_INTERVAL_MS);
    } else if (item.type === 'mark') {
      this.ws.send(JSON.stringify({
        event: 'mark',
        streamSid: this.streamSid,
        mark: { name: item.name },
      }));
      this.drainNext(id);
    }
  }
}
