import WebSocket from 'ws';
import { config, isConfigured } from '../config';

export interface STTCallbacks {
  onTurnEnd: (text: string) => void;
  onStartOfTurn: () => void;
  onProspectActivity?: () => void;
  onInterimTranscript?: (text: string) => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

export class DeepgramSTT {
  private ws: WebSocket | null = null;
  private callbacks: STTCallbacks;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private turnBuffer = '';
  private audioAccumulator: Buffer[] = [];
  private accumulatedBytes = 0;
  private static readonly CHUNK_THRESHOLD = 640; // 4 Twilio frames × 160 bytes = 80ms

  constructor(callbacks: STTCallbacks) {
    this.callbacks = callbacks;
  }

  connect(): Promise<void> {
    if (!isConfigured('deepgram')) {
      return Promise.reject(new Error('Deepgram no está configurado. Configura DEEPGRAM_API_KEY.'));
    }
    return new Promise((resolve, reject) => {
      const url = new URL('wss://api.deepgram.com/v2/listen');
      url.searchParams.set('model', 'flux-general-multi');
      url.searchParams.set('language_hint', 'es');
      url.searchParams.set('encoding', 'mulaw');
      url.searchParams.set('sample_rate', '8000');
      url.searchParams.set('channels', '1');
      url.searchParams.set('punctuate', 'true');
      url.searchParams.set('eot_threshold', '0.7');
      url.searchParams.set('eot_timeout_ms', '3500');

      this.ws = new WebSocket(url.toString(), {
        headers: { Authorization: `Token ${config.deepgram.apiKey}` },
      });

      this.ws.on('open', () => {
        this.keepAliveInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 10000);
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'Results') {
            const alt = msg.channel?.alternatives?.[0];
            if (!alt) return;
            const transcript = alt.transcript || '';
            if (transcript && msg.is_final) {
              this.turnBuffer += (this.turnBuffer ? ' ' : '') + transcript;
            }
            if (transcript && this.callbacks.onInterimTranscript) {
              this.callbacks.onInterimTranscript(transcript);
            }
          } else if (msg.type === 'TurnInfo') {
            this.handleTurnInfo(msg);
          }
        } catch (e) {
          this.callbacks.onError(e as Error);
        }
      });

      this.ws.on('error', (err) => {
        reject(err);
        this.callbacks.onError(err);
      });

      this.ws.on('close', () => {
        this.cleanup();
        this.callbacks.onClose();
      });
    });
  }

  private handleTurnInfo(msg: { event: string }) {
    switch (msg.event) {
      case 'StartOfTurn':
        this.callbacks.onStartOfTurn();
        break;

      case 'EndOfTurn': {
        const text = this.turnBuffer.trim();
        this.turnBuffer = '';
        if (text) {
          this.callbacks.onTurnEnd(text);
        }
        break;
      }

      case 'TurnResumed':
        break;

      case 'EagerEndOfTurn':
        break;

      case 'Update':
        this.callbacks.onProspectActivity?.();
        break;
    }
  }

  sendAudio(audioBuffer: Buffer) {
    this.audioAccumulator.push(audioBuffer);
    this.accumulatedBytes += audioBuffer.length;

    if (this.accumulatedBytes >= DeepgramSTT.CHUNK_THRESHOLD) {
      const combined = Buffer.concat(this.audioAccumulator);
      this.audioAccumulator = [];
      this.accumulatedBytes = 0;

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(combined);
      }
    }
  }

  resetTurnBuffer() {
    this.turnBuffer = '';
  }

  private cleanup() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  close() {
    this.cleanup();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws.close();
    }
    this.ws = null;
    this.audioAccumulator = [];
    this.accumulatedBytes = 0;
    this.turnBuffer = '';
  }
}
