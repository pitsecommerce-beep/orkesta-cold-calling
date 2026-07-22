import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { config } from './config';
import { authRouter } from './routes/auth';
import { prospectsRouter } from './routes/prospects';
import { campaignsRouter } from './routes/campaigns';
import { callsRouter } from './routes/calls';
import { twilioRouter } from './routes/twilio-webhooks';
import { handleMediaStream } from './handlers/media-stream';
import { warmFillerCache } from './services/deepgram-tts';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'panel', 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/prospects', prospectsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/calls', callsRouter);
app.use('/api/twilio', twilioRouter);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'panel', 'public', 'index.html'));
});

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleMediaStream(ws);
    });
  } else {
    socket.destroy();
  }
});

async function start() {
  console.log('===========================================');
  console.log('  Orkesta Cold Calling — AI Voice Agent');
  console.log('  AI Solutions Orchestrated');
  console.log('===========================================');

  try {
    await warmFillerCache();
  } catch (err) {
    console.warn('[Server] Filler cache warmup failed (will work without fillers):', err);
  }

  server.listen(config.port, () => {
    console.log(`[Server] Running on port ${config.port}`);
    console.log(`[Server] Public URL: ${config.publicBaseUrl}`);
    console.log(`[Server] Media Stream: ${config.publicBaseUrl.replace(/^http/, 'ws')}/media-stream`);
  });
}

start().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
