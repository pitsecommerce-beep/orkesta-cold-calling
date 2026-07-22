import { Router, Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { supabaseAdmin } from '../services/supabase';

export const authRouter = Router();

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticación requerido' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Token inválido' });
      return;
    }

    req.userId = user.id;
    req.userEmail = user.email;
    next();
  } catch {
    res.status(401).json({ error: 'Error de autenticación' });
  }
}

authRouter.post('/signup', async (req: Request, res: Response) => {
  const { email, password, nombre } = req.body;
  if (!email || !password || !nombre) {
    res.status(400).json({ error: 'email, password y nombre son requeridos' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await supabaseAdmin.from('profiles').insert({
      id: data.user.id,
      nombre,
      email,
      rol: 'vendedor',
    });

    res.json({ message: 'Usuario creado', userId: data.user.id });
  } catch (err) {
    console.error('[Auth] Signup error:', err);
    res.status(500).json({ error: 'Error creando usuario' });
  }
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'email y password son requeridos' });
    return;
  }

  try {
    const client = createClient(config.supabase.url, config.supabase.anonKey);
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      res.status(401).json({ error: error.message });
      return;
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        nombre: profile?.nombre || '',
        rol: profile?.rol || 'vendedor',
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Error de autenticación' });
  }
});

authRouter.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.userId!)
      .single();

    if (!profile) {
      res.status(404).json({ error: 'Perfil no encontrado' });
      return;
    }

    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo perfil' });
  }
});
