import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from './auth';
import { supabaseAdmin } from '../services/supabase';
import * as XLSX from 'xlsx';

export const prospectsRouter = Router();
prospectsRouter.use(authMiddleware);

prospectsRouter.get('/template', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const wb = XLSX.utils.book_new();
    const data = [
      ['nombre', 'telefono', 'empresa', 'notas'],
      ['Juan Pérez', '+5215512345678', 'Empresa ABC', 'Interesado en servicios de IA'],
      ['María López', '+5215587654321', 'Tech Solutions', 'Contactar por la mañana'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 25 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Prospectos');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_prospectos.xlsx');
    res.send(buf);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

prospectsRouter.post('/bulk', async (req: AuthenticatedRequest, res: Response) => {
  const { fileBase64 } = req.body;

  if (!fileBase64) {
    res.status(400).json({ error: 'fileBase64 es requerido' });
    return;
  }

  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(ws);

    if (rows.length === 0) {
      res.status(400).json({ error: 'El archivo no contiene datos' });
      return;
    }

    const prospects = rows.map((row) => ({
      nombre: row['nombre'] || row['Nombre'] || '',
      telefono: row['telefono'] || row['Telefono'] || row['teléfono'] || row['Teléfono'] || '',
      empresa: row['empresa'] || row['Empresa'] || null,
      notas: row['notas'] || row['Notas'] || null,
      owner_id: req.userId!,
    }));

    const invalid = prospects.filter((p) => !p.nombre || !p.telefono);
    if (invalid.length > 0) {
      res.status(400).json({
        error: `${invalid.length} fila(s) sin nombre o teléfono`,
        details: invalid.map((_, i) => `Fila ${i + 2}`),
      });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('prospects')
      .insert(prospects)
      .select();

    if (error) throw error;
    res.status(201).json({ created: data?.length || 0, prospects: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

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
