-- Agrega el status NUEVA_INFO al ENUM case_status
-- Ejecutar en Supabase SQL Editor

ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'NUEVA_INFO';
