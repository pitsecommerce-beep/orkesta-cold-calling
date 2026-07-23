import WebSocket from 'ws';
import { config, isConfigured } from '../config';

export interface STTCallbacks {
  onTranscript: (text: string, isFinal: boolean, speechFinal: boolean) => void;
  onUtteranceEnd: () => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

export class DeepgramSTT {
  private ws: WebSocket | null = null;
  private callbacks: STTCallbacks;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor(callbacks: STTCallbacks) {
    this.callbacks = callbacks;
  }

  connect(): Promise<void> {
    if (!isConfigured('deepgram')) {
      return Promise.reject(new Error('Deepgram no está configurado. Configura DEEPGRAM_API_KEY.'));
    }
    return new Promise((resolve, reject) => {
      const url = new URL('wss://api.deepgram.com/v1/listen');
      url.searchParams.set('model', 'nova-3');
      url.searchParams.set('language', 'es');
      url.searchParams.set('encoding', 'mulaw');
      url.searchParams.set('sample_rate', '8000');
      url.searchParams.set('channels', '1');
      url.searchParams.set('punctuate', 'true');
      url.searchParams.set('interim_results', 'true');
      url.searchParams.set('endpointing', config.endpointingMs.toString());
      url.searchParams.set('utterance_end_ms', '1200');
      url.searchParams.set('smart_format', 'true');

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
            if (transcript) {
              this.callbacks.onTranscript(
                transcript,
                msg.is_final === true,
                msg.speech_final === true,
              );
            }
          } else if (msg.type === 'UtteranceEnd') {
            this.callbacks.onUtteranceEnd();
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

  sendAudio(audioBuffer: Buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audioBuffer);
    }
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
  }
}
