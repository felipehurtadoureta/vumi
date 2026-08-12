-- ============================================================
-- HOJA DE VIDA MÉDICA — Detección de documentos duplicados
-- Agrega una columna a historial_informes (tabla propia del módulo,
-- no se toca ninguna tabla de reembolsos) para guardar un hash SHA-256
-- del contenido del archivo, calculado en el navegador. Permite avisar
-- si el mismo documento ya fue subido antes para ese paciente.
-- ============================================================

ALTER TABLE historial_informes ADD COLUMN file_hash TEXT;

CREATE INDEX idx_historial_informes_hash ON historial_informes(patient_id, file_hash);
