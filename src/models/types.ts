export type ProspectStatus =
  | 'nuevo'
  | 'contactado'
  | 'interesado'
  | 'no_interesado'
  | 'no_contesta'
  | 'agendado'
  | 'descartado';

export type CallOutcome =
  | 'contestado'
  | 'buzon'
  | 'no_contesto'
  | 'colgo'
  | 'numero_invalido'
  | 'error';

export type CallDisposition =
  | 'interesado'
  | 'agendo'
  | 'no_interesado'
  | 'pidio_no_llamar'
  | 'sin_decision'
  | 'pendiente';

export type Speaker = 'agente' | 'prospecto';

export interface Profile {
  id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'vendedor';
  created_at: string;
}

export interface Prospect {
  id: string;
  nombre: string;
  telefono: string;
  empresa: string | null;
  email: string | null;
  campos_personalizados: Record<string, unknown> | null;
  status: ProspectStatus;
  owner_id: string;
  notas: string | null;
  do_not_call: boolean;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  nombre: string;
  objetivo: string;
  contexto_negocio: string;
  voz_configurada: string | null;
  llm_model: string | null;
  system_prompt: string;
  activa: boolean;
  owner_id: string;
  created_at: string;
}

export interface Call {
  id: string;
  prospect_id: string;
  campaign_id: string | null;
  twilio_call_sid: string;
  inicio: string;
  fin: string | null;
  duracion_segundos: number | null;
  outcome: CallOutcome | null;
  disposition: CallDisposition | null;
  next_action: string | null;
  next_action_date: string | null;
  sentimiento: string | null;
  grabacion_url: string | null;
  owner_id: string;
  created_at: string;
}

export interface Transcript {
  id: string;
  call_id: string;
  speaker: Speaker;
  texto: string;
  timestamp_inicio: string;
  timestamp_fin: string | null;
}

export interface CallReport {
  id: string;
  call_id: string;
  resumen: string;
  puntos_clave: string[];
  objeciones_detectadas: string[];
  nivel_interes: number;
  datos_extraidos: Record<string, unknown>;
  recomendacion_siguiente_paso: string;
  created_at: string;
}

export interface ConversationTurn {
  speaker: Speaker;
  text: string;
  timestamp: Date;
}

export interface CallSession {
  callSid: string;
  streamSid: string | null;
  prospectId: string;
  campaignId: string | null;
  callId: string | null;
  conversationHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  turns: ConversationTurn[];
  currentUserUtterance: string;
  isAgentSpeaking: boolean;
  agentAudioQueue: Buffer[];
  markCounter: number;
  lastPlayedMark: number;
  startTime: Date;
  sttConnected: boolean;
  ttsAbortController: AbortController | null;
  openaiAbortController: AbortController | null;
}
