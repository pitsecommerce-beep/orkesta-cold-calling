import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from './auth';
import { supabaseAdmin } from '../services/supabase';

export const prospectsRouter = Router();
prospectsRouter.use(authMiddleware);

prospectsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('prospects')
      .select('*')
      .eq('owner_id', req.userId!)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

prospectsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('prospects')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.userId!)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Prospecto no encontrado' });
      return;
    }
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

prospectsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const { nombre, telefono, empresa, email, notas, campos_personalizados } = req.body;

  if (!nombre || !telefono) {
    res.status(400).json({ error: 'nombre y telefono son requeridos' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('prospects')
      .insert({
        nombre,
        telefono,
        empresa: empresa || null,
        email: email || null,
        notas: notas || null,
        campos_personalizados: campos_personalizados || {},
        owner_id: req.userId!,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

prospectsRouter.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { nombre, telefono, empresa, email, notas, status, do_not_call, campos_personalizados } = req.body;

  try {
    const updates: Record<string, unknown> = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (telefono !== undefined) updates.telefono = telefono;
    if (empresa !== undefined) updates.empresa = empresa;
    if (email !== undefined) updates.email = email;
    if (notas !== undefined) updates.notas = notas;
    if (status !== undefined) updates.status = status;
    if (do_not_call !== undefined) updates.do_not_call = do_not_call;
    if (campos_personalizados !== undefined) updates.campos_personalizados = campos_personalizados;

    const { data, error } = await supabaseAdmin
      .from('prospects')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.userId!)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Prospecto no encontrado' });
      return;
    }
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

prospectsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('prospects')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.userId!);

    if (error) throw error;
    res.json({ message: 'Prospecto eliminado' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
