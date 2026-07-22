import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicBaseUrl: required('PUBLIC_BASE_URL'),

  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },

  deepgram: {
    apiKey: required('DEEPGRAM_API_KEY'),
    ttsVoice: process.env.DEEPGRAM_TTS_VOICE || 'aura-2-thalia-es',
  },

  openai: {
    apiKey: required('OPENAI_API_KEY'),
    model: process.env.OPENAI_MODEL || 'gpt-4.1',
    reportModel: process.env.OPENAI_REPORT_MODEL || 'gpt-4.1-mini',
  },

  supabase: {
    url: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  endpointingMs: parseInt(process.env.ENDPOINTING_MS || '500', 10),
  enableFillerPhrases: process.env.ENABLE_FILLER_PHRASES !== 'false',
};
