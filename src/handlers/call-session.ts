import WebSocket from 'ws';
import { DeepgramSTT } from '../services/deepgram-stt';
import * as tts from '../services/deepgram-tts';
import { DeepgramTTSStream } from '../services/deepgram-tts';
import * as llm from '../services/llm';
import * as db from '../services/supabase';
import * as twilio from '../services/twilio';
import * as gcal from '../services/google-calendar';
import { computeAvailableSlots, filterSlotsByPreference, selectVendedor } from '../services/scheduling';
import { PhraseChunker } from '../pipeline/phrase-chunker';
import { PlaybackQueue } from '../pipeline/playback-queue';
import { MetricsCollector, TurnMetrics } from '../pipeline/turn-metrics';
import { VoicemailDetector } from '../pipeline/voicemail-detector';
import { SilenceMonitor } from '../pipeline/silence-monitor';
import { getAmbientChunk, generateTypingBurst } from '../services/ambient-audio';
import { config } from '../config';
import type { ConversationTurn, CallDisposition, ProspectStatus, Slot, CalendarConnection, Campaign } from '../models/types';
import type { ConversationMessage } from '../services/llm';

export class CallSession {
  private twilioWs: WebSocket;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private prospectId: string;
  private campaignId: string;
  private ownerId: string;
  private callId: string | null = null;

  private stt: DeepgramSTT | null = null;
  private ttsStream: DeepgramTTSStream | null = null;
  private phraseChunker: PhraseChunker;
  private playbackQueue: PlaybackQueue;
  private metrics = new MetricsCollector();

  private conversationHistory: ConversationMessage[] = [];
  private turns: ConversationTurn[] = [];
  private isAgentSpeaking = false;
  private currentAbort: AbortController | null = null;
  private startTime: Date;
  private greetingSent = false;
  private disposed = false;
  private ttsVoice: string | undefined;
  private llmModel: string | undefined;
  private toneAgente: string | undefined;

  private cachedSlots: Slot[] = [];
  private slotsReady = false;
  private slotsPromise: Promise<void> | null = null;
  private calendarConnection: CalendarConnection | null = null;
  private prospectPhone: string | null = null;

  private amdResolved = false;
  private amdTimeout: NodeJS.Timeout | null = null;
  private skipReport = false;
  private voicemailDetector = new VoicemailDetector();

  private processingResponse = false;
  private ambientInterval: NodeJS.Timeout | null = null;
  private ambientOffset = 0;
  private phraseQueue: string[] = [];
  private responseGeneration = 0;
  private silenceMonitor: SilenceMonitor | null = null;
  private fillerCount = 0;
  private lastFillerUsed: string | undefined;
  private fillerTimer: NodeJS.Timeout | null = null;
  private pendingGoodbye = false;
  private pendingApology = false;
  private testMode = false;
  private testProspectName = '';
  private onTranscript?: (speaker: 'agente' | 'prospecto', text: string) => void;

  constructor(ws: WebSocket, params: { prospectId: string; campaignId: string; ownerId: string }) {
    this.twilioWs = ws;
    this.prospectId = params.prospectId;
    this.campaignId = params.campaignId;
    this.ownerId = params.ownerId;
    this.startTime = new Date();

    this.phraseChunker = new PhraseChunker();
    this.playbackQueue = new PlaybackQueue();
  }

  setTestMode(prospectName: string, onTranscript?: (speaker: 'agente' | 'prospecto', text: string) => void) {
    this.testMode = true;
    this.testProspectName = prospectName;
    this.onTranscript = onTranscript;
  }

  async initialize(streamSid: string, callSid: string) {
    this.streamSid = streamSid;
    this.callSid = callSid;
    this.playbackQueue.setTarget(this.twilioWs, streamSid);

    console.log(`[CallSession] Initializing ${this.testMode ? 'test ' : ''}call ${callSid}`);

    try {
      let campaign: Campaign | null = null;
      let prospectName = '';
      let prospectCompany: string | undefined;
      let prospectNotes: string | undefined;

      if (this.testMode) {
        prospectName = this.testProspectName;
        campaign = this.campaignId ? await db.getCampaign(this.campaignId) : null;
      } else {
        const [prospect, camp] = await Promise.all([
          db.getProspect(this.prospectId),
          this.campaignId ? db.getCampaign(this.campaignId) : null,
        ]);

        if (!prospect) {
          console.error('[CallSession] Prospect not found:', this.prospectId);
          await this.hangup();
          return;
        }

        campaign = camp;
        prospectName = prospect.nombre;
        prospectCompany = prospect.empresa || undefined;
        prospectNotes = prospect.notas || undefined;
        this.prospectPhone = prospect.telefono;
      }

      if (campaign?.voz_configurada) {
        this.ttsVoice = campaign.voz_configurada;
      }
      if (campaign?.llm_model) {
        this.llmModel = campaign.llm_model;
      }
      if (campaign?.tono_agente) {
        this.toneAgente = campaign.tono_agente;
      }

      if (!this.testMode) {
        this.callId = await db.createCallRecord({
          prospectId: this.prospectId,
          campaignId: this.campaignId || null,
          twilioCallSid: callSid,
          ownerId: this.ownerId,
        });

        this.slotsPromise = this.preloadSlots();
      }

      const systemPrompt = llm.buildSystemPrompt({
        campaignObjective: campaign?.objetivo || 'Presentar los servicios de Orkesta y detectar interés.',
        businessContext: campaign?.contexto_negocio || 'Orkesta ofrece soluciones de IA para empresas.',
        customSystemPrompt: campaign?.system_prompt,
        prospectName,
        prospectCompany,
        prospectNotes,
        agentName: campaign?.nombre_agente || undefined,
        tone: this.toneAgente,
      });

      this.conversationHistory.push({ role: 'system', content: systemPrompt });

      await this.connectSTT();

      try {
        this.ttsStream = new DeepgramTTSStream();
        await this.ttsStream.connect(this.ttsVoice);
      } catch (err) {
        console.warn('[CallSession] TTS WebSocket failed, will use REST fallback:', err);
        this.ttsStream = null;
      }

      if (!this.testMode) {
        await db.updateProspectStatus(this.prospectId, 'contactado');
      }

      this.startAmbientAudio();

      if (this.testMode) {
        setTimeout(() => this.sendGreeting(), 500);
      } else if (config.amdEnabled) {
        this.amdTimeout = setTimeout(() => {
          if (!this.amdResolved && !this.disposed) {
            console.log('[CallSession] AMD timeout — greeting as safety net');
            this.amdResolved = true;
            this.sendGreeting();
          }
        }, 3500);
      } else {
        setTimeout(() => this.sendGreeting(), 500);
      }
    } catch (err) {
      console.error('[CallSession] Initialize error:', err);
    }
  }

  private startAmbientAudio() {
    if (this.ambientInterval || this.testMode) return;
    this.ambientInterval = setInterval(() => {
      if (this.disposed || !this.streamSid || this.isAgentSpeaking || this.processingResponse) return;
      if (this.twilioWs.readyState !== WebSocket.OPEN) return;
      const { chunk, nextOffset } = getAmbientChunk(this.ambientOffset, 200);
      this.ambientOffset = nextOffset;
      for (let i = 0; i < chunk.length; i += 160) {
        const frame = chunk.subarray(i, Math.min(i + 160, chunk.length));
        this.twilioWs.send(JSON.stringify({
          event: 'media',
          streamSid: this.streamSid,
          media: { payload: frame.toString('base64') },
        }));
      }
    }, 200);
  }

  private stopAmbientAudio() {
    if (this.ambientInterval) {
      clearInterval(this.ambientInterval);
      this.ambientInterval = null;
    }
  }

  private initSilenceMonitor() {
    this.silenceMonitor = new SilenceMonitor(
      {
        canFire: () => !this.isAgentSpeaking && !this.processingResponse && !this.playbackQueue.isPlaying,
        onNudge: () => {
          const nudge = tts.getRandomNudge();
          if (!nudge) return;
          console.log(`[CallSession] Silence nudge: "${nudge.text}"`);
          this.isAgentSpeaking = true;
          this.stopAmbientAudio();
          this.playbackQueue.sendAudio(nudge.audio);
          this.playbackQueue.sendMark(nudge.text);
        },
        onGoodbye: () => {
          const audio = tts.getGoodbyeAudio();
          if (!audio) {
            this.finalizeGoodbye();
            return;
          }
          console.log('[CallSession] Silence goodbye — playing farewell');
          this.isAgentSpeaking = true;
          this.stopAmbientAudio();
          this.pendingGoodbye = true;
          this.playbackQueue.sendAudio(audio);
          this.playbackQueue.sendMark();
        },
      },
      {
        nudgeAfterQuestionMs: config.silenceNudgeAfterQuestionMs,
        nudgeAfterStatementMs: config.silenceNudgeAfterStatementMs,
        goodbyeAfterMs: config.silenceGoodbyeAfterMs,
        watchdogMs: config.silenceWatchdogMs,
      },
    );
    this.silenceMonitor.startWatchdog();
  }

  private async finalizeApology() {
    this.skipReport = true;
    if (this.callId) {
      await db.updateCallRecord(this.callId, { outcome: 'error' });
    }
    await this.hangup();
  }

  private async finalizeGoodbye() {
    if (this.callId) {
      await db.updateCallRecord(this.callId, { disposition: 'sin_decision' });
    }
    await this.hangup();
  }

  private async hangup() {
    if (this.testMode) {
      if (this.twilioWs.readyState === WebSocket.OPEN) {
        this.twilioWs.send(JSON.stringify({ event: 'stop', streamSid: this.streamSid }));
        this.twilioWs.close();
      }
      return;
    }
    if (this.callSid) {
      await twilio.hangupCall(this.callSid);
    }
  }

  private async connectSTT() {
    this.stt = new DeepgramSTT({
      onStartOfTurn: (transcript: string) => {
        this.silenceMonitor?.disarm();
        this.silenceMonitor?.resetWatchdog();
        if (this.isAgentSpeaking && transcript) {
          this.handleBargeIn();
        }
      },
      onTurnEnd: (text) => {
        this.silenceMonitor?.resetWatchdog();
        this.handleTurnComplete(text).catch((err) =>
          console.error('[CallSession] Turn complete error:', err),
        );
      },
      onProspectActivity: () => {
        this.silenceMonitor?.prospectActivity();
        this.silenceMonitor?.resetWatchdog();
      },
      onError: (err) => console.error('[CallSession] STT error:', err),
      onClose: () => {
        console.log('[CallSession] STT closed');
      },
      onFatalError: (err) => {
        console.error('[CallSession] STT fatal error:', err);
        this.handleSTTFatalError().catch((e) =>
          console.error('[CallSession] Fatal error handler failed:', e),
        );
      },
    });

    await this.stt.connect();
    console.log('[CallSession] STT connected');
  }

  private async handleSTTFatalError() {
    if (this.disposed) return;

    this.silenceMonitor?.dispose();

    const apology = tts.getApologyAudio();
    if (apology && this.streamSid) {
      this.isAgentSpeaking = true;
      this.stopAmbientAudio();
      this.pendingApology = true;
      this.playbackQueue.sendAudio(apology);
      this.playbackQueue.sendMark();
    } else {
      this.skipReport = true;
      if (this.callId) {
        await db.updateCallRecord(this.callId, { outcome: 'error' });
      }
      await this.hangup();
    }
  }

  private async sendGreeting() {
    if (this.greetingSent || this.disposed) return;
    this.greetingSent = true;

    this.initSilenceMonitor();

    this.conversationHistory.push({
      role: 'user',
      content: '[El prospecto contestó la llamada. Salúdalo y preséntate brevemente.]',
    });

    await this.processLLMResponse();
  }

  onAmdVerdict(answeredBy: string) {
    if (this.disposed) return;

    if (this.amdTimeout) {
      clearTimeout(this.amdTimeout);
      this.amdTimeout = null;
    }

    const isHuman = answeredBy === 'human' || answeredBy === 'unknown';
    const isMachine = answeredBy === 'machine_start' || answeredBy === 'fax';

    if (this.amdResolved) {
      if (isMachine && this.greetingSent) {
        console.log(`[CallSession] Late AMD verdict "${answeredBy}" — hanging up`);
        this.skipReport = true;
        this.hangup();
      }
      return;
    }

    this.amdResolved = true;

    if (isHuman) {
      console.log(`[CallSession] AMD: human — sending greeting`);
      this.sendGreeting();
    } else {
      console.log(`[CallSession] AMD: ${answeredBy} — silent cleanup`);
      this.skipReport = true;
      this.hangup();
      this.cleanup();
    }
  }

  handleMedia(payload: string) {
    if (!this.stt || this.disposed) return;
    const audioBuffer = Buffer.from(payload, 'base64');
    this.stt.sendAudio(audioBuffer);
  }

  handleMark(markName: string) {
    this.playbackQueue.handleMarkReceived(markName);
    if (!this.playbackQueue.isPlaying) {
      this.isAgentSpeaking = false;

      if (this.pendingApology) {
        this.pendingApology = false;
        this.finalizeApology();
        return;
      }

      if (this.pendingGoodbye) {
        this.pendingGoodbye = false;
        this.finalizeGoodbye();
        return;
      }

      if (!this.processingResponse && this.silenceMonitor) {
        const lastMsg = this.conversationHistory.filter(m => m.role === 'assistant').pop();
        const endsWithQuestion = !!lastMsg?.content?.trimEnd().endsWith('?');
        this.silenceMonitor.arm(endsWithQuestion);
      }

      if (!this.processingResponse) {
        this.startAmbientAudio();
      }
    }
  }

  private handleBargeIn() {
    console.log('[CallSession] Barge-in detected');

    const spokenText = this.playbackQueue.getConfirmedText();
    if (spokenText) {
      this.conversationHistory.push({ role: 'assistant', content: spokenText + ' —' });
      this.turns.push({ speaker: 'agente', text: spokenText + ' —', timestamp: new Date() });
    }

    this.isAgentSpeaking = false;

    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }

    this.ttsStream?.clear();
    this.playbackQueue.sendClear();
    this.playbackQueue.resetTracking();
    this.phraseQueue.length = 0;
    this.phraseChunker.reset();

    if (this.fillerTimer) {
      clearTimeout(this.fillerTimer);
      this.fillerTimer = null;
    }
  }

  private async handleTurnComplete(text: string) {
    if (this.disposed || !text.trim()) return;

    if (this.voicemailDetector.check(text)) {
      console.log(`[CallSession] Voicemail detected by local patterns: "${text}"`);
      this.skipReport = true;
      if (this.callId) {
        await db.updateCallRecord(this.callId, { outcome: 'buzon', disposition: 'sin_decision' });
      }
      await this.hangup();
      return;
    }

    this.silenceMonitor?.disarm();

    const turnM = this.metrics.startTurn();

    console.log(`[CallSession] Prospect said: "${text}"`);

    this.turns.push({
      speaker: 'prospecto',
      text,
      timestamp: new Date(),
    });

    this.conversationHistory.push({ role: 'user', content: text });
    this.onTranscript?.('prospecto', text);

    this.scheduleConditionalFiller();

    await this.processLLMResponse(turnM);
  }

  private scheduleConditionalFiller() {
    if (!config.enableFillerPhrases || !this.streamSid) return;
    if (this.fillerCount >= config.fillerMaxPerCall) return;

    this.fillerTimer = setTimeout(() => {
      this.fillerTimer = null;
      if (this.disposed || this.isAgentSpeaking || this.playbackQueue.isPlaying) return;
      if (this.fillerCount >= config.fillerMaxPerCall) return;

      const filler = tts.getRandomFiller(this.lastFillerUsed);
      if (!filler) return;

      this.fillerCount++;
      this.lastFillerUsed = filler.text;
      console.log(`[CallSession] Filler played: "${filler.text}" (${this.fillerCount}/${config.fillerMaxPerCall})`);
      this.isAgentSpeaking = true;
      this.stopAmbientAudio();
      this.playbackQueue.sendAudio(filler.audio);
      this.playbackQueue.sendMark(filler.text);
    }, config.fillerDelayMs);
  }

  private async processLLMResponse(turnM?: TurnMetrics) {
    if (this.disposed || !this.streamSid) return;

    this.silenceMonitor?.disarm();

    if (this.currentAbort) {
      this.currentAbort.abort();
    }

    const generation = ++this.responseGeneration;
    this.processingResponse = true;
    this.stopAmbientAudio();
    this.playbackQueue.resetTracking();
    this.currentAbort = new AbortController();
    const signal = this.currentAbort.signal;

    let llmDone = false;
    let ttsConsumer: Promise<void> | null = null;
    let firstChunkOfTurn = true;

    try {
      let fullResponse = '';
      this.phraseChunker.reset();
      this.phraseQueue.length = 0;
      let ttsError: Error | null = null;

      ttsConsumer = (async () => {
        while (!signal.aborted) {
          if (this.phraseQueue.length > 0) {
            const phrase = this.phraseQueue.shift()!;
            const isFirst = firstChunkOfTurn;
            firstChunkOfTurn = false;
            await this.speakChunk(phrase, signal, turnM, isFirst);
          } else if (llmDone) {
            break;
          } else {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      })().catch(err => { ttsError = err; });

      const stream = llm.streamCompletion(this.conversationHistory, signal, this.llmModel);
      let firstToken = true;

      for await (const event of stream) {
        if (signal.aborted) break;

        if (event.type === 'token' && event.text) {
          if (firstToken) {
            if (turnM) this.metrics.markLlmFirstToken(turnM);
            firstToken = false;
            if (this.fillerTimer) {
              clearTimeout(this.fillerTimer);
              this.fillerTimer = null;
            }
          }

          fullResponse += event.text;

          const chunk = this.phraseChunker.addToken(event.text);
          if (chunk) {
            this.phraseQueue.push(chunk);
          }
        }

        if (event.type === 'tool_call' && event.toolName && event.toolArgs) {
          const remaining = this.phraseChunker.flush();
          if (remaining) this.phraseQueue.push(remaining);

          llmDone = true;
          await ttsConsumer;

          const toolResult = await this.executeToolCall(event.toolName, event.toolArgs);

          this.conversationHistory.push({
            role: 'assistant',
            content: fullResponse || '',
            tool_calls: [{ id: event.toolCallId!, name: event.toolName!, arguments: event.toolArgs! }],
          });
          this.conversationHistory.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: event.toolCallId,
          });

          fullResponse = '';
          this.phraseChunker.reset();

          await this.processLLMResponse(turnM);
          return;
        }

        if (event.type === 'done') {
          const remaining = this.phraseChunker.flush();
          if (remaining) this.phraseQueue.push(remaining);
        }
      }

      llmDone = true;
      await ttsConsumer;

      if (ttsError) throw ttsError;

      if (fullResponse.trim()) {
        this.conversationHistory.push({ role: 'assistant', content: fullResponse });
        this.turns.push({
          speaker: 'agente',
          text: fullResponse,
          timestamp: new Date(),
        });
        this.onTranscript?.('agente', fullResponse);
      }

      if (turnM) {
        this.metrics.logTurn(turnM);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[CallSession] LLM response error:', err);
    } finally {
      llmDone = true;
      if (ttsConsumer) await ttsConsumer.catch(() => {});
      if (this.responseGeneration === generation) {
        this.processingResponse = false;
        if (!this.playbackQueue.isPlaying) {
          this.startAmbientAudio();
        }
      }
    }
  }

  private async speakChunk(text: string, signal: AbortSignal, turnM?: TurnMetrics, isFirstChunk = false) {
    if (signal.aborted || !this.streamSid) return;

    try {
      this.isAgentSpeaking = true;
      let audio: Buffer;

      if (this.ttsStream?.isConnected) {
        this.ttsStream.speak(text);
        audio = await this.ttsStream.flush();
      } else {
        audio = await tts.synthesize(text, signal, this.ttsVoice);
      }

      if (signal.aborted || !this.streamSid) return;

      if (isFirstChunk && turnM) {
        this.metrics.markTtsFirstByte(turnM);
      }

      if (audio.length > 0) {
        if (isFirstChunk && turnM) {
          this.metrics.markTtsPlayStart(turnM);
        }
        this.playbackQueue.sendAudio(audio);
        this.playbackQueue.sendMark(text);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[CallSession] TTS error:', err);
    }
  }

  private playTypingSounds(durationMs: number) {
    if (!this.streamSid || this.disposed) return;
    const typingAudio = generateTypingBurst(durationMs);
    this.isAgentSpeaking = true;
    this.playbackQueue.sendAudio(typingAudio);
    this.playbackQueue.sendMark();
  }

  private async preloadSlots(): Promise<void> {
    try {
      const conn = await selectVendedor(this.ownerId, undefined);
      if (!conn) {
        console.log('[CallSession] No calendar connection — slots not preloaded');
        return;
      }

      this.calendarConnection = conn;

      const now = new Date();
      const fiveDaysOut = new Date(now.getTime() + 6 * 24 * 3600_000);

      const freeBusy = await gcal.getFreeBusy(conn, now.toISOString(), fiveDaysOut.toISOString());
      this.cachedSlots = computeAvailableSlots(conn, freeBusy, now, 5);
      this.slotsReady = true;

      console.log(`[CallSession] Preloaded ${this.cachedSlots.length} slots for owner ${this.ownerId}`);
    } catch (err) {
      console.warn('[CallSession] Slot preload failed (will fall back to text mode):', err);
      this.slotsReady = false;
    }
  }

  private async executeToolCall(name: string, argsJson: string): Promise<string> {
    try {
      const args = JSON.parse(argsJson);
      console.log(`[CallSession] Tool call: ${name}`, args);

      switch (name) {
        case 'consultar_disponibilidad':
          return this.handleConsultarDisponibilidad(args.preferencia);

        case 'agendar_cita':
          return await this.handleAgendarCita(args);

        case 'registrar_interes': {
          const nivelMap: Record<string, ProspectStatus> = {
            alto: 'interesado',
            medio: 'interesado',
            bajo: 'no_interesado',
            ninguno: 'no_interesado',
          };
          const status = nivelMap[args.nivel] || 'contactado';
          if (!this.testMode) {
            await db.updateProspectStatus(this.prospectId, status);
          }
          return JSON.stringify({ success: true, message: `Interés registrado: ${args.nivel}` });
        }

        case 'consultar_sistema': {
          console.log(`[CallSession] Agent consulting: ${args.motivo}`);
          this.playTypingSounds(3000);
          return JSON.stringify({ success: true, message: 'Consulta realizada. Ahora responde al prospecto con la información.' });
        }

        case 'finalizar_llamada': {
          const dispMap: Record<string, CallDisposition> = {
            interesado: 'interesado',
            agendo: 'agendo',
            no_interesado: 'no_interesado',
            pidio_no_llamar: 'pidio_no_llamar',
            sin_decision: 'sin_decision',
          };
          if (this.callId) {
            await db.updateCallRecord(this.callId, {
              disposition: dispMap[args.resultado] || 'pendiente',
            });
          }
          if (args.resultado === 'pidio_no_llamar' && !this.testMode) {
            await db.updateProspectStatus(this.prospectId, 'descartado');
          }
          await this.hangup();
          return JSON.stringify({ success: true, message: 'Llamada finalizada' });
        }

        default:
          return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
      }
    } catch (err) {
      console.error('[CallSession] Tool execution error:', err);
      return JSON.stringify({ error: 'Error ejecutando herramienta' });
    }
  }

  private handleConsultarDisponibilidad(preferencia?: string): string {
    if (!this.slotsReady || this.cachedSlots.length === 0) {
      return JSON.stringify({ status: 'sin_calendario' });
    }

    let slots = this.cachedSlots;
    if (preferencia) {
      slots = filterSlotsByPreference(slots, preferencia);
    } else {
      slots = slots.slice(0, 3);
    }

    return JSON.stringify({
      status: 'ok',
      slots: slots.map(s => ({ id: s.id, etiquetaHablada: s.etiquetaHablada })),
    });
  }

  private async handleAgendarCita(args: {
    slot_id: string;
    nombre_contacto: string;
    telefono_confirmacion?: string;
    email?: string;
    notas?: string;
  }): Promise<string> {
    if (this.testMode) {
      const slot = this.cachedSlots.find(s => s.id === args.slot_id);
      return JSON.stringify({
        success: true,
        etiquetaHablada: slot?.etiquetaHablada || '',
        mensaje: 'Cita registrada (modo prueba).',
      });
    }

    const slot = this.cachedSlots.find(s => s.id === args.slot_id);

    if (!slot) {
      if (this.callId) {
        await db.updateCallRecord(this.callId, {
          disposition: 'agendo',
          next_action: `Cita solicitada por ${args.nombre_contacto}`,
        });
        await db.updateProspectStatus(this.prospectId, 'agendado');
      }
      return JSON.stringify({
        success: true,
        etiquetaHablada: '',
        mensaje: 'Cita registrada. Un vendedor confirmará el horario.',
      });
    }

    const conn = this.calendarConnection;
    const phone = args.telefono_confirmacion || this.prospectPhone || '';

    let googleEventId: string | null = null;
    let meetUrl: string | null = null;
    let estado: 'confirmada' | 'tentativa' = 'confirmada';

    if (conn) {
      try {
        const nowFreeBusy = await gcal.getFreeBusy(
          conn,
          slot.inicioIso,
          slot.finIso,
        );
        if (nowFreeBusy.length > 0) {
          const alternativas = this.cachedSlots
            .filter(s => s.id !== slot.id)
            .slice(0, 2)
            .map(s => ({ id: s.id, etiquetaHablada: s.etiquetaHablada }));

          return JSON.stringify({
            success: false,
            motivo: 'slot_ocupado',
            alternativas,
          });
        }
      } catch (err) {
        console.warn('[CallSession] FreeBusy re-check failed, proceeding anyway:', err);
      }

      try {
        const vendedorProfile = await db.getSupabaseAdmin()
          .from('profiles')
          .select('nombre')
          .eq('id', conn.owner_id)
          .single();
        const vendedorNombre = vendedorProfile.data?.nombre || 'Orkesta';

        const result = await gcal.createEvent(conn, {
          titulo: `Demo Orkesta — ${args.nombre_contacto}`,
          descripcion: `Cita agendada por el agente de voz de Orkesta.\nContacto: ${args.nombre_contacto}\n${args.notas || ''}`.trim(),
          inicio: slot.inicioIso,
          fin: slot.finIso,
          timezone: conn.timezone,
          invitados: args.email ? [args.email] : [],
        });

        googleEventId = result.eventId;
        meetUrl = result.meetUrl;

        if (phone) {
          try {
            const meetInfo = meetUrl ? `\nLiga de videollamada: ${meetUrl}` : '';
            const msgBody = `Hola ${args.nombre_contacto}, tu cita con ${vendedorNombre} de Orkesta quedo confirmada ${slot.etiquetaHablada}. Duracion: ${conn.duracion_default_min} minutos.${meetInfo}`;

            const { channel } = await twilio.sendConfirmationMessage({ to: phone, body: msgBody });

            await db.createAppointment({
              callId: this.callId,
              prospectId: this.prospectId,
              vendedorId: conn.owner_id,
              inicio: slot.inicioIso,
              fin: slot.finIso,
              timezone: conn.timezone,
              googleEventId,
              meetUrl,
              estado: 'confirmada',
              canalConfirmacion: channel,
              confirmacionEnviadaAt: new Date().toISOString(),
              notas: args.notas,
            });
          } catch (msgErr) {
            console.warn('[CallSession] Confirmation message failed:', msgErr);
            await db.createAppointment({
              callId: this.callId,
              prospectId: this.prospectId,
              vendedorId: conn.owner_id,
              inicio: slot.inicioIso,
              fin: slot.finIso,
              timezone: conn.timezone,
              googleEventId,
              meetUrl,
              estado: 'confirmada',
              canalConfirmacion: 'ninguno',
              notas: args.notas,
            });
          }
        } else {
          await db.createAppointment({
            callId: this.callId,
            prospectId: this.prospectId,
            vendedorId: conn.owner_id,
            inicio: slot.inicioIso,
            fin: slot.finIso,
            timezone: conn.timezone,
            googleEventId,
            meetUrl,
            estado: 'confirmada',
            canalConfirmacion: 'ninguno',
            notas: args.notas,
          });
        }
      } catch (calErr) {
        console.error('[CallSession] Google Calendar event creation failed:', calErr);
        estado = 'tentativa';

        await db.createAppointment({
          callId: this.callId,
          prospectId: this.prospectId,
          vendedorId: conn.owner_id,
          inicio: slot.inicioIso,
          fin: slot.finIso,
          timezone: conn.timezone,
          estado: 'tentativa',
          canalConfirmacion: 'ninguno',
          notas: `${args.notas || ''} [Error creando evento en Google Calendar]`.trim(),
        });
      }
    } else {
      await db.createAppointment({
        callId: this.callId,
        prospectId: this.prospectId,
        vendedorId: this.ownerId,
        inicio: slot.inicioIso,
        fin: slot.finIso,
        timezone: 'America/Mexico_City',
        estado: 'tentativa',
        canalConfirmacion: 'ninguno',
        notas: args.notas,
      });
      estado = 'tentativa';
    }

    if (this.callId) {
      await db.updateCallRecord(this.callId, { disposition: 'agendo' });
      await db.updateProspectStatus(this.prospectId, 'agendado');
    }

    return JSON.stringify({
      success: true,
      etiquetaHablada: slot.etiquetaHablada,
      meetUrl: meetUrl || undefined,
      mensaje: estado === 'tentativa'
        ? 'Cita registrada como tentativa. Un vendedor la confirmará.'
        : `Cita confirmada ${slot.etiquetaHablada}`,
    });
  }

  async cleanup() {
    if (this.disposed) return;
    this.disposed = true;

    console.log(`[CallSession] Cleaning up call ${this.callSid}`);

    this.stopAmbientAudio();
    this.silenceMonitor?.dispose();
    this.silenceMonitor = null;
    if (this.fillerTimer) {
      clearTimeout(this.fillerTimer);
      this.fillerTimer = null;
    }
    if (this.amdTimeout) {
      clearTimeout(this.amdTimeout);
      this.amdTimeout = null;
    }

    this.voicemailDetector.dispose();

    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }

    this.playbackQueue.reset();
    this.stt?.close();
    this.ttsStream?.close();
    this.ttsStream = null;

    const summary = this.metrics.getSummary();
    if (summary.count > 0) {
      console.log(`[Metrics] Call ${this.callSid} summary — p50: ${summary.p50}ms | p95: ${summary.p95}ms | turns: ${summary.count}`);
    }

    const endTime = new Date();
    const durationSeconds = Math.round((endTime.getTime() - this.startTime.getTime()) / 1000);

    if (this.callId) {
      try {
        await db.updateCallRecord(this.callId, {
          fin: endTime.toISOString(),
          duracion_segundos: durationSeconds,
          outcome: 'contestado',
        });

        await db.saveTranscripts(this.callId, this.turns);

        if (this.turns.length > 0 && !this.skipReport) {
          console.log('[CallSession] Generating call report...');
          const report = await llm.generateCallReport(this.turns, this.llmModel);
          await db.saveCallReport(this.callId, report);
          console.log('[CallSession] Report saved');
        } else if (this.skipReport) {
          console.log('[CallSession] Skipping report (voicemail/machine)');
        }
      } catch (err) {
        console.error('[CallSession] Cleanup save error:', err);
      }
    }

    console.log(`[CallSession] Call ${this.callSid} ended — duration: ${durationSeconds}s, turns: ${this.turns.length}`);
  }
}
