-- ============================================================
-- VUMI — Migration 09: Fix RLS en case_status_history
-- El trigger de medical_cases inserta en esta tabla pero
-- no había política de INSERT para usuarios autenticados.
-- ============================================================

-- Política para que usuarios autenticados puedan leer su propio historial
CREATE POLICY IF NOT EXISTS "Users can read own case status history"
ON case_status_history
FOR SELECT
TO authenticated
USING (
  case_id IN (
    SELECT id FROM medical_cases WHERE user_id = auth.uid()
  )
);

-- Política para que el trigger pueda insertar historial de sus propios casos
CREATE POLICY IF NOT EXISTS "Users can insert own case status history"
ON case_status_history
FOR INSERT
TO authenticated
WITH CHECK (
  case_id IN (
    SELECT id FROM medical_cases WHERE user_id = auth.uid()
  )
);
