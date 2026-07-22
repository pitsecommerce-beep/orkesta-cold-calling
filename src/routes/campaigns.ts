import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from './auth';
import { supabaseAdmin } from '../services/supabase';

export const campaignsRouter = Router();
campaignsRouter.use(authMiddleware);

campaignsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('owner_id', req.userId!)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo campañas' });
  }
});

campaignsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.userId!)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Campaña no encontrada' });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo campaña' });
  }
});

campaignsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const { nombre, objetivo, contexto_negocio, system_prompt, voz_configurada } = req.body;

  if (!nombre || !objetivo || !contexto_negocio || !system_prompt) {
    res.status(400).json({ error: 'nombre, objetivo, contexto_negocio y system_prompt son requeridos' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .insert({
        nombre,
        objetivo,
        contexto_negocio,
        system_prompt,
        voz_configurada: voz_configurada || null,
        owner_id: req.userId!,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error creando campaña' });
  }
});

campaignsRouter.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { nombre, objetivo, contexto_negocio, system_prompt, voz_configurada, activa } = req.body;

  try {
    const updates: Record<string, unknown> = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (objetivo !== undefined) updates.objetivo = objetivo;
    if (contexto_negocio !== undefined) updates.contexto_negocio = contexto_negocio;
    if (system_prompt !== undefined) updates.system_prompt = system_prompt;
    if (voz_configurada !== undefined) updates.voz_configurada = voz_configurada;
    if (activa !== undefined) updates.activa = activa;

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.userId!)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Campaña no encontrada' });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando campaña' });
  }
});
