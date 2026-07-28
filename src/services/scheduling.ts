import type { CalendarConnection, Slot } from '../models/types';
import type { FreeBusyBlock } from './google-calendar';

const DIAS_SEMANA: Record<number, string> = {
  0: 'domingo',
  1: 'lunes',
  2: 'martes',
  3: 'miercoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sabado',
};

const DIAS_SEMANA_HABLADO: Record<number, string> = {
  0: 'domingo',
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábado',
};

const NUMEROS_HABLADOS: Record<number, string> = {
  1: 'una', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco',
  6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez',
  11: 'once', 12: 'doce',
};

function formatHoraHablada(hour24: number, minute: number): string {
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  const periodo = hour24 < 12 ? 'de la mañana' : hour24 < 18 ? 'de la tarde' : 'de la noche';
  const horaTexto = NUMEROS_HABLADOS[hour12] || String(hour12);
  if (minute === 0) {
    return `a las ${horaTexto} ${periodo}`;
  }
  return `a las ${horaTexto} y ${minute === 30 ? 'media' : String(minute)} ${periodo}`;
}

function toIanaDate(date: Date, tz: string): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    weekday: weekdayMap[get('weekday')] ?? 0,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

function buildDateInTz(tz: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  const naive = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  let lo = new Date(naive + 'Z').getTime() - 14 * 3600_000;
  let hi = lo + 28 * 3600_000;

  for (let i = 0; i < 20; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const d = new Date(mid);
    const p = toIanaDate(d, tz);
    const cmp = (p.year - year) * 10000 + (p.month - month) * 100 + (p.day - day);
    if (cmp === 0) {
      const timeCmp = (p.hour - hour) * 60 + (p.minute - minute);
      if (timeCmp === 0) return d;
      if (timeCmp > 0) hi = mid; else lo = mid;
    } else if (cmp > 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return new Date(Math.floor((lo + hi) / 2));
}

function isToday(now: Date, targetDate: Date, tz: string): boolean {
  const a = toIanaDate(now, tz);
  const b = toIanaDate(targetDate, tz);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function isTomorrow(now: Date, targetDate: Date, tz: string): boolean {
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  return isToday(tomorrow, targetDate, tz);
}

function buildEtiqueta(slotStart: Date, tz: string, now: Date): string {
  const p = toIanaDate(slotStart, tz);

  let diaTexto: string;
  if (isToday(now, slotStart, tz)) {
    diaTexto = 'hoy';
  } else if (isTomorrow(now, slotStart, tz)) {
    diaTexto = 'mañana ' + DIAS_SEMANA_HABLADO[p.weekday];
  } else {
    diaTexto = 'el ' + DIAS_SEMANA_HABLADO[p.weekday] + ' ' + String(p.day);
  }

  const horaTexto = formatHoraHablada(p.hour, p.minute);
  return `${diaTexto} ${horaTexto}`;
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hour: h, minute: m || 0 };
}

function isoWeekday(jsWeekday: number): number {
  return jsWeekday === 0 ? 7 : jsWeekday;
}

export function computeAvailableSlots(
  conn: CalendarConnection,
  freeBusy: FreeBusyBlock[],
  desde: Date,
  dias: number,
): Slot[] {
  const tz = conn.timezone;
  const durationMin = conn.duracion_default_min;
  const bufferMin = conn.buffer_min;
  const diasHabiles = new Set(conn.dias_habiles);
  const { hour: hIni, minute: mIni } = parseTime(conn.horario_inicio);
  const { hour: hFin, minute: mFin } = parseTime(conn.horario_fin);

  const twoHoursFromNow = new Date(desde.getTime() + 2 * 3600_000);

  const busyIntervals = freeBusy.map(b => ({
    start: new Date(b.start).getTime() - bufferMin * 60_000,
    end: new Date(b.end).getTime() + bufferMin * 60_000,
  }));

  const slots: Slot[] = [];
  const now = desde;
  const nowParts = toIanaDate(now, tz);

  for (let d = 0; d < dias + 10 && slots.length < 6; d++) {
    const dayDate = new Date(now.getTime() + d * 24 * 3600_000);
    const dayParts = toIanaDate(dayDate, tz);
    const isoWd = isoWeekday(dayParts.weekday);

    if (!diasHabiles.has(isoWd)) continue;

    const dayStart = buildDateInTz(tz, dayParts.year, dayParts.month, dayParts.day, hIni, mIni);
    const dayEnd = buildDateInTz(tz, dayParts.year, dayParts.month, dayParts.day, hFin, mFin);

    let cursor = dayStart.getTime();
    const alignTo30 = (ts: number) => {
      const d = new Date(ts);
      const p = toIanaDate(d, tz);
      const m = p.minute;
      if (m === 0 || m === 30) return ts;
      const next = m < 30 ? 30 : 60;
      return ts + (next - m) * 60_000;
    };
    cursor = alignTo30(cursor);

    while (cursor + durationMin * 60_000 <= dayEnd.getTime() && slots.length < 6) {
      const slotEnd = cursor + durationMin * 60_000;

      if (new Date(cursor) < twoHoursFromNow) {
        cursor += 30 * 60_000;
        continue;
      }

      const conflicted = busyIntervals.some(b => cursor < b.end && slotEnd > b.start);
      if (conflicted) {
        cursor += 30 * 60_000;
        continue;
      }

      const slotDate = new Date(cursor);
      slots.push({
        id: `slot-${cursor}`,
        inicioIso: slotDate.toISOString(),
        finIso: new Date(slotEnd).toISOString(),
        etiquetaHablada: buildEtiqueta(slotDate, tz, now),
        vendedorId: conn.owner_id,
      });

      cursor += 30 * 60_000;
    }
  }

  return prioritizeSlots(slots, tz);
}

function prioritizeSlots(slots: Slot[], tz: string): Slot[] {
  return slots.sort((a, b) => {
    const pa = toIanaDate(new Date(a.inicioIso), tz);
    const pb = toIanaDate(new Date(b.inicioIso), tz);

    const dayDiff = new Date(a.inicioIso).getTime() - new Date(b.inicioIso).getTime();
    const dayOnly = Math.floor(dayDiff / (24 * 3600_000));
    if (dayOnly !== 0) return dayOnly;

    const aScore = (pa.hour >= 10 && pa.hour < 12) ? 0 : 1;
    const bScore = (pb.hour >= 10 && pb.hour < 12) ? 0 : 1;
    if (aScore !== bScore) return aScore - bScore;

    return new Date(a.inicioIso).getTime() - new Date(b.inicioIso).getTime();
  }).slice(0, 6);
}

export function filterSlotsByPreference(slots: Slot[], preferencia: string): Slot[] {
  const pref = preferencia.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const dayKeywords: Record<string, string[]> = {
    lunes: ['lunes'],
    martes: ['martes'],
    miercoles: ['miercoles'],
    jueves: ['jueves'],
    viernes: ['viernes'],
    manana: ['manana'],
  };

  const timeKeywords: Record<string, (h: number) => boolean> = {
    'en la manana': h => h < 12,
    'por la manana': h => h < 12,
    'temprano': h => h < 12,
    'en la tarde': h => h >= 12 && h < 18,
    'por la tarde': h => h >= 12 && h < 18,
    'despues de comer': h => h >= 14,
  };

  let filtered = [...slots];

  for (const [keyword, dayNames] of Object.entries(dayKeywords)) {
    if (pref.includes(keyword)) {
      const dayFiltered = filtered.filter(s => {
        const label = s.etiquetaHablada.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        return dayNames.some(d => label.includes(d));
      });
      if (dayFiltered.length > 0) filtered = dayFiltered;
      break;
    }
  }

  for (const [keyword, check] of Object.entries(timeKeywords)) {
    if (pref.includes(keyword)) {
      const tz = 'America/Mexico_City';
      const timeFiltered = filtered.filter(s => {
        const p = toIanaDate(new Date(s.inicioIso), tz);
        return check(p.hour);
      });
      if (timeFiltered.length > 0) filtered = timeFiltered;
      break;
    }
  }

  if (pref.includes('manana') && !pref.includes('en la manana') && !pref.includes('por la manana')) {
    const tomorrowFiltered = filtered.filter(s =>
      s.etiquetaHablada.startsWith('mañana'),
    );
    if (tomorrowFiltered.length > 0) filtered = tomorrowFiltered;
  }

  return filtered.slice(0, 3);
}

export async function selectVendedor(
  ownerId: string,
  campaignVendedorId: string | undefined,
): Promise<CalendarConnection | null> {
  const { getSupabaseAdmin } = await import('./supabase');
  const admin = getSupabaseAdmin();

  if (campaignVendedorId) {
    const { data } = await admin
      .from('calendar_connections')
      .select('*')
      .eq('owner_id', campaignVendedorId)
      .eq('activo', true)
      .single();
    return data || null;
  }

  const { data: connections } = await admin
    .from('calendar_connections')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('activo', true)
    .limit(1);

  if (!connections || connections.length === 0) return null;
  return connections[0];
}
