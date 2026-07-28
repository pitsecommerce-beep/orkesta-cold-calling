import { Router, Request, Response } from 'express';
import * as twilioService from '../services/twilio';
import { supabaseAdmin } from '../services/supabase';
import { getSessionByCallSid } from '../handlers/media-stream';

export const twilioRouter = Router();

twilioRouter.post('/voice', (req: Request, res: Response) => {
  const { prospectId, campaignId, ownerId } = req.query as Record<string, string>;
  console.log(`[Twilio] Voice webhook — prospect: ${prospectId}, campaign: ${campaignId}`);

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

twilioRouter.post('/amd', async (req: Request, res: Response) => {
  const { CallSid, AnsweredBy } = req.body;

  console.log(`[Twilio] AMD verdict — SID: ${CallSid}, answeredBy: ${AnsweredBy}`);

  try {
    await supabaseAdmin
      .from('calls')
      .update({ amd_result: AnsweredBy })
      .eq('twilio_call_sid', CallSid);

    const isHuman = AnsweredBy === 'human';
    const isMachine = AnsweredBy === 'machine_start';
    const isFax = AnsweredBy === 'fax';

    if (isMachine) {
      await supabaseAdmin
        .from('calls')
        .update({ outcome: 'buzon', disposition: 'sin_decision' })
        .eq('twilio_call_sid', CallSid);
    } else if (isFax) {
      await supabaseAdmin
        .from('calls')
        .update({ outcome: 'error' })
        .eq('twilio_call_sid', CallSid);
    }

    const session = getSessionByCallSid(CallSid);
    if (session) {
      session.onAmdVerdict(AnsweredBy);
      if (!isHuman && AnsweredBy !== 'unknown') {
        await twilioService.hangupCall(CallSid);
      }
    } else {
      console.warn(`[Twilio] AMD — no active session for ${CallSid}`);
      if (!isHuman && AnsweredBy !== 'unknown') {
        await twilioService.hangupCall(CallSid);
      }
    }
  } catch (err) {
    console.error('[Twilio] AMD callback error:', err);
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
