import WebSocket from 'ws';
import { config, isConfigured } from '../config';

const FILLER_PHRASES = [
  'Claro...',
  'Mmm, déjeme ver...',
  'Un momento...',
  'Perfecto...',
  'Entiendo...',
  'Muy bien...',
];

const fillerCache = new Map<string, Buffer>();

export async function warmFillerCache(): Promise<void> {
  if (!isConfigured('deepgram')) {
    console.warn('[TTS] ⚠️  DEEPGRAM_API_KEY no configurada — fillers deshabilitados');
    return;
  }
  console.log('[TTS] Warming filler cache...');
  const promises = FILLER_PHRASES.map(async (phrase) => {
    try {
      const audio = await synthesize(phrase);
      fillerCache.set(phrase, audio);
      console.log(`[TTS] Cached filler: "${phrase}" (${audio.length} bytes)`);
    } catch (err) {
      console.error(`[TTS] Failed to cache filler "${phrase}":`, err);
    }
  });
  await Promise.all(promises);
  console.log(`[TTS] Filler cache warmed: ${fillerCache.size}/${FILLER_PHRASES.length}`);
}

export function getRandomFiller(): { text: string; audio: Buffer } | null {
  if (fillerCache.size === 0) return null;
  const entries = Array.from(fillerCache.entries());
  const [text, audio] = entries[Math.floor(Math.random() * entries.length)];
  return { text, audio };
}

export async function synthesize(text: string, signal?: AbortSignal, voiceOverride?: string): Promise<Buffer> {
  const voice = voiceOverride || config.deepgram.ttsVoice;
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=mulaw&sample_rate=8000&container=none`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.deepgram.apiKey}`,
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
    },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Deepgram TTS error ${response.status}: ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---- Persistent TTS WebSocket ----

export class DeepgramTTSStream {
  private ws: WebSocket | null = null;
  private audioChunks: Buffer[] = [];
  private flushResolve: ((audio: Buffer) => void) | null = null;
  private flushReject: ((err: Error) => void) | null = null;
  private flushTimestamps: number[] = [];
  private connected = false;
  private static readonly MAX_FLUSH_PER_MINUTE = 20;

  connect(voiceOverride?: string): Promise<void> {
    if (!isConfigured('deepgram')) {
      return Promise.reject(new Error('Deepgram no está configurado.'));
    }

    return new Promise((resolve, reject) => {
      const voice = voiceOverride || config.deepgram.ttsVoice;
      const url = `wss://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=mulaw&sample_rate=8000`;

      this.ws = new WebSocket(url, {
        headers: { Authorization: `Token ${config.deepgram.apiKey}` },
      });

      this.ws.on('open', () => {
        this.connected = true;
        console.log('[TTS-WS] Connected');
        resolve();
      });

      this.ws.on('message', (data, isBinary) => {
        if (isBinary) {
          this.audioChunks.push(Buffer.from(data as Buffer));
          return;
        }

        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
            case 'Flushed': {
              const audio = Buffer.concat(this.audioChunks);
              this.audioChunks = [];
              if (this.flushResolve) {
                this.flushResolve(audio);
                this.flushResolve = null;
                this.flushReject = null;
              }
              break;
            }

            case 'Cleared':
              this.audioChunks = [];
              break;

            case 'Warning':
              console.warn('[TTS-WS] Warning:', msg.description || msg);
              break;

            case 'Metadata':
              break;
          }
        } catch (e) {
          console.error('[TTS-WS] Parse error:', e);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[TTS-WS] Error:', err);
        if (!this.connected) {
          reject(err);
        }
        if (this.flushReject) {
          this.flushReject(err);
          this.flushResolve = null;
          this.flushReject = null;
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        console.log('[TTS-WS] Closed');
        if (this.flushReject) {
          this.flushReject(new Error('TTS WebSocket closed'));
          this.flushResolve = null;
          this.flushReject = null;
        }
      });
    });
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  speak(text: string): void {
    if (!this.isConnected) return;
    this.ws!.send(JSON.stringify({ type: 'Speak', text }));
  }

  flush(): Promise<Buffer> {
    if (!this.isConnected) {
      return Promise.reject(new Error('TTS WebSocket not connected'));
    }

    if (!this.canFlush()) {
      console.warn('[TTS-WS] Flush rate limit reached, waiting...');
    }

    return new Promise((resolve, reject) => {
      this.flushResolve = resolve;
      this.flushReject = reject;
      this.flushTimestamps.push(Date.now());
      this.ws!.send(JSON.stringify({ type: 'Flush' }));
    });
  }

  clear(): void {
    if (!this.isConnected) return;
    this.audioChunks = [];
    if (this.flushResolve) {
      this.flushResolve(Buffer.alloc(0));
      this.flushResolve = null;
      this.flushReject = null;
    }
    this.ws!.send(JSON.stringify({ type: 'Clear' }));
  }

  close(): void {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'Close' }));
        this.ws.close();
      }
      this.ws = null;
    }
    this.connected = false;
    this.audioChunks = [];
    if (this.flushReject) {
      this.flushReject(new Error('TTS WebSocket closed'));
      this.flushResolve = null;
      this.flushReject = null;
    }
  }

  private canFlush(): boolean {
    const now = Date.now();
    this.flushTimestamps = this.flushTimestamps.filter(t => now - t < 60_000);
    return this.flushTimestamps.length < DeepgramTTSStream.MAX_FLUSH_PER_MINUTE;
  }
}
