-- ============================================================
-- VUMI — Migration 18: Hoja de Vida Médica (Fase 1)
-- Repositorio de informes médicos por paciente.
-- No toca ninguna tabla existente del sistema de reembolsos.
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- ============================================================
-- TABLA: historial_tipos_examen
-- Lista cerrada pero extensible de tipos de examen.
-- El usuario puede agregar nuevos tipos desde la UI si el que
-- necesita no está en la lista (sin requerir otra migración).
-- ============================================================

CREATE TABLE historial_tipos_examen (
  id          SERIAL PRIMARY KEY,
  codigo      TEXT UNIQUE NOT NULL,   -- 'sangre', 'rx', 'rm', etc. (slug interno)
  nombre      TEXT NOT NULL,          -- 'Examen de sangre', 'Radiografía (RX)', etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO historial_tipos_examen (codigo, nombre) VALUES
  ('sangre',       'Examen de sangre'),
  ('orina',        'Examen de orina'),
  ('rx',           'Radiografía (RX)'),
  ('rm',           'Resonancia magnética (RM)'),
  ('tac',          'Tomografía computada (TAC)'),
  ('ecografia',    'Ecografía'),
  ('colonoscopia', 'Colonoscopía'),
  ('endoscopia',   'Endoscopía'),
  ('mamografia',   'Mamografía'),
  ('electro',      'Electrocardiograma'),
  ('consulta',     'Consulta / control médico'),
  ('otro',         'Otro');

-- ============================================================
-- TABLA: historial_informes
-- Un registro por informe médico subido (resultado de examen,
-- informe de imagenología, epicrisis, etc.)
-- ============================================================

CREATE TABLE historial_informes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  tipo_examen_id  INTEGER NOT NULL REFERENCES historial_tipos_examen(id),

  fecha_examen    DATE,
  institucion     TEXT,
  medico_nombre   TEXT,
  interpretacion  TEXT,               -- resumen/hallazgos extraídos del informe
  notas           TEXT,               -- notas manuales del usuario

  -- Archivo
  storage_path    TEXT NOT NULL,
  storage_bucket  TEXT NOT NULL DEFAULT 'hoja-de-vida',
  mime_type       TEXT NOT NULL,
  file_size       INTEGER,

  -- Extracción IA (mismo patrón que documents.ai_confidence en 01_schema.sql)
  ai_extracted    BOOLEAN NOT NULL DEFAULT false,
  ai_confidence   NUMERIC(4, 3),
  needs_review    BOOLEAN NOT NULL DEFAULT false,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_historial_informes_patient ON historial_informes(patient_id);
CREATE INDEX idx_historial_informes_fecha ON historial_informes(fecha_examen);
CREATE INDEX idx_historial_informes_tipo ON historial_informes(tipo_examen_id);

-- ============================================================
-- RLS — mismo patrón que patients/medical_cases (04_rls.sql)
-- ============================================================

ALTER TABLE historial_informes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historial_informes: usuario ve los suyos"
  ON historial_informes FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Los tipos de examen son una taxonomía compartida, no datos privados.
-- Cualquier usuario autenticado puede leerlos y agregar tipos nuevos
-- (igual que "correlativos: solo lectura" en 04_rls.sql, pero con INSERT).
ALTER TABLE historial_tipos_examen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historial_tipos_examen: lectura"
  ON historial_tipos_examen FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "historial_tipos_examen: agregar nuevos"
  ON historial_tipos_examen FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- STORAGE — bucket nuevo, separado del bucket "documents"
-- Estructura: hoja-de-vida/{user_id}/{patient_id}/{filename}
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hoja-de-vida',
  'hoja-de-vida',
  false,
  52428800,           -- 50MB máximo por archivo, igual que "documents"
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage hoja-de-vida: upload propio"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'hoja-de-vida' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "storage hoja-de-vida: lectura propia"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'hoja-de-vida' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "storage hoja-de-vida: eliminar propio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'hoja-de-vida' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );
