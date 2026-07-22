import WebSocket from 'ws';
import { CallSession } from './call-session';

const activeSessions = new Map<string, CallSession>();

export function handleMediaStream(ws: WebSocket) {
  let session: CallSession | null = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.event) {
        case 'connected':
          console.log('[MediaStream] Connected');
          break;

        case 'start': {
          const { streamSid, callSid, customParameters } = msg.start;
          const params = {
            prospectId: customParameters?.prospectId || '',
            campaignId: customParameters?.campaignId || '',
            ownerId: customParameters?.ownerId || '',
          };

          console.log(`[MediaStream] Start — stream: ${streamSid}, call: ${callSid}`);

          session = new CallSession(ws, params);
          await session.initialize(streamSid, callSid);
          activeSessions.set(streamSid, session);
          break;
        }

        case 'media':
          session?.handleMedia(msg.media.payload);
          break;

        case 'mark':
          session?.handleMark(msg.mark.name);
          break;

        case 'stop': {
          const streamSid = msg.stop?.streamSid || msg.streamSid;
          console.log(`[MediaStream] Stop — stream: ${streamSid}`);
          await session?.cleanup();
          if (streamSid) activeSessions.delete(streamSid);
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
  });

  ws.on('error', (err) => {
    console.error('[MediaStream] WebSocket error:', err);
  });
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
