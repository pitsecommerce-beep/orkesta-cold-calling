import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from './auth';
import { supabaseAdmin, getCallWithDetails } from '../services/supabase';
import * as twilioService from '../services/twilio';

export const callsRouter = Router();
callsRouter.use(authMiddleware);

callsRouter.post('/initiate', async (req: AuthenticatedRequest, res: Response) => {
  const { prospectId, campaignId } = req.body;

  if (!prospectId) {
    res.status(400).json({ error: 'prospectId es requerido' });
    return;
  }

  try {
    const { data: prospect, error } = await supabaseAdmin
      .from('prospects')
      .select('*')
      .eq('id', prospectId)
      .eq('owner_id', req.userId!)
      .single();

    if (error || !prospect) {
      res.status(404).json({ error: 'Prospecto no encontrado' });
      return;
    }

    if (prospect.do_not_call) {
      res.status(400).json({ error: 'Este prospecto tiene marcado "no llamar"' });
      return;
    }

    const callSid = await twilioService.initiateCall({
      to: prospect.telefono,
      prospectId,
      campaignId: campaignId || '',
      ownerId: req.userId!,
    });

    res.json({ message: 'Llamada iniciada', callSid });
  } catch (err) {
    console.error('[Calls] Initiate error:', err);
    res.status(500).json({ error: 'Error iniciando llamada' });
  }
});

callsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('calls')
      .select('*, prospects(nombre, telefono, empresa)')
      .eq('owner_id', req.userId!)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo llamadas' });
  }
});

callsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: call, error } = await supabaseAdmin
      .from('calls')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.userId!)
      .single();

    if (error || !call) {
      res.status(404).json({ error: 'Llamada no encontrada' });
      return;
    }

    const details = await getCallWithDetails(req.params.id as string);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo llamada' });
  }
});

callsRouter.get('/prospect/:prospectId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('calls')
      .select('*')
      .eq('prospect_id', req.params.prospectId)
      .eq('owner_id', req.userId!)
      .order('inicio', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo llamadas del prospecto' });
  }
});
