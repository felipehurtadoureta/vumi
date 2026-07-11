-- ============================================================
-- VUMI MEDICAL REIMBURSEMENT SYSTEM
-- Migration 06: Datos iniciales (seed)
-- IMPORTANTE: Ejecutar DESPUÉS de crear tu usuario en Supabase Auth
-- Reemplaza 'TU_USER_ID_AQUI' con tu UUID de auth.users
-- ============================================================

-- Para obtener tu user_id, ejecuta:
-- SELECT id FROM auth.users WHERE email = 'felipehurtadoureta@gmail.com';

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Obtener el user_id del usuario principal
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'felipehurtadoureta@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Usuario no encontrado. Crea tu cuenta primero en Supabase Auth.';
    RETURN;
  END IF;

  -- Insertar pacientes de la familia Hurtado
  INSERT INTO patients (user_id, full_name, alias, relationship, is_active) VALUES
    (v_user_id, 'Felipe Hurtado',    'Felipe',   'titular',  true),
    (v_user_id, 'Ana Luisa',         'Ana Luisa','cónyuge',  true),
    (v_user_id, 'Antonia Hurtado',   'Antonia',  'hijo/a',   true),
    (v_user_id, 'Felipe Hurtado Jr', 'Felipe Jr','hijo/a',   true),
    (v_user_id, 'Ana Hurtado',       'Ana',      'hijo/a',   true),
    (v_user_id, 'Martín Hurtado',    'Martín',   'hijo/a',   true),
    (v_user_id, 'Ignacio Hurtado',   'Ignacio',  'hijo/a',   true)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seed completado para usuario: %', v_user_id;
END;
$$;
