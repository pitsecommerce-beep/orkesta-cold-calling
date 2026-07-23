import { Router, Request, Response } from 'express';
import * as twilioService from '../services/twilio';
import { supabaseAdmin } from '../services/supabase';

export const twilioRouter = Router();

twilioRouter.post('/voice', (req: Request, res: Response) => {
  const { prospectId, campaignId, ownerId } = req.query as Record<string, string>;
  const answeredBy = req.body?.AnsweredBy || 'unknown';

  console.log(`[Twilio] Voice webhook — prospect: ${prospectId}, campaign: ${campaignId}, answeredBy: ${answeredBy}`);

  if (answeredBy.startsWith('machine') || answeredBy === 'fax') {
    console.log(`[Twilio] Voicemail/machine detected (${answeredBy}) — hanging up`);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    return;
  }

  const twiml = twilioService.generateStreamTwiml({
    prospectId: prospectId || '',
    campaignId: campaignId || '',
    ownerId: ownerId || '',
  });

  res.type('text/xml');
  res.send(twiml);
});

twilioRouter.post('/status', async (req: Request, res: Response) => {
  const { CallSid, CallStatus, CallDuration } = req.body;

  console.log(`[Twilio] Status callback — SID: ${CallSid}, status: ${CallStatus}`);

  if (CallStatus === 'completed' || CallStatus === 'no-answer' || CallStatus === 'busy' || CallStatus === 'failed') {
    try {
      const outcomeMap: Record<string, string> = {
        completed: 'contestado',
        'no-answer': 'no_contesto',
        busy: 'no_contesto',
        failed: 'error',
      };

      await supabaseAdmin
        .from('calls')
        .update({
          outcome: outcomeMap[CallStatus] || 'error',
          duracion_segundos: CallDuration ? parseInt(CallDuration, 10) : null,
          fin: new Date().toISOString(),
        })
        .eq('twilio_call_sid', CallSid);
    } catch (err) {
      console.error('[Twilio] Status update error:', err);
    }
  }

  res.sendStatus(200);
});

twilioRouter.post('/recording', async (req: Request, res: Response) => {
  const { CallSid, RecordingUrl, RecordingStatus } = req.body;

  if (RecordingStatus === 'completed' && RecordingUrl) {
    console.log(`[Twilio] Recording ready — SID: ${CallSid}`);
    try {
      await supabaseAdmin
        .from('calls')
        .update({ grabacion_url: RecordingUrl })
        .eq('twilio_call_sid', CallSid);
    } catch (err) {
      console.error('[Twilio] Recording URL save error:', err);
    }
  }

  res.sendStatus(200);
});
