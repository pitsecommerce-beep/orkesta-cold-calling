import WebSocket from 'ws';
import { DeepgramSTT } from '../services/deepgram-stt';
import * as tts from '../services/deepgram-tts';
import * as llm from '../services/llm';
import * as db from '../services/supabase';
import * as twilio from '../services/twilio';
import { TurnDetector, TurnCompleteEvent } from '../pipeline/turn-detector';
import { PhraseChunker } from '../pipeline/phrase-chunker';
import { PlaybackQueue } from '../pipeline/playback-queue';
import { getAmbientChunk, generateTypingBurst } from '../services/ambient-audio';
import { config } from '../config';
import type { ConversationTurn, CallDisposition, ProspectStatus } from '../models/types';
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
  private turnDetector: TurnDetector;
  private phraseChunker: PhraseChunker;
  private playbackQueue: PlaybackQueue;

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

  private processingResponse = false;
  private ambientInterval: NodeJS.Timeout | null = null;
  private ambientOffset = 0;
  private phraseQueue: string[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private noResponseCount = 0;
  private static readonly SILENCE_TIMEOUT_MS = 15000;
  private static readonly MAX_NO_RESPONSE = 2;

  constructor(ws: WebSocket, params: { prospectId: string; campaignId: string; ownerId: string }) {
    this.twilioWs = ws;
    this.prospectId = params.prospectId;
    this.campaignId = params.campaignId;
    this.ownerId = params.ownerId;
    this.startTime = new Date();

    this.turnDetector = new TurnDetector();
    this.phraseChunker = new PhraseChunker();
    this.playbackQueue = new PlaybackQueue();

    this.turnDetector.on('turn_complete', (event: TurnCompleteEvent) => {
      this.handleTurnComplete(event.text).catch((err) =>
        console.error('[CallSession] Turn complete error:', err),
      );
    });
  }

  async initialize(streamSid: string, callSid: string) {
    this.streamSid = streamSid;
    this.callSid = callSid;
    this.playbackQueue.setTarget(this.twilioWs, streamSid);

    console.log(`[CallSession] Initializing call ${callSid} for prospect ${this.prospectId}`);

    try {
      const [prospect, campaign] = await Promise.all([
        db.getProspect(this.prospectId),
        this.campaignId ? db.getCampaign(this.campaignId) : null,
      ]);

      if (!prospect) {
        console.error('[CallSession] Prospect not found:', this.prospectId);
        await this.hangup();
        return;
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

      this.callId = await db.createCallRecord({
        prospectId: this.prospectId,
        campaignId: this.campaignId || null,
        twilioCallSid: callSid,
        ownerId: this.ownerId,
      });

      const systemPrompt = llm.buildSystemPrompt({
        campaignObjective: campaign?.objetivo || 'Presentar los servicios de Orkesta y detectar interés.',
        businessContext: campaign?.contexto_negocio || 'Orkesta ofrece soluciones de IA para empresas.',
        customSystemPrompt: campaign?.system_prompt,
        prospectName: prospect.nombre,
        prospectCompany: prospect.empresa || undefined,
        prospectNotes: prospect.notas || undefined,
        agentName: campaign?.nombre_agente || undefined,
        tone: this.toneAgente,
      });

      this.conversationHistory.push({ role: 'system', content: systemPrompt });

      await this.connectSTT();

      await db.updateProspectStatus(this.prospectId, 'contactado');

      this.startAmbientAudio();

      setTimeout(() => this.sendGreeting(), 500);
    } catch (err) {
      console.error('[CallSession] Initialize error:', err);
    }
  }

  private startAmbientAudio() {
    if (this.ambientInterval) return;
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

  private resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.handleSilenceTimeout();
    }, CallSession.SILENCE_TIMEOUT_MS);
  }

  private async handleSilenceTimeout() {
    if (this.disposed) return;
    this.noResponseCount++;

    if (this.noResponseCount >= CallSession.MAX_NO_RESPONSE) {
      console.log(`[CallSession] No response after ${this.noResponseCount} attempts — hanging up`);
      if (this.callId) {
        await db.updateCallRecord(this.callId, { disposition: 'sin_decision' });
      }
      await this.hangup();
      return;
    }

    console.log(`[CallSession] No response — attempt ${this.noResponseCount}`);
    this.conversationHistory.push({
      role: 'user',
      content: '[Silencio prolongado — el prospecto no ha respondido. Di "¿Hola? ¿Me escucha?" brevemente.]',
    });
    await this.processLLMResponse();
    this.resetSilenceTimer();
  }

  private async hangup() {
    if (this.callSid) {
      await twilio.hangupCall(this.callSid);
    }
  }

  private async connectSTT() {
    this.stt = new DeepgramSTT({
      onTranscript: (text, isFinal, speechFinal) => {
        if (this.isAgentSpeaking && isFinal && text.trim().split(/\s+/).length >= 2) {
          this.handleBargeIn();
        }
        if (!this.isAgentSpeaking) {
          this.turnDetector.handleTranscript(text, isFinal, speechFinal);
        }
      },
      onUtteranceEnd: () => {
        if (!this.isAgentSpeaking) {
          this.turnDetector.handleUtteranceEnd();
        }
      },
      onError: (err) => console.error('[CallSession] STT error:', err),
      onClose: () => {
        console.log('[CallSession] STT closed');
        if (!this.disposed) {
          console.log('[CallSession] Reconnecting STT...');
          this.connectSTT().catch((err) =>
            console.error('[CallSession] STT reconnect failed:', err),
          );
        }
      },
    });

    await this.stt.connect();
    console.log('[CallSession] STT connected');
  }

  private async sendGreeting() {
    if (this.greetingSent || this.disposed) return;
    this.greetingSent = true;

    this.conversationHistory.push({
      role: 'user',
      content: '[El prospecto contestó la llamada. Salúdalo y preséntate brevemente.]',
    });

    await this.processLLMResponse();
    this.resetSilenceTimer();
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
      if (!this.processingResponse) {
        this.startAmbientAudio();
      }
    }
  }

  private handleBargeIn() {
    console.log('[CallSession] Barge-in detected');
    this.isAgentSpeaking = false;

    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }

    this.playbackQueue.sendClear();
    this.phraseQueue.length = 0;
    this.phraseChunker.reset();
    this.turnDetector.reset();
  }

  private async handleTurnComplete(text: string) {
    if (this.disposed || !text.trim()) return;

    this.noResponseCount = 0;
    this.resetSilenceTimer();

    console.log(`[CallSession] Prospect said: "${text}"`);

    this.turns.push({
      speaker: 'prospecto',
      text,
      timestamp: new Date(),
    });

    this.conversationHistory.push({ role: 'user', content: text });

    if (config.enableFillerPhrases && this.streamSid) {
      const filler = tts.getRandomFiller();
      if (filler) {
        this.playbackQueue.sendAudio(filler.audio);
        this.playbackQueue.sendMark();
        this.isAgentSpeaking = true;
      }
    }

    await this.processLLMResponse();
  }

  private async processLLMResponse() {
    if (this.disposed || !this.streamSid) return;

    this.processingResponse = true;
    this.stopAmbientAudio();
    this.currentAbort = new AbortController();
    const signal = this.currentAbort.signal;

    try {
      let fullResponse = '';
      this.phraseChunker.reset();
      this.phraseQueue.length = 0;
      let llmDone = false;
      let ttsError: Error | null = null;

      const ttsConsumer = (async () => {
        while (!signal.aborted) {
          if (this.phraseQueue.length > 0) {
            const phrase = this.phraseQueue.shift()!;
            await this.speakChunk(phrase, signal);
          } else if (llmDone) {
            break;
          } else {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      })().catch(err => { ttsError = err; });

      const stream = llm.streamCompletion(this.conversationHistory, signal, this.llmModel);

      for await (const event of stream) {
        if (signal.aborted) break;

        if (event.type === 'token' && event.text) {
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

          await this.processLLMResponse();
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
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[CallSession] LLM response error:', err);
    } finally {
      this.processingResponse = false;
      if (!this.playbackQueue.isPlaying) {
        this.startAmbientAudio();
      }
    }
  }

  private async speakChunk(text: string, signal: AbortSignal) {
    if (signal.aborted || !this.streamSid) return;

    try {
      this.isAgentSpeaking = true;
      await tts.synthesizeStream(
        text,
        (chunk) => {
          if (!signal.aborted && this.streamSid) {
            this.playbackQueue.sendAudio(chunk);
          }
        },
        signal,
        this.ttsVoice,
      );

      if (!signal.aborted && this.streamSid) {
        this.playbackQueue.sendMark();
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

  private async executeToolCall(name: string, argsJson: string): Promise<string> {
    try {
      const args = JSON.parse(argsJson);
      console.log(`[CallSession] Tool call: ${name}`, args);

      switch (name) {
        case 'agendar_cita': {
          if (this.callId) {
            await db.updateCallRecord(this.callId, {
              disposition: 'agendo',
              next_action: `Cita agendada: ${args.fecha} ${args.hora}`,
              next_action_date: args.fecha,
            });
            await db.updateProspectStatus(this.prospectId, 'agendado');
          }
          return JSON.stringify({ success: true, message: `Cita agendada para ${args.fecha} a las ${args.hora}` });
        }

        case 'registrar_interes': {
          const nivelMap: Record<string, ProspectStatus> = {
            alto: 'interesado',
            medio: 'interesado',
            bajo: 'no_interesado',
            ninguno: 'no_interesado',
          };
          const status = nivelMap[args.nivel] || 'contactado';
          await db.updateProspectStatus(this.prospectId, status);
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
          if (args.resultado === 'pidio_no_llamar') {
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

  async cleanup() {
    if (this.disposed) return;
    this.disposed = true;

    console.log(`[CallSession] Cleaning up call ${this.callSid}`);

    this.stopAmbientAudio();
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }

    this.turnDetector.reset();
    this.playbackQueue.reset();
    this.stt?.close();

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

        if (this.turns.length > 0) {
          console.log('[CallSession] Generating call report...');
          const report = await llm.generateCallReport(this.turns, this.llmModel);
          await db.saveCallReport(this.callId, report);
          console.log('[CallSession] Report saved');
        }
      } catch (err) {
        console.error('[CallSession] Cleanup save error:', err);
      }
    }

    console.log(`[CallSession] Call ${this.callSid} ended — duration: ${durationSeconds}s, turns: ${this.turns.length}`);
  }
}
