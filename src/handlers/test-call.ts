import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { CallSession } from './call-session';
import { supabaseAdmin } from '../services/supabase';

export async function handleTestCall(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const campaignId = url.searchParams.get('campaignId') || '';
  const prospectName = url.searchParams.get('prospectName') || 'Prospecto de prueba';

  if (!token) {
    ws.close(4001, 'Token requerido');
    return;
  }

  let userId: string;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      ws.close(4001, 'Token inválido');
      return;
    }
    userId = user.id;
  } catch {
    ws.close(4001, 'Error de autenticación');
    return;
  }

  const streamSid = `test_${Date.now()}`;
  const callSid = `test_call_${Date.now()}`;

  console.log(`[TestCall] Starting test call for user ${userId}`);

  const session = new CallSession(ws, {
    prospectId: '',
    campaignId,
    ownerId: userId,
  });

  session.setTestMode(prospectName, (speaker, text) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'transcript', speaker, text }));
    }
  });

  await session.initialize(streamSid, callSid);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.event) {
        case 'media':
          session.handleMedia(msg.media.payload);
          break;
        case 'mark':
          session.handleMark(msg.mark.name);
          break;
        case 'stop':
          session.cleanup();
          break;
      }
    } catch (err) {
      console.error('[TestCall] Message error:', err);
    }
  });

  ws.on('close', () => {
    console.log('[TestCall] WebSocket closed');
    session.cleanup();
  });

  ws.on('error', (err) => {
    console.error('[TestCall] WebSocket error:', err);
  });
}
