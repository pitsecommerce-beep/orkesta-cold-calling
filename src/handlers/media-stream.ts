import WebSocket from 'ws';
import { CallSession } from './call-session';

const activeSessions = new Map<string, CallSession>();
const sessionsByCallSid = new Map<string, CallSession>();

export function getSessionByCallSid(callSid: string): CallSession | undefined {
  return sessionsByCallSid.get(callSid);
}

export function handleMediaStream(ws: WebSocket) {
  let session: CallSession | null = null;
  let streamSid: string | null = null;
  let callSid: string | null = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.event) {
        case 'connected':
          console.log('[MediaStream] Connected');
          break;

        case 'start': {
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;
          const { customParameters } = msg.start;
          const params = {
            prospectId: customParameters?.prospectId || '',
            campaignId: customParameters?.campaignId || '',
            ownerId: customParameters?.ownerId || '',
          };

          console.log(`[MediaStream] Start — stream: ${streamSid}, call: ${callSid}`);

          session = new CallSession(ws, params);
          activeSessions.set(streamSid!, session);
          sessionsByCallSid.set(callSid!, session);
          await session.initialize(streamSid!, callSid!);
          break;
        }

        case 'media':
          session?.handleMedia(msg.media.payload);
          break;

        case 'mark':
          session?.handleMark(msg.mark.name);
          break;

        case 'stop': {
          const sid = msg.stop?.streamSid || msg.streamSid;
          console.log(`[MediaStream] Stop — stream: ${sid}`);
          await session?.cleanup();
          if (sid) activeSessions.delete(sid);
          if (callSid) sessionsByCallSid.delete(callSid);
          break;
        }
      }
    } catch (err) {
      console.error('[MediaStream] Message error:', err);
    }
  });

  ws.on('close', async () => {
    console.log('[MediaStream] WebSocket closed');
    if (session) {
      await session.cleanup();
    }
    if (streamSid) activeSessions.delete(streamSid);
    if (callSid) sessionsByCallSid.delete(callSid);
  });

  ws.on('error', (err) => {
    console.error('[MediaStream] WebSocket error:', err);
  });
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
