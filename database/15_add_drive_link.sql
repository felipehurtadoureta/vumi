-- Migración 15: Agregar columna drive_link a documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_link TEXT;
