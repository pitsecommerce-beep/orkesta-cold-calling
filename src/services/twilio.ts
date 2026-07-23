import Twilio from 'twilio';
import { config, isConfigured } from '../config';

let _twilioClient: ReturnType<typeof Twilio> | null = null;

function getTwilioClient() {
  if (!_twilioClient) {
    if (!isConfigured('twilio')) {
      throw new Error('Twilio no está configurado. Configura TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_PHONE_NUMBER.');
    }
    _twilioClient = Twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return _twilioClient;
}

export async function initiateCall(params: {
  to: string;
  prospectId: string;
  campaignId: string;
  ownerId: string;
}): Promise<string> {
  const twimlUrl = `${config.publicBaseUrl}/api/twilio/voice?prospectId=${encodeURIComponent(params.prospectId)}&campaignId=${encodeURIComponent(params.campaignId)}&ownerId=${encodeURIComponent(params.ownerId)}`;

  const call = await getTwilioClient().calls.create({
    to: params.to,
    from: config.twilio.phoneNumber,
    url: twimlUrl,
    statusCallback: `${config.publicBaseUrl}/api/twilio/status`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST',
    record: true,
    recordingStatusCallback: `${config.publicBaseUrl}/api/twilio/recording`,
    recordingStatusCallbackMethod: 'POST',
  });

  return call.sid;
}

export async function hangupCall(callSid: string): Promise<void> {
  try {
    await getTwilioClient().calls(callSid).update({ status: 'completed' });
    console.log(`[Twilio] Hung up call ${callSid}`);
  } catch (err) {
    console.error(`[Twilio] Failed to hang up ${callSid}:`, err);
  }
}

export function generateStreamTwiml(params: {
  prospectId: string;
  campaignId: string;
  ownerId: string;
}): string {
  const baseUrl = config.publicBaseUrl || 'https://example.com';
  const streamUrl = baseUrl.replace(/^http/, 'ws') + '/media-stream';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="prospectId" value="${params.prospectId}" />
      <Parameter name="campaignId" value="${params.campaignId}" />
      <Parameter name="ownerId" value="${params.ownerId}" />
    </Stream>
  </Connect>
</Response>`;
}
