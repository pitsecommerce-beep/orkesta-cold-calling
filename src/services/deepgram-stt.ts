import WebSocket from 'ws';
import { config, isConfigured } from '../config';

const ALLOWED_FLUX_PARAMS = new Set([
  'model', 'encoding', 'sample_rate', 'eot_threshold', 'eager_eot_threshold',
  'eot_timeout_ms', 'keyterm', 'language_hint', 'profanity_filter',
  'mip_opt_out', 'tag',
]);

export interface STTCallbacks {
  onTurnEnd: (text: string) => void;
  onStartOfTurn: (transcript: string) => void;
  onProspectActivity?: () => void;
  onInterimTranscript?: (text: string) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onFatalError?: (error: Error) => void;
}

export class DeepgramSTT {
  private ws: WebSocket | null = null;
  private callbacks: STTCallbacks;
  private audioAccumulator: Buffer[] = [];
  private accumulatedBytes = 0;
  private static readonly CHUNK_THRESHOLD = 640;

  private retryCount = 0;
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAYS = [500, 1500, 4000];
  private firstTurnInfoReceived = false;
  private connected = false;
  private disposed = false;

  constructor(callbacks: STTCallbacks) {
    this.callbacks = callbacks;
  }

  connect(): Promise<void> {
    if (!isConfigured('deepgram')) {
      return Promise.reject(new Error('Deepgram no está configurado. Configura DEEPGRAM_API_KEY.'));
    }

    return new Promise((resolve, reject) => {
      const params: Record<string, string> = {
        model: 'flux-general-multi',
        language_hint: 'es',
        encoding: 'mulaw',
        sample_rate: '8000',
        eot_threshold: '0.7',
        eot_timeout_ms: '3500',
      };

      const url = new URL('wss://api.deepgram.com/v2/listen');
      for (const [key, value] of Object.entries(params)) {
        if (!ALLOWED_FLUX_PARAMS.has(key)) {
          reject(new Error(`Invalid Flux param rejected: ${key}`));
          return;
        }
        url.searchParams.set(key, value);
      }

      this.ws = new WebSocket(url.toString(), {
        headers: { Authorization: `Token ${config.deepgram.apiKey}` },
      });

      this.ws.on('open', () => {
        this.connected = true;
        this.retryCount = 0;
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          this.callbacks.onError(e as Error);
        }
      });

      this.ws.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
        this.callbacks.onError(err);
      });

      this.ws.on('close', (code) => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;

        if (this.disposed) return;

        if (!wasConnected) return;

        if (code >= 4000) {
          const err = new Error(`STT closed with application code ${code} — not retrying`);
          console.error(`[STT] ${err.message}`);
          this.callbacks.onFatalError?.(err);
          this.callbacks.onClose();
          return;
        }

        if (this.retryCount < DeepgramSTT.MAX_RETRIES) {
          const delay = DeepgramSTT.RETRY_DELAYS[this.retryCount]!;
          this.retryCount++;
          console.log(`[STT] Reconnecting (${this.retryCount}/${DeepgramSTT.MAX_RETRIES}) in ${delay}ms`);
          setTimeout(() => {
            this.connect()
              .then(() => console.log('[STT] Reconnected successfully'))
              .catch((err) => {
                console.error('[STT] Reconnect attempt failed:', err);
                if (this.retryCount >= DeepgramSTT.MAX_RETRIES) {
                  this.callbacks.onFatalError?.(new Error('STT max retries exceeded'));
                  this.callbacks.onClose();
                }
              });
          }, delay);
        } else {
          const err = new Error('STT max retries exceeded');
          console.error(`[STT] ${err.message}`);
          this.callbacks.onFatalError?.(err);
          this.callbacks.onClose();
        }
      });
    });
  }

  private handleMessage(msg: { type: string; event?: string; transcript?: string }) {
    switch (msg.type) {
      case 'Connected':
        console.log('[STT] Flux session established — STT healthy');
        break;

      case 'TurnInfo':
        this.handleTurnInfo(msg as { event: string; transcript?: string });
        break;

      case 'ConfigureSuccess':
        console.log('[STT] Configure accepted');
        break;

      case 'ConfigureFailure':
        console.warn('[STT] Configure rejected:', msg);
        break;

      case 'Error':
        this.callbacks.onError(new Error(`Flux error: ${JSON.stringify(msg)}`));
        break;
    }
  }

  private handleTurnInfo(msg: { event: string; transcript?: string }) {
    const transcript = msg.transcript || '';

    if (!this.firstTurnInfoReceived) {
      this.firstTurnInfoReceived = true;
      console.log('[STT] First TurnInfo received — pipeline healthy');
    }

    switch (msg.event) {
      case 'StartOfTurn':
        this.callbacks.onStartOfTurn(transcript);
        break;

      case 'EndOfTurn':
        if (transcript) {
          this.callbacks.onTurnEnd(transcript);
        }
        break;

      case 'EagerEndOfTurn':
        this.callbacks.onProspectActivity?.();
        break;

      case 'TurnResumed':
        this.callbacks.onProspectActivity?.();
        break;

      case 'Update':
        this.callbacks.onProspectActivity?.();
        if (transcript) {
          this.callbacks.onInterimTranscript?.(transcript);
        }
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

  close() {
    this.disposed = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws.close();
    }
    this.ws = null;
    this.audioAccumulator = [];
    this.accumulatedBytes = 0;
  }
}

export { ALLOWED_FLUX_PARAMS };
