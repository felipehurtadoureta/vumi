-- ============================================================
-- HOJA DE VIDA MÉDICA — Subir y procesar después
-- Permite guardar un informe sin tipo de examen todavía asignado
-- (queda "pendiente de procesar"): se sube el archivo de inmediato
-- y se analiza con IA más tarde, sin bloquear al usuario esperando
-- ni obligarlo a llenar todo a mano. tipo_examen_id = NULL es la
-- señal de "aún no procesado".
-- ============================================================

ALTER TABLE historial_informes ALTER COLUMN tipo_examen_id DROP NOT NULL;
