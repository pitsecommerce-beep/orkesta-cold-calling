import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import type {
  Prospect, Campaign, Call, CallReport,
  ConversationTurn, ProspectStatus, CallOutcome, CallDisposition,
} from '../models/types';

export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
);

export function supabaseClient(accessToken: string) {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const { data, error } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function getProspectsByOwner(ownerId: string): Promise<Prospect[]> {
  const { data, error } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createCallRecord(params: {
  prospectId: string;
  campaignId: string | null;
  twilioCallSid: string;
  ownerId: string;
}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .insert({
      prospect_id: params.prospectId,
      campaign_id: params.campaignId,
      twilio_call_sid: params.twilioCallSid,
      owner_id: params.ownerId,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateCallRecord(callId: string, updates: {
  fin?: string;
  duracion_segundos?: number;
  outcome?: CallOutcome;
  disposition?: CallDisposition;
  next_action?: string;
  next_action_date?: string;
  sentimiento?: string;
  grabacion_url?: string;
}) {
  const { error } = await supabaseAdmin
    .from('calls')
    .update(updates)
    .eq('id', callId);
  if (error) throw error;
}

export async function saveTranscripts(callId: string, turns: ConversationTurn[]) {
  const rows = turns.map((t) => ({
    call_id: callId,
    speaker: t.speaker,
    texto: t.text,
    timestamp_inicio: t.timestamp.toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin.from('transcripts').insert(rows);
  if (error) throw error;
}

export async function saveCallReport(callId: string, report: {
  resumen: string;
  puntos_clave: string[];
  objeciones_detectadas: string[];
  nivel_interes: number;
  datos_extraidos: Record<string, unknown>;
  recomendacion_siguiente_paso: string;
}) {
  const { error } = await supabaseAdmin
    .from('call_reports')
    .insert({ call_id: callId, ...report });
  if (error) throw error;
}

export async function updateProspectStatus(prospectId: string, status: ProspectStatus) {
  const { error } = await supabaseAdmin
    .from('prospects')
    .update({ status })
    .eq('id', prospectId);
  if (error) throw error;
}

export async function getCallsForProspect(prospectId: string): Promise<Call[]> {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('*')
    .eq('prospect_id', prospectId)
    .order('inicio', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getCallWithDetails(callId: string) {
  const { data: call, error: callError } = await supabaseAdmin
    .from('calls')
    .select('*')
    .eq('id', callId)
    .single();
  if (callError) throw callError;

  const { data: transcripts, error: tError } = await supabaseAdmin
    .from('transcripts')
    .select('*')
    .eq('call_id', callId)
    .order('timestamp_inicio', { ascending: true });
  if (tError) throw tError;

  const { data: report, error: rError } = await supabaseAdmin
    .from('call_reports')
    .select('*')
    .eq('call_id', callId)
    .maybeSingle();
  if (rError) throw rError;

  return { call, transcripts: transcripts || [], report };
}
