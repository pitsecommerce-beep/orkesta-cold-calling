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

export async function synthesizeStream(
  text: string,
  onChunk: (chunk: Buffer) => void,
  signal?: AbortSignal,
  voiceOverride?: string,
): Promise<void> {
  const voice = voiceOverride || config.deepgram.ttsVoice;
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=mulaw&sample_rate=8000&container=none`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.deepgram.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Deepgram TTS error ${response.status}: ${body}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body from TTS');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal?.aborted) {
      reader.cancel();
      break;
    }
    onChunk(Buffer.from(value));
  }
}
