-- Orkesta Cold Calling — esquema inicial CRM

-- Tipos enumerados
CREATE TYPE prospect_status AS ENUM (
  'nuevo', 'contactado', 'interesado', 'no_interesado',
  'no_contesta', 'agendado', 'descartado'
);

CREATE TYPE call_outcome AS ENUM (
  'contestado', 'buzon', 'no_contesto', 'colgo', 'numero_invalido', 'error'
);

CREATE TYPE call_disposition AS ENUM (
  'interesado', 'agendo', 'no_interesado', 'pidio_no_llamar', 'sin_decision', 'pendiente'
);

CREATE TYPE speaker_type AS ENUM ('agente', 'prospecto');

CREATE TYPE user_role AS ENUM ('admin', 'vendedor');

-- Perfiles de usuario (ligado a Supabase Auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  rol user_role NOT NULL DEFAULT 'vendedor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prospectos
CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  telefono TEXT NOT NULL,
  empresa TEXT,
  email TEXT,
  campos_personalizados JSONB DEFAULT '{}',
  status prospect_status NOT NULL DEFAULT 'nuevo',
  owner_id UUID NOT NULL REFERENCES profiles(id),
  notas TEXT,
  do_not_call BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prospects_owner ON prospects(owner_id);
CREATE INDEX idx_prospects_status ON prospects(status);
CREATE INDEX idx_prospects_telefono ON prospects(telefono);

-- Campañas de prospección
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  objetivo TEXT NOT NULL,
  contexto_negocio TEXT NOT NULL,
  voz_configurada TEXT,
  system_prompt TEXT NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  owner_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_owner ON campaigns(owner_id);

-- Llamadas
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id),
  campaign_id UUID REFERENCES campaigns(id),
  twilio_call_sid TEXT NOT NULL UNIQUE,
  inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin TIMESTAMPTZ,
  duracion_segundos INTEGER,
  outcome call_outcome,
  disposition call_disposition,
  next_action TEXT,
  next_action_date DATE,
  sentimiento TEXT,
  grabacion_url TEXT,
  owner_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calls_prospect ON calls(prospect_id);
CREATE INDEX idx_calls_campaign ON calls(campaign_id);
CREATE INDEX idx_calls_owner ON calls(owner_id);
CREATE INDEX idx_calls_twilio_sid ON calls(twilio_call_sid);

-- Transcripts (un registro por turno)
CREATE TABLE transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  speaker speaker_type NOT NULL,
  texto TEXT NOT NULL,
  timestamp_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  timestamp_fin TIMESTAMPTZ
);

CREATE INDEX idx_transcripts_call ON transcripts(call_id);

-- Reportes de llamada generados por IA
CREATE TABLE call_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE UNIQUE,
  resumen TEXT NOT NULL,
  puntos_clave TEXT[] NOT NULL DEFAULT '{}',
  objeciones_detectadas TEXT[] NOT NULL DEFAULT '{}',
  nivel_interes INTEGER NOT NULL CHECK (nivel_interes BETWEEN 1 AND 5),
  datos_extraidos JSONB NOT NULL DEFAULT '{}',
  recomendacion_siguiente_paso TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_reports_call ON call_reports(call_id);

-- Trigger para updated_at en prospects
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_reports ENABLE ROW LEVEL SECURITY;

-- Políticas: cada usuario ve solo sus datos
CREATE POLICY profiles_own ON profiles
  FOR ALL USING (id = auth.uid());

CREATE POLICY prospects_own ON prospects
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY campaigns_own ON campaigns
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY calls_own ON calls
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY transcripts_own ON transcripts
  FOR ALL USING (
    call_id IN (SELECT id FROM calls WHERE owner_id = auth.uid())
  );

CREATE POLICY call_reports_own ON call_reports
  FOR ALL USING (
    call_id IN (SELECT id FROM calls WHERE owner_id = auth.uid())
  );

-- Políticas para service_role (el servidor backend)
CREATE POLICY profiles_service ON profiles
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY prospects_service ON prospects
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY campaigns_service ON campaigns
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY calls_service ON calls
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY transcripts_service ON transcripts
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY call_reports_service ON call_reports
  FOR ALL USING (true)
  WITH CHECK (true);
