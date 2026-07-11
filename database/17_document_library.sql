-- ============================================================
-- VUMI — Migration 17: Repositorio común de documentos
-- Permite que un mismo documento se vincule a múltiples casos.
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- 1. Eliminar la restricción UNIQUE(document_id) que impedía
--    que un documento apareciera en más de un caso.
ALTER TABLE case_documents
  DROP CONSTRAINT IF EXISTS case_documents_document_id_key;

-- 2. Agregar índice único parcial: dentro de un mismo caso, los
--    roles principales (boleta, orden_medica, etc.) no se repiten,
--    pero 'otro' sí puede tener múltiples entradas.
CREATE UNIQUE INDEX IF NOT EXISTS case_documents_case_role_unique
  ON case_documents(case_id, role)
  WHERE role != 'otro';
