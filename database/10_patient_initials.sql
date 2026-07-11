-- ============================================================
-- VUMI — Migration 10: iniciales del paciente
-- ============================================================

ALTER TABLE patients ADD COLUMN IF NOT EXISTS initials TEXT;
