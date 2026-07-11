-- ============================================================
-- 12_case_type.sql
-- Agrega tipo de caso: atención médica (default) o medicamento.
-- Para medicamentos no se requiere liquidación Banmédica.
-- ============================================================

ALTER TABLE medical_cases
  ADD COLUMN IF NOT EXISTS case_type TEXT NOT NULL DEFAULT 'atencion_medica'
  CHECK (case_type IN ('atencion_medica', 'medicamento'));

COMMENT ON COLUMN medical_cases.case_type IS
  'Tipo de caso: atencion_medica (requiere liquidación Banmédica) o medicamento (va directo a Complementario y VUMI)';
