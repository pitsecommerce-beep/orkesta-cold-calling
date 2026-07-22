import WebSocket from 'ws';

const FRAME_SIZE = 160; // 20ms of 8kHz mu-law audio

export class PlaybackQueue {
  private markCounter = 0;
  private lastPlayedMark = 0;
  private pendingMarks = new Set<string>();

  get isPlaying(): boolean {
    return this.pendingMarks.size > 0;
  }

  sendAudio(audioBuffer: Buffer, ws: WebSocket, streamSid: string) {
    if (ws.readyState !== WebSocket.OPEN) return;

    for (let i = 0; i < audioBuffer.length; i += FRAME_SIZE) {
      const frame = audioBuffer.subarray(i, Math.min(i + FRAME_SIZE, audioBuffer.length));
      const payload = frame.toString('base64');

      ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload },
      }));
    }
  }

  sendMark(ws: WebSocket, streamSid: string): string {
    this.markCounter++;
    const markName = `phrase_${this.markCounter}`;
    this.pendingMarks.add(markName);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        event: 'mark',
        streamSid,
        mark: { name: markName },
      }));
    }

    return markName;
  }

  handleMarkReceived(markName: string) {
    this.pendingMarks.delete(markName);
  }

  sendClear(ws: WebSocket, streamSid: string) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        event: 'clear',
        streamSid,
      }));
    }
    this.pendingMarks.clear();
  }

  reset() {
    this.pendingMarks.clear();
  }
}
