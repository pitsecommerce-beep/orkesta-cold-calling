-- Calendario y citas para el agente de voz

CREATE TABLE calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  google_email TEXT,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  horario_inicio TIME NOT NULL DEFAULT '09:00',
  horario_fin TIME NOT NULL DEFAULT '18:00',
  dias_habiles INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  duracion_default_min INT NOT NULL DEFAULT 20,
  buffer_min INT NOT NULL DEFAULT 15,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider)
);

CREATE INDEX idx_calendar_connections_owner ON calendar_connections(owner_id);

CREATE TRIGGER calendar_connections_updated_at
  BEFORE UPDATE ON calendar_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  vendedor_id UUID NOT NULL REFERENCES profiles(id),
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  google_event_id TEXT,
  meet_url TEXT,
  estado TEXT NOT NULL DEFAULT 'confirmada'
    CHECK (estado IN ('tentativa', 'confirmada', 'cancelada', 'no_asistio', 'realizada')),
  canal_confirmacion TEXT,
  confirmacion_enviada_at TIMESTAMPTZ,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_call ON appointments(call_id);
CREATE INDEX idx_appointments_prospect ON appointments(prospect_id);
CREATE INDEX idx_appointments_vendedor ON appointments(vendedor_id);
CREATE INDEX idx_appointments_inicio ON appointments(inicio);

-- RLS
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_connections_select ON calendar_connections
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY calendar_connections_insert ON calendar_connections
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY calendar_connections_update ON calendar_connections
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY calendar_connections_delete ON calendar_connections
  FOR DELETE USING (owner_id = auth.uid());

CREATE POLICY appointments_select ON appointments
  FOR SELECT USING (vendedor_id = auth.uid());

CREATE POLICY appointments_insert ON appointments
  FOR INSERT WITH CHECK (vendedor_id = auth.uid());

CREATE POLICY appointments_update ON appointments
  FOR UPDATE USING (vendedor_id = auth.uid());
