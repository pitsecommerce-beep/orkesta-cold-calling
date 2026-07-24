-- Agrega campo de tono del agente y columnas que faltaban en el esquema original
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS llm_model TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS nombre_agente TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tono_agente TEXT;
