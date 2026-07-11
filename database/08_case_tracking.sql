-- ============================================================
-- VUMI — Migration 08: tracking de reembolsos y datos médicos
-- ============================================================

ALTER TABLE medical_cases
  ADD COLUMN IF NOT EXISTS event_description  TEXT,
  ADD COLUMN IF NOT EXISTS rut_centro_medico  TEXT,
  ADD COLUMN IF NOT EXISTS rut_medico         TEXT,
  ADD COLUMN IF NOT EXISTS nombre_medico      TEXT,
  ADD COLUMN IF NOT EXISTS banmedica_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metlife_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vumi_sent_at       TIMESTAMPTZ;
