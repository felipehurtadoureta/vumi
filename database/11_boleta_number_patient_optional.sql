-- 11_boleta_number_patient_optional.sql
-- Ejecutar en: Supabase Dashboard → SQL Editor

-- 1. Número de boleta como campo del caso (crítico para búsqueda y duplicados)
ALTER TABLE medical_cases ADD COLUMN IF NOT EXISTS boleta_number TEXT;

-- 2. Paciente opcional (se puede auto-detectar desde el OCR de la boleta)
ALTER TABLE medical_cases ALTER COLUMN patient_id DROP NOT NULL;

-- 3. Tabla de correcciones OCR — el sistema aprende de lo que corriges manualmente
CREATE TABLE IF NOT EXISTS ocr_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  case_id UUID REFERENCES medical_cases(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,       -- 'boleta_number', 'total_amount', 'event_date', etc.
  ocr_value TEXT,                 -- lo que extrajo el OCR (null si no lo detectó)
  corrected_value TEXT NOT NULL,  -- lo que ingresó el usuario
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ocr_corrections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ocr_corrections' AND policyname = 'ocr_corrections_policy'
  ) THEN
    CREATE POLICY "ocr_corrections_policy"
      ON ocr_corrections FOR ALL
      USING (case_id IN (SELECT id FROM medical_cases WHERE user_id = auth.uid()))
      WITH CHECK (case_id IN (SELECT id FROM medical_cases WHERE user_id = auth.uid()));
  END IF;
END $$;
