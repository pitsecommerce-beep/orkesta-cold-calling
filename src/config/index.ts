import dotenv from 'dotenv';
dotenv.config();

const missingVars: string[] = [];

function optional(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    missingVars.push(name);
    return '';
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicBaseUrl: required('PUBLIC_BASE_URL').replace(/\/+$/, ''),

  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },

  deepgram: {
    apiKey: required('DEEPGRAM_API_KEY'),
    ttsVoice: optional('DEEPGRAM_TTS_VOICE', 'aura-2-diana-es'),
  },

  openai: {
    apiKey: required('OPENAI_API_KEY'),
    model: optional('OPENAI_MODEL', 'gpt-4.1'),
    reportModel: optional('OPENAI_REPORT_MODEL', 'gpt-4.1-mini'),
  },

  supabase: {
    url: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  endpointingMs: parseInt(optional('ENDPOINTING_MS', '500'), 10),
  enableFillerPhrases: process.env.ENABLE_FILLER_PHRASES !== 'false',
};

export function getMissingVars(): string[] {
  return [...missingVars];
}

export function isConfigured(service: 'twilio' | 'deepgram' | 'openai' | 'supabase'): boolean {
  switch (service) {
    case 'twilio':
      return !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.phoneNumber);
    case 'deepgram':
      return !!config.deepgram.apiKey;
    case 'openai':
      return !!config.openai.apiKey;
    case 'supabase':
      return !!(config.supabase.url && config.supabase.anonKey && config.supabase.serviceRoleKey);
  }
}

if (missingVars.length > 0) {
  console.warn('⚠️  ============================================');
  console.warn('⚠️  VARIABLES DE ENTORNO FALTANTES:');
  missingVars.forEach((v) => console.warn(`⚠️    - ${v}`));
  console.warn('⚠️  El servidor arrancará pero las funciones');
  console.warn('⚠️  que dependen de estos servicios NO funcionarán.');
  console.warn('⚠️  ============================================');
}
