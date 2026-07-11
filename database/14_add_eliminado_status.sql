-- Migración 14: Agregar estado ELIMINADO al enum + fix RLS en correlativos

-- 1. Nuevos estados
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'ELIMINADO';
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'ARCHIVADO';

-- 2. Fix: las funciones de correlativo necesitan SECURITY DEFINER
--    para poder insertar en correlativos sin que RLS lo bloquee
CREATE OR REPLACE FUNCTION generate_correlativo()
RETURNS TEXT AS $$
DECLARE
  current_year INTEGER := EXTRACT(YEAR FROM NOW());
  next_seq     INTEGER;
  code         TEXT;
BEGIN
  SELECT COALESCE(MAX(sequence), 0) + 1
  INTO next_seq
  FROM correlativos
  WHERE year = current_year;

  code := current_year::TEXT || '-' || LPAD(next_seq::TEXT, 6, '0');

  INSERT INTO correlativos (year, sequence, code)
  VALUES (current_year, next_seq, code);

  RETURN code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION assign_correlativo(p_case_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  SELECT correlativo INTO v_code FROM medical_cases WHERE id = p_case_id;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  v_code := generate_correlativo();

  UPDATE medical_cases SET correlativo = v_code WHERE id = p_case_id;
  UPDATE correlativos SET case_id = p_case_id WHERE code = v_code;

  RETURN v_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
