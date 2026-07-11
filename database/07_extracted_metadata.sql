-- ============================================================
-- VUMI — Migration 07: extracted_metadata en documents
-- Guarda RUTs y otros datos estructurados del OCR
-- ============================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extracted_metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN documents.extracted_metadata IS
  'Datos adicionales extraídos por OCR: provider_rut, doctor_name, doctor_rut, recipient_rut';
