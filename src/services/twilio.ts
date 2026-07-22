import Twilio from 'twilio';
import { config } from '../config';

const twilioClient = Twilio(config.twilio.accountSid, config.twilio.authToken);

export async function initiateCall(params: {
  to: string;
  prospectId: string;
  campaignId: string;
  ownerId: string;
}): Promise<string> {
  const twimlUrl = `${config.publicBaseUrl}/api/twilio/voice?prospectId=${encodeURIComponent(params.prospectId)}&campaignId=${encodeURIComponent(params.campaignId)}&ownerId=${encodeURIComponent(params.ownerId)}`;

  const call = await twilioClient.calls.create({
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

export function generateStreamTwiml(params: {
  prospectId: string;
  campaignId: string;
  ownerId: string;
}): string {
  const streamUrl = config.publicBaseUrl.replace(/^http/, 'ws') + '/media-stream';

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
