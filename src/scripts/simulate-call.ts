#!/usr/bin/env npx tsx
/**
 * Call simulator — pretends to be Twilio and runs predefined scenarios
 * against the real voice pipeline (Deepgram STT/TTS + LLM) without
 * spending a phone minute.
 *
 * Usage:
 *   npx tsx src/scripts/simulate-call.ts --escenario=humano-interesado
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// 0. Parse CLI args FIRST, before any other imports
// ---------------------------------------------------------------------------

const SCENARIOS = [
  'humano-interesado',
  'humano-silencioso',
  'humano-pausado',
  'buzon',
  'interrumpe',
] as const;
type Scenario = (typeof SCENARIOS)[number];

const args = process.argv.slice(2);
const escenarioArg = args.find(a => a.startsWith('--escenario='));
const scenario: Scenario = (escenarioArg?.split('=')[1] as Scenario) || 'humano-interesado';
if (!SCENARIOS.includes(scenario)) {
  console.error(`Escenario desconocido: "${scenario}". Usa: ${SCENARIOS.join(', ')}`);
  process.exit(1);
}

const CACHE_DIR = path.join(__dirname, '..', '..', '.sim-cache');
const OUT_DIR = path.join(__dirname, '..', '..', 'sim-output');

// ---------------------------------------------------------------------------
// 1. Scenario scripts
// ---------------------------------------------------------------------------

interface ScenarioLine {
  delayMs: number;
  text: string;
  waitForAgent?: boolean;
}

const SCENARIO_SCRIPTS: Record<Scenario, ScenarioLine[]> = {
  'humano-interesado': [
    { delayMs: 500, text: '¿Bueno?', waitForAgent: true },
    { delayMs: 300, text: 'Sí, dígame.', waitForAgent: true },
    { delayMs: 300, text: 'Ah, sí, suena interesante. ¿De qué se trata exactamente?', waitForAgent: true },
    { delayMs: 400, text: 'Ok, me interesa. ¿Cuándo podríamos verlo?', waitForAgent: true },
    { delayMs: 300, text: 'Sí, perfecto, muchas gracias.', waitForAgent: true },
  ],
  'humano-silencioso': [
    { delayMs: 500, text: '¿Bueno?', waitForAgent: true },
  ],
  'humano-pausado': [
    { delayMs: 500, text: '¿Bueno?', waitForAgent: true },
    { delayMs: 4500, text: 'Ah sí, perdón, estaba en otra cosa.', waitForAgent: true },
    { delayMs: 4800, text: 'Ok, déjeme pensar... sí, suena bien.', waitForAgent: true },
    { delayMs: 4200, text: 'Gracias, lo voy a considerar.', waitForAgent: true },
  ],
  buzon: [
    { delayMs: 200, text: 'El número que usted marcó no se encuentra disponible. Deje su mensaje después del tono.' },
  ],
  interrumpe: [
    { delayMs: 500, text: '¿Bueno?', waitForAgent: true },
    { delayMs: 300, text: 'Sí, dígame.', waitForAgent: false },
    { delayMs: 2000, text: 'Espere espere, ya me llamaron antes de esto y no me interesó.', waitForAgent: true },
    { delayMs: 500, text: 'Bueno, a ver, explíqueme rápido.', waitForAgent: true },
  ],
};

const PROSPECT_VOICE = 'aura-2-theron-es';

// ---------------------------------------------------------------------------
// 2. Metrics
// ---------------------------------------------------------------------------

interface SimMetrics {
  voiceToVoice: number[];
  llmTtft: number[];
  ttsTtfb: number[];
  fillerCount: number;
  nudgeCount: number;
  bargeIns: Array<{ atMs: number }>;
  transcript: Array<{ ts: number; speaker: string; text: string }>;
  disposition: string | null;
  callDurationMs: number;
  llmCalls: number;
}

// ---------------------------------------------------------------------------
// 3. WAV writer (mu-law 8 kHz mono)
// ---------------------------------------------------------------------------

function writeWav(filePath: string, mulawData: Buffer) {
  const dataSize = mulawData.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(7, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, mulawData]));
}

// ---------------------------------------------------------------------------
// 4. Percentile helper
// ---------------------------------------------------------------------------

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * p)];
}

// ---------------------------------------------------------------------------
// 5. Main — all service imports happen inside here, AFTER mocks are set up
// ---------------------------------------------------------------------------

let callHungUp = false;
let disposition: string | null = null;

async function main() {
  console.log(`[Sim] Starting simulation: ${scenario}`);

  // ---- Install mocks by replacing module cache entries BEFORE anything ----
  // We create fake module objects in the require cache so that when
  // call-session.ts and friends `import * as db from '../services/supabase'`,
  // they get our fakes.

  const Module = require('module') as typeof import('module');
  const resolveFilename = (Module as unknown as { _resolveFilename: (...args: unknown[]) => string })._resolveFilename;

  const fakeProspect = {
    id: 'sim-prospect-1', nombre: 'Carlos Méndez', telefono: '+5215512345678',
    empresa: 'Acme México', email: null, campos_personalizados: null,
    status: 'nuevo', owner_id: 'sim-owner-1', notas: null, do_not_call: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const fakeCampaign = {
    id: 'sim-campaign-1', nombre: 'Simulación',
    objetivo: 'Agendar una demo de 30 minutos para mostrar cómo la IA de Orkesta puede automatizar su atención al cliente.',
    contexto_negocio: 'Orkesta es una empresa mexicana de soluciones de IA. Ofrecemos agentes de voz, chatbots y automatización de procesos.',
    voz_configurada: null, llm_model: null, nombre_agente: 'Diana',
    tono_agente: null, system_prompt: '', activa: true,
    owner_id: 'sim-owner-1', created_at: new Date().toISOString(),
  };

  // Supabase mock — resolve the path first
  const supaPath = resolveFilename('../services/supabase', module, false);
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true, parent: null,
    children: [], paths: [], path: path.dirname(supaPath),
    exports: {
      getProspect: async () => fakeProspect,
      getCampaign: async () => fakeCampaign,
      createCallRecord: async () => 'sim-call-1',
      updateCallRecord: async (_id: string, updates: Record<string, unknown>) => {
        if (updates.disposition) disposition = updates.disposition as string;
      },
      saveTranscripts: async () => {},
      saveCallReport: async () => {},
      updateProspectStatus: async () => {},
      getCalendarConnection: async () => null,
      getSupabaseAdmin: () => ({
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
      }),
    },
    require: module.require,
    isPreloading: false,
  };

  // Twilio mock
  const twilioPath = resolveFilename('../services/twilio', module, false);
  require.cache[twilioPath] = {
    id: twilioPath, filename: twilioPath, loaded: true, parent: null,
    children: [], paths: [], path: path.dirname(twilioPath),
    exports: {
      initiateCall: async () => 'SIM_CALL',
      hangupCall: async () => { callHungUp = true; },
      sendConfirmationMessage: async () => ({ channel: 'sim', sid: 'sim' }),
      generateStreamTwiml: () => '<Response></Response>',
    },
    require: module.require,
    isPreloading: false,
  };

  // Scheduling mock
  const schedPath = resolveFilename('../services/scheduling', module, false);
  require.cache[schedPath] = {
    id: schedPath, filename: schedPath, loaded: true, parent: null,
    children: [], paths: [], path: path.dirname(schedPath),
    exports: {
      selectVendedor: async () => null,
      computeAvailableSlots: () => [],
      filterSlotsByPreference: (s: unknown[]) => s,
    },
    require: module.require,
    isPreloading: false,
  };

  // Google Calendar mock
  const gcalPath = resolveFilename('../services/google-calendar', module, false);
  require.cache[gcalPath] = {
    id: gcalPath, filename: gcalPath, loaded: true, parent: null,
    children: [], paths: [], path: path.dirname(gcalPath),
    exports: {
      getFreeBusy: async () => [],
      createEvent: async () => ({ eventId: 'sim-event', meetUrl: null }),
      refreshAccessTokenIfNeeded: async () => 'sim-token',
    },
    require: module.require,
    isPreloading: false,
  };

  // ---- Now we can safely import the real modules ----
  const { isConfigured } = await import('../config');
  const { synthesize, warmFillerCache } = await import('../services/deepgram-tts');
  const { handleMediaStream } = await import('../handlers/media-stream');

  if (!isConfigured('deepgram')) {
    console.error('DEEPGRAM_API_KEY is required to run simulations');
    process.exit(1);
  }
  if (!isConfigured('openai') && !isConfigured('anthropic')) {
    console.error('OPENAI_API_KEY or ANTHROPIC_API_KEY is required');
    process.exit(1);
  }

  // ---- Patch LLM to count calls ----
  const llmMod = await import('../services/llm');
  const origStream = llmMod.streamCompletion;
  const metrics: SimMetrics = {
    voiceToVoice: [], llmTtft: [], ttsTtfb: [],
    fillerCount: 0, nudgeCount: 0, bargeIns: [],
    transcript: [], disposition: null, callDurationMs: 0, llmCalls: 0,
  };

  // We can't patch ESM exports directly, so we track via console.log
  // The LLM call count will be tracked by intercepting the [Metrics] log lines
  // since every LLM call produces a Turn metric

  // ---- Warm caches ----
  await warmFillerCache();

  // ---- Generate scenario audio ----
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const audioMap = new Map<string, Buffer>();
  for (const line of SCENARIO_SCRIPTS[scenario]) {
    const cacheKey = Buffer.from(line.text).toString('base64url').slice(0, 40);
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.raw`);
    let audio: Buffer;
    if (fs.existsSync(cachePath)) {
      audio = fs.readFileSync(cachePath);
    } else {
      console.log(`[Sim] Synthesizing: "${line.text}"`);
      audio = await synthesize(line.text, undefined, PROSPECT_VOICE);
      fs.writeFileSync(cachePath, audio);
    }
    audioMap.set(line.text, audio);
  }

  // ---- Set up log interceptor ----
  const startTime = Date.now();
  callHungUp = false;
  disposition = null;

  const originalLog = console.log;

  console.log = (...logArgs: unknown[]) => {
    const msg = logArgs.map(String).join(' ');

    const totalMatch = msg.match(/\[Metrics\] Turn #\d+.*Total:\s*(\d+)ms/);
    if (totalMatch) {
      metrics.voiceToVoice.push(parseInt(totalMatch[1]));
      const sttLlm = msg.match(/STT→LLM:\s*(\d+)ms/);
      if (sttLlm) metrics.llmTtft.push(parseInt(sttLlm[1]));
      const llmTts = msg.match(/LLM→TTS:\s*(\d+)ms/);
      if (llmTts) metrics.ttsTtfb.push(parseInt(llmTts[1]));
      metrics.llmCalls++;
    }

    if (msg.includes('Barge-in detected')) {
      metrics.bargeIns.push({ atMs: Date.now() - startTime });
    }
    if (msg.includes('Filler played:')) metrics.fillerCount++;
    if (msg.includes('Silence nudge:')) metrics.nudgeCount++;
    if (msg.includes('Silence goodbye')) metrics.nudgeCount++;

    const prospectMatch = msg.match(/\[CallSession\] Prospect said: "(.+)"/);
    if (prospectMatch) {
      metrics.transcript.push({ ts: Date.now() - startTime, speaker: 'prospecto', text: prospectMatch[1] });
    }
    if (msg.includes('Voicemail detected')) {
      metrics.transcript.push({ ts: Date.now() - startTime, speaker: 'sistema', text: 'Voicemail detectado' });
    }

    originalLog.apply(console, logArgs as [unknown, ...unknown[]]);
  };

  // ---- Start WS server ----
  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '', 'http://localhost').pathname;
    if (pathname === '/media-stream') {
      wss.handleUpgrade(req, socket, head, (ws) => handleMediaStream(ws));
    } else {
      socket.destroy();
    }
  });
  await new Promise<void>(resolve => httpServer.listen(0, resolve));
  const port = (httpServer.address() as { port: number }).port;
  console.log(`[Sim] Server on port ${port}`);

  // ---- Connect as fake Twilio ----
  const ws = new WebSocket(`ws://127.0.0.1:${port}/media-stream`);
  const agentAudioChunks: Buffer[] = [];
  let lastMediaAt = 0;

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.event === 'media' && msg.media?.payload) {
      agentAudioChunks.push(Buffer.from(msg.media.payload, 'base64'));
      lastMediaAt = Date.now();
    }
    if (msg.event === 'mark') {
      ws.send(JSON.stringify({ event: 'mark', mark: { name: msg.mark.name } }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  const streamSid = `SIM_STREAM_${Date.now()}`;
  const callSid = `SIM_CALL_${Date.now()}`;

  ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
  ws.send(JSON.stringify({
    event: 'start',
    start: {
      streamSid, callSid, accountSid: 'SIM_ACCOUNT',
      customParameters: {
        prospectId: 'sim-prospect-1',
        campaignId: 'sim-campaign-1',
        ownerId: 'sim-owner-1',
      },
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
    },
    streamSid,
  }));

  // ---- Helpers ----
  const silencePayload = Buffer.alloc(160, 0xff).toString('base64');

  function sendSilence(durationMs: number): Promise<void> {
    return new Promise(resolve => {
      const total = Math.ceil(durationMs / 20);
      let sent = 0;
      const iv = setInterval(() => {
        if (sent >= total || ws.readyState !== WebSocket.OPEN) {
          clearInterval(iv);
          resolve();
          return;
        }
        ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: silencePayload } }));
        sent++;
      }, 20);
    });
  }

  function sendAudioFrames(audio: Buffer): Promise<void> {
    return new Promise(resolve => {
      let offset = 0;
      const iv = setInterval(() => {
        if (offset >= audio.length || ws.readyState !== WebSocket.OPEN) {
          clearInterval(iv);
          resolve();
          return;
        }
        const frame = audio.subarray(offset, Math.min(offset + 160, audio.length));
        ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: frame.toString('base64') } }));
        offset += 160;
      }, 20);
    });
  }

  function waitForAgentDone(timeoutMs = 30000): Promise<void> {
    return new Promise(resolve => {
      let heardAudio = false;
      const deadline = Date.now() + timeoutMs;

      const onMsg = (raw: Buffer) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m.event === 'media') {
            lastMediaAt = Date.now();
            heardAudio = true;
          }
        } catch { /* ignore parse errors */ }
      };
      ws.on('message', onMsg);

      const iv = setInterval(() => {
        if (callHungUp || Date.now() > deadline) {
          done();
          return;
        }
        if (heardAudio && Date.now() - lastMediaAt > 1500) {
          done();
        }
      }, 100);

      function done() {
        clearInterval(iv);
        ws.removeListener('message', onMsg);
        resolve();
      }
    });
  }

  // ---- Run scenario ----
  console.log(`\n[Sim] === Scenario: ${scenario} ===\n`);

  // Let server init + greeting
  await sendSilence(1000);
  await waitForAgentDone(15000);
  if (!callHungUp) {
    metrics.transcript.push({ ts: Date.now() - startTime, speaker: 'agente', text: '(greeting)' });
  }

  for (const line of SCENARIO_SCRIPTS[scenario]) {
    if (callHungUp) break;
    await sendSilence(line.delayMs);
    if (callHungUp) break;

    const audio = audioMap.get(line.text);
    if (!audio) continue;

    console.log(`[Sim] >> Prospect: "${line.text}"`);
    await sendAudioFrames(audio);
    await sendSilence(800);

    if (line.waitForAgent && !callHungUp) {
      await waitForAgentDone(30000);
    }
  }

  // Wait for silence monitor / final events
  if (!callHungUp) {
    const maxWait = scenario === 'humano-silencioso' ? 30000 : 10000;
    const waitEnd = Date.now() + maxWait;
    while (!callHungUp && Date.now() < waitEnd) {
      await sendSilence(500);
      await new Promise(r => setTimeout(r, 200));
    }
  }

  metrics.callDurationMs = Date.now() - startTime;
  metrics.disposition = disposition;

  // Stop + close
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'stop', stop: { streamSid }, streamSid }));
    await new Promise(r => setTimeout(r, 2000));
    ws.close();
  }

  // Save WAV
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${scenario}-${Date.now()}.wav`);
  if (agentAudioChunks.length > 0) {
    writeWav(outPath, Buffer.concat(agentAudioChunks));
    console.log(`[Sim] Agent audio saved: ${outPath}`);
  }

  console.log = originalLog;
  await new Promise<void>(resolve => httpServer.close(() => resolve()));

  // ---- Report ----
  const w = 48;
  const hr = '='.repeat(w);
  const ln = (label: string, val: string) => `  ${label.padEnd(24)} ${val}`;

  console.log(`\n${hr}`);
  console.log('  SIMULATION REPORT');
  console.log(hr);
  console.log(ln('Scenario:', scenario));
  console.log(ln('Duration:', `${(metrics.callDurationMs / 1000).toFixed(1)}s`));
  console.log(ln('Disposition:', metrics.disposition || 'n/a'));
  console.log('');
  console.log('  LATENCY');
  console.log(ln('  voice-to-voice p50:', `${pct(metrics.voiceToVoice, 0.5)}ms`));
  console.log(ln('  voice-to-voice p95:', `${pct(metrics.voiceToVoice, 0.95)}ms`));
  console.log(ln('  LLM TTFT p50:', `${pct(metrics.llmTtft, 0.5)}ms`));
  console.log(ln('  TTS TTFB p50:', `${pct(metrics.ttsTtfb, 0.5)}ms`));
  console.log('');
  console.log('  EVENTS');
  console.log(ln('  Fillers played:', String(metrics.fillerCount)));
  console.log(ln('  Silence nudges:', String(metrics.nudgeCount)));
  console.log(ln('  Barge-ins:', String(metrics.bargeIns.length)));
  console.log(ln('  LLM calls:', String(metrics.llmCalls)));
  console.log('');
  console.log('  TRANSCRIPT');
  for (const t of metrics.transcript) {
    const ts = `${(t.ts / 1000).toFixed(1)}s`.padStart(7);
    const speaker = t.speaker.toUpperCase().padEnd(10);
    console.log(`  ${ts} [${speaker}] ${t.text}`);
  }
  console.log(hr);

  // ---- Thresholds ----
  const failures: string[] = [];

  if (metrics.voiceToVoice.length > 0 && pct(metrics.voiceToVoice, 0.5) > 900) {
    failures.push(`voice-to-voice p50 (${pct(metrics.voiceToVoice, 0.5)}ms) > 900ms`);
  }
  if (metrics.fillerCount > 2) {
    failures.push(`fillers (${metrics.fillerCount}) > 2`);
  }

  switch (scenario) {
    case 'buzon':
      if (metrics.callDurationMs > 8000) {
        failures.push(`buzon duration (${(metrics.callDurationMs / 1000).toFixed(1)}s) > 8s`);
      }
      if (metrics.llmCalls > 1) {
        failures.push(`buzon made ${metrics.llmCalls} LLM calls (max 1 for greeting)`);
      }
      break;

    case 'humano-silencioso':
      break;

    case 'humano-pausado':
      if (metrics.nudgeCount > 0) {
        failures.push(`humano-pausado received ${metrics.nudgeCount} nudges (should be 0)`);
      }
      break;

    case 'interrumpe': {
      const agentTexts = metrics.transcript
        .filter(t => t.speaker === 'agente')
        .map(t => t.text.toLowerCase());
      for (let i = 1; i < agentTexts.length; i++) {
        const prevWords = agentTexts[i - 1].split(/\s+/).slice(0, 5).join(' ');
        if (prevWords.length > 10 && agentTexts[i].includes(prevWords)) {
          failures.push(`agent repeated text after barge-in: "${prevWords}..."`);
        }
      }
      break;
    }

    default:
      if (metrics.nudgeCount > 1) {
        failures.push(`silence nudges (${metrics.nudgeCount}) > 1`);
      }
  }

  if (failures.length > 0) {
    console.log('\nTHRESHOLD FAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  } else {
    console.log('\nAll thresholds passed.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[Sim] Fatal error:', err);
  process.exit(1);
});
