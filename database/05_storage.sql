-- ============================================================
-- VUMI MEDICAL REIMBURSEMENT SYSTEM
-- Migration 05: Storage buckets y políticas
-- ============================================================

-- Crear bucket para documentos médicos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,              -- privado, requiere URL firmada
  52428800,           -- 50MB máximo por archivo
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

-- ---------------------------------------------------------------
-- Storage RLS: cada usuario solo accede a sus archivos
-- Los archivos se guardan bajo: documents/{user_id}/{filename}
-- ---------------------------------------------------------------

CREATE POLICY "storage: upload propio"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "storage: lectura propia"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "storage: eliminar propio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );
