# Base de Datos — Vumi Medical System

## Cómo ejecutar las migraciones en Supabase

### Orden de ejecución (importante)

Ejecuta cada archivo **en orden** en el **SQL Editor** de Supabase:

| Archivo | Contenido |
|---------|-----------|
| `01_schema.sql` | Tablas, enums, función de correlativo |
| `02_indexes.sql` | Índices de performance |
| `03_triggers.sql` | Triggers automáticos (updated_at, completitud, historial) |
| `04_rls.sql` | Row Level Security (un usuario = sus datos) |
| `05_storage.sql` | Bucket `documents` + políticas de acceso |
| `06_seed.sql` | Pacientes de la familia Hurtado |

### Pasos

1. Ve a [supabase.com](https://supabase.com) → tu proyecto
2. En el menú lateral: **SQL Editor**
3. Copia y pega el contenido de `01_schema.sql` → clic en **Run**
4. Repite con cada archivo en orden

### Verificar que funcionó

```sql
-- Debes ver las 7 tablas creadas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Debes ver los 7 pacientes
SELECT full_name, alias FROM patients;
```

---

## Estructura de tablas

```
patients
  └── medical_cases (1:N)
        ├── case_documents (pivot) ── documents
        ├── insurance_claims
        ├── email_logs
        └── case_status_history

correlativos (tabla global de IDs)
```

## Funciones clave

- `generate_correlativo()` — genera el próximo ID `2026-XXXXXX`
- `assign_correlativo(case_id)` — asigna correlativo a un caso (idempotente)

## Regla de caso completo

Un caso pasa automáticamente a `LISTO_PARA_VUMI` cuando tiene:
- ✅ boleta
- ✅ orden_medica  
- ✅ liquidacion_banmedica
