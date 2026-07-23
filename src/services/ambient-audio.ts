const SAMPLE_RATE = 8000;
const LOOP_SECONDS = 4;

let ambientLoop: Buffer | null = null;

function linearToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;

  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }

  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  let mask = 0x4000;
  while (exponent > 0 && !(sample & mask)) {
    exponent--;
    mask >>= 1;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateLoop(): Buffer {
  const total = SAMPLE_RATE * LOOP_SECONDS;
  const buf = Buffer.alloc(total);

  for (let i = 0; i < total; i++) {
    const noise = (Math.random() - 0.5) * 8;
    buf[i] = linearToMulaw(Math.round(noise));
  }

  let pos = rand(2000, 5000);
  while (pos < total - 200) {
    const clickLen = rand(16, 48);
    for (let j = 0; j < clickLen && pos + j < total; j++) {
      const t = j / clickLen;
      const env = Math.sin(t * Math.PI);
      const amp = env * rand(30, 80);
      const sign = Math.random() < 0.5 ? 1 : -1;
      buf[pos + j] = linearToMulaw(Math.round(sign * amp));
    }
    pos += rand(2000, 6000);
  }

  let murmurPos = rand(10000, 20000);
  while (murmurPos < total - 2400) {
    const murmurLen = rand(600, 1600);
    for (let j = 0; j < murmurLen && murmurPos + j < total; j++) {
      const t = j / murmurLen;
      const env = Math.sin(t * Math.PI) * 0.4;
      const freq = 0.02 + Math.random() * 0.01;
      const wave = Math.sin(j * freq) * env;
      const amp = wave * rand(12, 35);
      buf[murmurPos + j] = linearToMulaw(Math.round(amp));
    }
    murmurPos += rand(20000, 28000);
  }

  return buf;
}

export function getAmbientLoop(): Buffer {
  if (!ambientLoop) {
    ambientLoop = generateLoop();
  }
  return ambientLoop;
}

export function generateTypingBurst(durationMs: number): Buffer {
  const samples = Math.floor(SAMPLE_RATE * durationMs / 1000);
  const buf = Buffer.alloc(samples);

  for (let i = 0; i < samples; i++) {
    buf[i] = linearToMulaw(Math.round((Math.random() - 0.5) * 10));
  }

  let pos = rand(80, 300);
  while (pos < samples - 100) {
    const clickLen = rand(18, 50);
    for (let j = 0; j < clickLen && pos + j < samples; j++) {
      const t = j / clickLen;
      const env = Math.sin(t * Math.PI);
      const amp = env * rand(60, 160);
      const sign = Math.random() < 0.5 ? 1 : -1;
      buf[pos + j] = linearToMulaw(Math.round(sign * amp));
    }
    pos += rand(150, 600);
  }

  return buf;
}

export function getAmbientChunk(offset: number, lengthMs: number): { chunk: Buffer; nextOffset: number } {
  const loop = getAmbientLoop();
  const samples = Math.floor(SAMPLE_RATE * lengthMs / 1000);
  const buf = Buffer.alloc(samples);

  for (let i = 0; i < samples; i++) {
    buf[i] = loop[(offset + i) % loop.length];
  }

  return {
    chunk: buf,
    nextOffset: (offset + samples) % loop.length,
  };
}
