-- ============================================================
-- VUMI MEDICAL REIMBURSEMENT SYSTEM
-- Migration 03: Triggers y funciones automáticas
-- ============================================================

-- ---------------------------------------------------------------
-- Trigger: updated_at automático en todas las tablas
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_patients_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cases_updated_at
  BEFORE UPDATE ON medical_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_claims_updated_at
  BEFORE UPDATE ON insurance_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------
-- Trigger: Actualizar flags de completitud del caso
-- cuando se agrega/elimina un documento en case_documents
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_case_completeness()
RETURNS TRIGGER AS $$
DECLARE
  v_case_id UUID;
  v_has_boleta BOOLEAN;
  v_has_orden BOOLEAN;
  v_has_liquidacion BOOLEAN;
BEGIN
  -- Determinar el case_id según operación
  IF TG_OP = 'DELETE' THEN
    v_case_id := OLD.case_id;
  ELSE
    v_case_id := NEW.case_id;
  END IF;

  -- Verificar qué tipos de documentos tiene el caso
  SELECT
    BOOL_OR(role = 'boleta')                INTO v_has_boleta
  FROM case_documents WHERE case_id = v_case_id;

  SELECT
    BOOL_OR(role = 'orden_medica')          INTO v_has_orden
  FROM case_documents WHERE case_id = v_case_id;

  SELECT
    BOOL_OR(role = 'liquidacion_banmedica') INTO v_has_liquidacion
  FROM case_documents WHERE case_id = v_case_id;

  -- Actualizar flags en medical_cases
  UPDATE medical_cases SET
    has_boleta                = COALESCE(v_has_boleta, false),
    has_orden_medica          = COALESCE(v_has_orden, false),
    has_liquidacion_banmedica = COALESCE(v_has_liquidacion, false),
    is_complete               = (
      COALESCE(v_has_boleta, false) AND
      COALESCE(v_has_orden, false) AND
      COALESCE(v_has_liquidacion, false)
    ),
    -- Si el caso está completo y estaba INCOMPLETO → LISTO_PARA_VUMI
    status = CASE
      WHEN (
        COALESCE(v_has_boleta, false) AND
        COALESCE(v_has_orden, false) AND
        COALESCE(v_has_liquidacion, false)
      ) AND status = 'INCOMPLETO' THEN 'LISTO_PARA_VUMI'::case_status
      -- Si le quitaron documentos y estaba LISTO → INCOMPLETO
      WHEN NOT (
        COALESCE(v_has_boleta, false) AND
        COALESCE(v_has_orden, false) AND
        COALESCE(v_has_liquidacion, false)
      ) AND status = 'LISTO_PARA_VUMI' THEN 'INCOMPLETO'::case_status
      ELSE status
    END
  WHERE id = v_case_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_case_completeness
  AFTER INSERT OR UPDATE OR DELETE ON case_documents
  FOR EACH ROW EXECUTE FUNCTION update_case_completeness();

-- ---------------------------------------------------------------
-- Trigger: Registrar cambios de estado en historial
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION log_case_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO case_status_history (case_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_case_status_history
  AFTER UPDATE ON medical_cases
  FOR EACH ROW EXECUTE FUNCTION log_case_status_change();

-- ---------------------------------------------------------------
-- Función: Asignar correlativo a un caso (llamar manualmente)
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION assign_correlativo(p_case_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  -- Verificar si ya tiene correlativo
  SELECT correlativo INTO v_code FROM medical_cases WHERE id = p_case_id;
  IF v_code IS NOT NULL THEN
    RETURN v_code; -- ya tiene uno, retornar el existente
  END IF;

  -- Generar nuevo correlativo
  v_code := generate_correlativo();

  -- Asignarlo al caso y al registro de correlativos
  UPDATE medical_cases SET correlativo = v_code WHERE id = p_case_id;
  UPDATE correlativos SET case_id = p_case_id WHERE code = v_code;

  RETURN v_code;
END;
$$ LANGUAGE plpgsql;
