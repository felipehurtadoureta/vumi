-- ============================================================
-- VUMI MEDICAL REIMBURSEMENT SYSTEM
-- Migration 01: Schema completo
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE document_type AS ENUM (
  'boleta',
  'orden_medica',
  'liquidacion_banmedica',
  'liquidacion_metlife',
  'otro'
);

CREATE TYPE case_status AS ENUM (
  'SUBIDO',
  'PROCESANDO',
  'INCOMPLETO',
  'LISTO_PARA_VUMI',
  'ENVIADO_VUMI',
  'ENVIADO_METLIFE',
  'ENVIADO_BANMEDICA',
  'CERRADO',
  'RECHAZADO'
);

CREATE TYPE insurance_name AS ENUM (
  'banmedica',
  'metlife',
  'vumi'
);

CREATE TYPE currency_type AS ENUM (
  'CLP',
  'USD',
  'EUR'
);

CREATE TYPE email_status AS ENUM (
  'draft',
  'sent',
  'failed'
);

-- ============================================================
-- TABLA: patients
-- ============================================================

CREATE TABLE patients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  alias         TEXT,                          -- nombre corto para la UI
  birth_date    DATE,
  rut           TEXT,                          -- RUT chileno (opcional)
  relationship  TEXT,                          -- titular, cónyuge, hijo, etc.
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: correlativos
-- Secuencia auto-incremental por año para IDs de rendición
-- ============================================================

CREATE TABLE correlativos (
  id        SERIAL PRIMARY KEY,
  year      INTEGER NOT NULL,
  sequence  INTEGER NOT NULL,
  code      TEXT NOT NULL UNIQUE,             -- ej: "2026-000001"
  case_id   UUID,                             -- se llena cuando se asigna
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(year, sequence)
);

-- Función para generar el próximo correlativo del año
CREATE OR REPLACE FUNCTION generate_correlativo()
RETURNS TEXT AS $$
DECLARE
  current_year INTEGER := EXTRACT(YEAR FROM NOW());
  next_seq     INTEGER;
  code         TEXT;
BEGIN
  -- Obtener el próximo número de secuencia para este año
  SELECT COALESCE(MAX(sequence), 0) + 1
  INTO next_seq
  FROM correlativos
  WHERE year = current_year;

  -- Formatear: 2026-000001
  code := current_year::TEXT || '-' || LPAD(next_seq::TEXT, 6, '0');

  -- Insertar y retornar
  INSERT INTO correlativos (year, sequence, code)
  VALUES (current_year, next_seq, code);

  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLA: medical_cases
-- ============================================================

CREATE TABLE medical_cases (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  correlativo     TEXT UNIQUE,                 -- ej: "2026-000001", se asigna al enviar
  title           TEXT,                        -- descripción breve del caso
  status          case_status NOT NULL DEFAULT 'SUBIDO',
  event_date      DATE,                        -- fecha de la prestación médica
  total_amount    NUMERIC(12, 2),              -- monto total de la boleta
  currency        currency_type DEFAULT 'CLP',
  provider        TEXT,                        -- clínica / médico / farmacia
  notes           TEXT,

  -- Flags de completitud (calculados automáticamente vía trigger)
  has_boleta               BOOLEAN NOT NULL DEFAULT false,
  has_orden_medica         BOOLEAN NOT NULL DEFAULT false,
  has_liquidacion_banmedica BOOLEAN NOT NULL DEFAULT false,
  is_complete              BOOLEAN NOT NULL DEFAULT false,  -- true cuando tiene los 3

  -- IA metadata
  ai_suggested_patient     TEXT,
  ai_confidence            NUMERIC(4, 3),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: documents
-- ============================================================

CREATE TABLE documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Archivo
  filename        TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  file_size       INTEGER,                     -- bytes
  storage_path    TEXT NOT NULL,               -- path en Supabase Storage
  storage_bucket  TEXT NOT NULL DEFAULT 'documents',

  -- Deduplicación
  file_hash       TEXT,                        -- SHA-256 del archivo original
  is_duplicate    BOOLEAN NOT NULL DEFAULT false,
  duplicate_of    UUID REFERENCES documents(id),

  -- Datos extraídos por OCR + IA
  doc_type        document_type,
  ocr_raw_text    TEXT,                        -- texto crudo del OCR
  extracted_date  DATE,
  extracted_amount NUMERIC(12, 2),
  extracted_currency currency_type DEFAULT 'CLP',
  extracted_provider TEXT,
  extracted_receipt_number TEXT,
  extracted_patient_name TEXT,
  insurance_hint  insurance_name,
  ai_confidence   NUMERIC(4, 3),              -- 0.0 a 1.0
  needs_review    BOOLEAN NOT NULL DEFAULT false,

  -- Estado de procesamiento
  ocr_status      TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
  ocr_error       TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: case_documents
-- Pivot entre casos y documentos (un documento puede estar en un solo caso)
-- ============================================================

CREATE TABLE case_documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id     UUID NOT NULL REFERENCES medical_cases(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  role        document_type NOT NULL,          -- rol del doc dentro del caso
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id)                          -- un documento → un caso máximo
);

-- ============================================================
-- TABLA: insurance_claims
-- Registro de envíos por aseguradora
-- ============================================================

CREATE TABLE insurance_claims (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id       UUID NOT NULL REFERENCES medical_cases(id) ON DELETE CASCADE,
  insurance     insurance_name NOT NULL,
  submitted_at  TIMESTAMPTZ,
  amount_claimed NUMERIC(12, 2),
  amount_reimbursed NUMERIC(12, 2),
  reference_number TEXT,                       -- número de seguimiento aseguradora
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: email_logs
-- Trazabilidad de correos enviados
-- ============================================================

CREATE TABLE email_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id         UUID NOT NULL REFERENCES medical_cases(id) ON DELETE CASCADE,
  insurance       insurance_name NOT NULL,
  status          email_status NOT NULL DEFAULT 'draft',
  gmail_message_id TEXT,                       -- ID del mensaje en Gmail
  gmail_thread_id  TEXT,
  subject         TEXT NOT NULL,
  recipient       TEXT NOT NULL,
  body_preview    TEXT,
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: case_status_history
-- Auditoría de cambios de estado
-- ============================================================

CREATE TABLE case_status_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id     UUID NOT NULL REFERENCES medical_cases(id) ON DELETE CASCADE,
  from_status case_status,
  to_status   case_status NOT NULL,
  changed_by  UUID REFERENCES auth.users(id),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
