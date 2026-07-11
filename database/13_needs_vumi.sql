-- ============================================================
-- 13_needs_vumi.sql
-- Permite marcar casos que NO requieren reembolso VUMI.
-- Default true (la mayoría de casos sí van a VUMI).
-- ============================================================

ALTER TABLE medical_cases
  ADD COLUMN IF NOT EXISTS needs_vumi BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN medical_cases.needs_vumi IS
  'false = el caso solo va a Complementario (MetLife), no requiere reembolso VUMI';
