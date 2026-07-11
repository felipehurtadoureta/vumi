-- ============================================================
-- VUMI MEDICAL REIMBURSEMENT SYSTEM
-- Migration 04: Row Level Security (RLS)
-- Cada usuario solo ve sus propios datos
-- ============================================================

-- ---------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients: usuario ve los suyos"
  ON patients FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------
-- medical_cases
-- ---------------------------------------------------------------
ALTER TABLE medical_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cases: usuario ve los suyos"
  ON medical_cases FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents: usuario ve los suyos"
  ON documents FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------
-- case_documents (acceso basado en ownership del caso)
-- ---------------------------------------------------------------
ALTER TABLE case_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "case_documents: usuario accede a sus casos"
  ON case_documents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM medical_cases
      WHERE id = case_documents.case_id
      AND user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- insurance_claims
-- ---------------------------------------------------------------
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claims: usuario accede a sus casos"
  ON insurance_claims FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM medical_cases
      WHERE id = insurance_claims.case_id
      AND user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- email_logs
-- ---------------------------------------------------------------
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_logs: usuario accede a sus casos"
  ON email_logs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM medical_cases
      WHERE id = email_logs.case_id
      AND user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- case_status_history
-- ---------------------------------------------------------------
ALTER TABLE case_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "status_history: usuario accede a sus casos"
  ON case_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM medical_cases
      WHERE id = case_status_history.case_id
      AND user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- correlativos (solo lectura para usuarios)
-- ---------------------------------------------------------------
ALTER TABLE correlativos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "correlativos: solo lectura"
  ON correlativos FOR SELECT
  USING (true); -- cualquier usuario autenticado puede leer
