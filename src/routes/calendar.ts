import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from './auth';
import * as gcal from '../services/google-calendar';
import * as db from '../services/supabase';
import { encrypt } from '../services/encryption';
import { isConfigured } from '../config';

export const calendarRouter = Router();

calendarRouter.get('/auth', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  if (!isConfigured('google') || !isConfigured('encryption')) {
    res.status(501).json({ error: 'Google Calendar no está configurado en el servidor' });
    return;
  }

  const state = _req.userId!;
  const url = gcal.buildOAuthUrl(state);
  res.json({ url });
});

calendarRouter.get('/callback', async (req: AuthenticatedRequest, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[Calendar] OAuth error:', error);
    res.redirect('/?calendar=error');
    return;
  }

  if (!code || !state) {
    res.redirect('/?calendar=error');
    return;
  }

  try {
    const userId = state as string;
    const tokens = await gcal.exchangeCode(code as string);
    const encryptedRefresh = encrypt(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

    await db.upsertCalendarConnection({
      ownerId: userId,
      provider: 'google',
      googleEmail: tokens.email,
      refreshToken: encryptedRefresh,
      accessToken: tokens.accessToken,
      tokenExpiresAt: expiresAt,
    });

    console.log(`[Calendar] Connected for user ${userId} — email: ${tokens.email}`);
    res.redirect('/?calendar=connected');
  } catch (err) {
    console.error('[Calendar] Callback error:', err);
    res.redirect('/?calendar=error');
  }
});

calendarRouter.get('/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conn = await db.getCalendarConnectionForUser(req.userId!);
    if (!conn) {
      res.json({ connected: false });
      return;
    }
    res.json({
      connected: true,
      activo: conn.activo,
      google_email: conn.google_email,
      timezone: conn.timezone,
      horario_inicio: conn.horario_inicio,
      horario_fin: conn.horario_fin,
      dias_habiles: conn.dias_habiles,
      duracion_default_min: conn.duracion_default_min,
      buffer_min: conn.buffer_min,
      id: conn.id,
    });
  } catch (err) {
    console.error('[Calendar] Status error:', err);
    res.status(500).json({ error: 'Error obteniendo estado del calendario' });
  }
});

calendarRouter.put('/settings', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conn = await db.getCalendarConnectionForUser(req.userId!);
    if (!conn) {
      res.status(404).json({ error: 'No hay calendario conectado' });
      return;
    }

    const { timezone, horario_inicio, horario_fin, dias_habiles, duracion_default_min, buffer_min } = req.body;

    const updates: Record<string, unknown> = {};
    if (timezone) updates.timezone = timezone;
    if (horario_inicio) updates.horario_inicio = horario_inicio;
    if (horario_fin) updates.horario_fin = horario_fin;
    if (dias_habiles) updates.dias_habiles = dias_habiles;
    if (duracion_default_min) updates.duracion_default_min = duracion_default_min;
    if (buffer_min !== undefined) updates.buffer_min = buffer_min;

    await db.updateCalendarSettings(conn.id, updates);
    res.json({ message: 'Configuración actualizada' });
  } catch (err) {
    console.error('[Calendar] Settings error:', err);
    res.status(500).json({ error: 'Error actualizando configuración' });
  }
});

calendarRouter.delete('/connection', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conn = await db.getCalendarConnectionForUser(req.userId!);
    if (!conn) {
      res.status(404).json({ error: 'No hay calendario conectado' });
      return;
    }

    await gcal.revokeToken(conn.refresh_token);
    await db.deleteCalendarConnection(conn.id);

    console.log(`[Calendar] Disconnected for user ${req.userId}`);
    res.json({ message: 'Calendario desconectado' });
  } catch (err) {
    console.error('[Calendar] Disconnect error:', err);
    res.status(500).json({ error: 'Error desconectando calendario' });
  }
});

calendarRouter.get('/appointments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const appointments = await db.getAppointmentsByOwner(req.userId!);
    res.json(appointments);
  } catch (err) {
    console.error('[Calendar] Appointments error:', err);
    res.status(500).json({ error: 'Error obteniendo citas' });
  }
});
