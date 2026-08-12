-- ============================================================
-- HOJA DE VIDA MÉDICA — Perfil básico del paciente
-- Tabla nueva y separada, 1:1 con `patients` (no se modifica esa tabla).
-- Guarda datos estables (fecha de nacimiento, condiciones crónicas,
-- alergias, medicamentos habituales, estatura/peso de referencia) para
-- dar contexto correcto al análisis de IA — en particular, para calcular
-- la edad real del paciente en la fecha de cada examen, en vez de
-- confiar en la edad que a veces aparece impresa en un informe antiguo.
-- ============================================================

CREATE TABLE historial_perfil_paciente (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id             UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,

  fecha_nacimiento       DATE,
  sexo_biologico         TEXT CHECK (sexo_biologico IN ('femenino', 'masculino', 'otro')),
  condiciones_cronicas   TEXT,
  alergias               TEXT,
  medicamentos_habituales TEXT,
  estatura_cm            NUMERIC,
  peso_kg                NUMERIC,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_historial_perfil_patient ON historial_perfil_paciente(patient_id);

ALTER TABLE historial_perfil_paciente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historial_perfil_paciente: usuario accede a los suyos"
  ON historial_perfil_paciente FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
