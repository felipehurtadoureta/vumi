-- ============================================================
-- VUMI — Migration 23: números de referencia Banmédica / Complementario
-- ============================================================
-- Campos manuales (no extraídos por OCR) para registrar el número de
-- caso/folio asignado por Banmédica y por el seguro complementario.

ALTER TABLE medical_cases
  ADD COLUMN IF NOT EXISTS numero_banmedica      TEXT,
  ADD COLUMN IF NOT EXISTS numero_complementario TEXT;
