import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config, isConfigured } from '../config';
import type {
  Prospect, Campaign, Call, CallReport,
  ConversationTurn, ProspectStatus, CallOutcome, CallDisposition,
  CalendarConnection, Appointment, AppointmentStatus,
} from '../models/types';

let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    if (!isConfigured('supabase')) {
      throw new Error('Supabase no está configurado. Configura SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.');
    }
    _supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  }
  return _supabaseAdmin;
}

// Keep backward-compatible export as a getter
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseAdmin() as any)[prop];
  },
});

export function supabaseClient(accessToken: string) {
  if (!isConfigured('supabase')) {
    throw new Error('Supabase no está configurado.');
  }
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('prospects')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function getProspectsByOwner(ownerId: string): Promise<Prospect[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('prospects')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await getSupabaseAdmin()
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
  const { data, error } = await getSupabaseAdmin()
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
  const { error } = await getSupabaseAdmin()
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
  const { error } = await getSupabaseAdmin().from('transcripts').insert(rows);
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
  const { error } = await getSupabaseAdmin()
    .from('call_reports')
    .insert({ call_id: callId, ...report });
  if (error) throw error;
}

export async function updateProspectStatus(prospectId: string, status: ProspectStatus) {
  const { error } = await getSupabaseAdmin()
    .from('prospects')
    .update({ status })
    .eq('id', prospectId);
  if (error) throw error;
}

export async function getCallsForProspect(prospectId: string): Promise<Call[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('calls')
    .select('*')
    .eq('prospect_id', prospectId)
    .order('inicio', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---- Calendar Connections ----

export async function getCalendarConnection(ownerId: string): Promise<CalendarConnection | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('calendar_connections')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('activo', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCalendarConnectionForUser(ownerId: string): Promise<CalendarConnection | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('calendar_connections')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertCalendarConnection(params: {
  ownerId: string;
  provider: string;
  googleEmail: string;
  refreshToken: string;
  accessToken: string;
  tokenExpiresAt: string;
}): Promise<CalendarConnection> {
  const { data, error } = await getSupabaseAdmin()
    .from('calendar_connections')
    .upsert({
      owner_id: params.ownerId,
      provider: params.provider,
      google_email: params.googleEmail,
      refresh_token: params.refreshToken,
      access_token: params.accessToken,
      token_expires_at: params.tokenExpiresAt,
      activo: true,
    }, { onConflict: 'owner_id,provider' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateCalendarSettings(connectionId: string, settings: {
  timezone?: string;
  horario_inicio?: string;
  horario_fin?: string;
  dias_habiles?: number[];
  duracion_default_min?: number;
  buffer_min?: number;
}): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('calendar_connections')
    .update(settings)
    .eq('id', connectionId);
  if (error) throw error;
}

export async function deleteCalendarConnection(connectionId: string): Promise<CalendarConnection | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('calendar_connections')
    .select('*')
    .eq('id', connectionId)
    .single();
  if (error) return null;

  await getSupabaseAdmin()
    .from('calendar_connections')
    .delete()
    .eq('id', connectionId);

  return data;
}

// ---- Appointments ----

export async function createAppointment(params: {
  callId: string | null;
  prospectId: string | null;
  vendedorId: string;
  inicio: string;
  fin: string;
  timezone: string;
  googleEventId?: string | null;
  meetUrl?: string | null;
  estado?: AppointmentStatus;
  canalConfirmacion?: string | null;
  confirmacionEnviadaAt?: string | null;
  notas?: string | null;
}): Promise<Appointment> {
  const { data, error } = await getSupabaseAdmin()
    .from('appointments')
    .insert({
      call_id: params.callId,
      prospect_id: params.prospectId,
      vendedor_id: params.vendedorId,
      inicio: params.inicio,
      fin: params.fin,
      timezone: params.timezone,
      google_event_id: params.googleEventId || null,
      meet_url: params.meetUrl || null,
      estado: params.estado || 'confirmada',
      canal_confirmacion: params.canalConfirmacion || null,
      confirmacion_enviada_at: params.confirmacionEnviadaAt || null,
      notas: params.notas || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function getAppointmentsByOwner(ownerId: string): Promise<Appointment[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('appointments')
    .select('*, prospects(nombre, telefono, empresa)')
    .eq('vendedor_id', ownerId)
    .gte('inicio', new Date().toISOString())
    .order('inicio', { ascending: true })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function countRecentAppointments(vendedorId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { count, error } = await getSupabaseAdmin()
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('vendedor_id', vendedorId)
    .gte('created_at', sevenDaysAgo);
  if (error) throw error;
  return count || 0;
}

export async function getCallWithDetails(callId: string) {
  const admin = getSupabaseAdmin();

  const { data: call, error: callError } = await admin
    .from('calls')
    .select('*')
    .eq('id', callId)
    .single();
  if (callError) throw callError;

  const { data: transcripts, error: tError } = await admin
    .from('transcripts')
    .select('*')
    .eq('call_id', callId)
    .order('timestamp_inicio', { ascending: true });
  if (tError) throw tError;

  const { data: report, error: rError } = await admin
    .from('call_reports')
    .select('*')
    .eq('call_id', callId)
    .maybeSingle();
  if (rError) throw rError;

  return { call, transcripts: transcripts || [], report };
}
