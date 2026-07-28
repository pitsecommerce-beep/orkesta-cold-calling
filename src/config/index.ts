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
    apiKey: optional('OPENAI_API_KEY'),
    model: optional('OPENAI_MODEL', 'gpt-4.1'),
    reportModel: optional('OPENAI_REPORT_MODEL', 'gpt-4.1-mini'),
  },

  anthropic: {
    apiKey: optional('ANTHROPIC_API_KEY'),
    model: optional('ANTHROPIC_MODEL', 'claude-sonnet-5'),
    reportModel: optional('ANTHROPIC_REPORT_MODEL', 'claude-haiku-4-5-20251001'),
  },

  supabase: {
    url: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    redirectUri: optional('GOOGLE_REDIRECT_URI'),
  },

  encryptionKey: optional('ENCRYPTION_KEY'),

  twilioWhatsappFrom: optional('TWILIO_WHATSAPP_FROM'),

  endpointingMs: parseInt(optional('ENDPOINTING_MS', '500'), 10),
  enableFillerPhrases: process.env.ENABLE_FILLER_PHRASES !== 'false',
  amdEnabled: process.env.AMD_ENABLED !== 'false',

  silenceNudgeAfterQuestionMs: parseInt(process.env.SILENCE_NUDGE_AFTER_QUESTION_MS || '6000', 10),
  silenceNudgeAfterStatementMs: parseInt(process.env.SILENCE_NUDGE_AFTER_STATEMENT_MS || '9000', 10),
  silenceGoodbyeAfterMs: parseInt(process.env.SILENCE_GOODBYE_AFTER_MS || '8000', 10),
  fillerDelayMs: parseInt(process.env.FILLER_DELAY_MS || '350', 10),
  fillerMaxPerCall: parseInt(process.env.FILLER_MAX_PER_CALL || '2', 10),
};

export function getMissingVars(): string[] {
  return [...missingVars];
}

export function isConfigured(service: 'twilio' | 'deepgram' | 'openai' | 'anthropic' | 'supabase' | 'google' | 'encryption'): boolean {
  switch (service) {
    case 'twilio':
      return !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.phoneNumber);
    case 'deepgram':
      return !!config.deepgram.apiKey;
    case 'openai':
      return !!config.openai.apiKey;
    case 'anthropic':
      return !!config.anthropic.apiKey;
    case 'supabase':
      return !!(config.supabase.url && config.supabase.anonKey && config.supabase.serviceRoleKey);
    case 'google':
      return !!(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
    case 'encryption':
      return !!config.encryptionKey;
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
