import { config } from '../config';
import { encrypt, decrypt } from './encryption';
import { getSupabaseAdmin } from './supabase';
import type { CalendarConnection } from '../models/types';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const refreshInFlight = new Map<string, Promise<string>>();

function maskToken(token: string): string {
  return token.slice(0, 6) + '***';
}

export async function refreshAccessTokenIfNeeded(connection: CalendarConnection): Promise<string> {
  if (connection.access_token && connection.token_expires_at) {
    const expiresAt = new Date(connection.token_expires_at).getTime();
    const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
    if (expiresAt > fiveMinFromNow) {
      return connection.access_token;
    }
  }

  const ownerId = connection.owner_id;
  const existing = refreshInFlight.get(ownerId);
  if (existing) return existing;

  const promise = doRefresh(connection);
  refreshInFlight.set(ownerId, promise);
  try {
    return await promise;
  } finally {
    refreshInFlight.delete(ownerId);
  }
}

async function doRefresh(connection: CalendarConnection): Promise<string> {
  let refreshToken: string;
  try {
    refreshToken = decrypt(connection.refresh_token);
  } catch {
    console.error('[GoogleCal] No se pudo descifrar el refresh token para owner', connection.owner_id);
    throw new Error('refresh_token_decrypt_failed');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[GoogleCal] Token refresh failed:', res.status, body);
    if (res.status === 400 || res.status === 401) {
      await getSupabaseAdmin()
        .from('calendar_connections')
        .update({ activo: false })
        .eq('id', connection.id);
      throw new Error('refresh_token_revoked');
    }
    throw new Error(`token_refresh_${res.status}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  console.log('[GoogleCal] Token refreshed for owner', connection.owner_id, '— expires', expiresAt);

  await getSupabaseAdmin()
    .from('calendar_connections')
    .update({ access_token: data.access_token, token_expires_at: expiresAt })
    .eq('id', connection.id);

  connection.access_token = data.access_token;
  connection.token_expires_at = expiresAt;

  return data.access_token;
}

async function googleFetch(
  accessToken: string,
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };

  let res = await fetch(url, { ...options, headers });

  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    console.warn(`[GoogleCal] ${res.status} — reintentando en 1s`);
    await new Promise(r => setTimeout(r, 1000));
    res = await fetch(url, { ...options, headers });
  }

  return res;
}

export interface FreeBusyBlock {
  start: string;
  end: string;
}

export async function getFreeBusy(
  connection: CalendarConnection,
  timeMin: string,
  timeMax: string,
): Promise<FreeBusyBlock[]> {
  const accessToken = await refreshAccessTokenIfNeeded(connection);
  const calendarId = connection.calendar_id || 'primary';

  const res = await googleFetch(accessToken, `${GOOGLE_CALENDAR_BASE}/freeBusy`, {
    method: 'POST',
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: connection.timezone,
      items: [{ id: calendarId }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[GoogleCal] freeBusy failed:', res.status, body);
    throw new Error(`freebusy_${res.status}`);
  }

  const data = await res.json() as {
    calendars: Record<string, { busy: FreeBusyBlock[] }>;
  };

  return data.calendars[calendarId]?.busy || [];
}

export interface CreateEventParams {
  titulo: string;
  descripcion: string;
  inicio: string;
  fin: string;
  timezone: string;
  invitados: string[];
}

export interface CreateEventResult {
  eventId: string;
  meetUrl: string | null;
  htmlLink: string;
}

export async function createEvent(
  connection: CalendarConnection,
  params: CreateEventParams,
): Promise<CreateEventResult> {
  const accessToken = await refreshAccessTokenIfNeeded(connection);
  const calendarId = connection.calendar_id || 'primary';

  const attendees = params.invitados
    .filter(e => e && e.includes('@'))
    .map(email => ({ email }));

  const body = {
    summary: params.titulo,
    description: params.descripcion,
    start: { dateTime: params.inicio, timeZone: params.timezone },
    end: { dateTime: params.fin, timeZone: params.timezone },
    attendees: attendees.length > 0 ? attendees : undefined,
    conferenceData: {
      createRequest: {
        requestId: `orkesta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: { useDefault: true },
  };

  const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
  const res = await googleFetch(accessToken, url, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('[GoogleCal] createEvent failed:', res.status, errBody);
    throw new Error(`create_event_${res.status}`);
  }

  const event = await res.json() as {
    id: string;
    htmlLink: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
  };

  let meetUrl: string | null = event.hangoutLink || null;
  if (!meetUrl && event.conferenceData?.entryPoints) {
    const video = event.conferenceData.entryPoints.find(e => e.entryPointType === 'video');
    if (video) meetUrl = video.uri;
  }

  console.log('[GoogleCal] Event created:', event.id, meetUrl ? `meet: ${maskToken(meetUrl)}` : 'no meet');

  return {
    eventId: event.id,
    meetUrl,
    htmlLink: event.htmlLink,
  };
}

export async function cancelEvent(
  connection: CalendarConnection,
  eventId: string,
): Promise<void> {
  const accessToken = await refreshAccessTokenIfNeeded(connection);
  const calendarId = connection.calendar_id || 'primary';

  const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const res = await googleFetch(accessToken, url, { method: 'DELETE' });

  if (!res.ok && res.status !== 410) {
    const body = await res.text();
    console.error('[GoogleCal] cancelEvent failed:', res.status, body);
    throw new Error(`cancel_event_${res.status}`);
  }

  console.log('[GoogleCal] Event cancelled:', eventId);
}

export function buildOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email: string;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[GoogleCal] Code exchange failed:', res.status, body);
    throw new Error('code_exchange_failed');
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    id_token?: string;
  };

  let email = '';
  if (data.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString());
      email = payload.email || '';
    } catch { /* no-op */ }
  }

  if (!email) {
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (infoRes.ok) {
        const info = await infoRes.json() as { email?: string };
        email = info.email || '';
      }
    } catch { /* no-op */ }
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    email,
  };
}

export async function revokeToken(refreshTokenEncrypted: string): Promise<void> {
  try {
    const token = decrypt(refreshTokenEncrypted);
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' });
    console.log('[GoogleCal] Token revoked');
  } catch (err) {
    console.warn('[GoogleCal] Revoke failed (non-critical):', err);
  }
}
