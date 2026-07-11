-- ============================================================
-- VUMI MEDICAL REIMBURSEMENT SYSTEM
-- Migration 02: Índices para performance
-- ============================================================

-- patients
CREATE INDEX idx_patients_user_id ON patients(user_id);

-- medical_cases
CREATE INDEX idx_cases_user_id       ON medical_cases(user_id);
CREATE INDEX idx_cases_patient_id    ON medical_cases(patient_id);
CREATE INDEX idx_cases_status        ON medical_cases(status);
CREATE INDEX idx_cases_event_date    ON medical_cases(event_date DESC);
CREATE INDEX idx_cases_is_complete   ON medical_cases(is_complete) WHERE is_complete = true;
CREATE INDEX idx_cases_correlativo   ON medical_cases(correlativo) WHERE correlativo IS NOT NULL;

-- documents
CREATE INDEX idx_documents_user_id    ON documents(user_id);
CREATE INDEX idx_documents_file_hash  ON documents(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX idx_documents_doc_type   ON documents(doc_type);
CREATE INDEX idx_documents_ocr_status ON documents(ocr_status) WHERE ocr_status != 'done';

-- case_documents
CREATE INDEX idx_case_documents_case_id     ON case_documents(case_id);
CREATE INDEX idx_case_documents_document_id ON case_documents(document_id);

-- insurance_claims
CREATE INDEX idx_claims_case_id    ON insurance_claims(case_id);
CREATE INDEX idx_claims_insurance  ON insurance_claims(insurance);

-- email_logs
CREATE INDEX idx_email_logs_case_id ON email_logs(case_id);
CREATE INDEX idx_email_logs_status  ON email_logs(status);

-- case_status_history
CREATE INDEX idx_status_history_case_id ON case_status_history(case_id);
