# Sistema de Reembolsos Médicos Familiares — Arquitectura

> Versión 1.0 | Junio 2026  
> Proyecto: Vumi Medical Reimbursement System

---

## 1. Visión General

Sistema web full-stack para gestionar el ciclo completo de reembolsos médicos familiares: desde la subida de documentos hasta el envío automatizado a aseguradoras (Banmédica, MetLife, VUMI).

```
[Documentos] → [OCR + IA] → [Caso Médico] → [Motor de Estados] → [Email Aseguradora]
```

---

## 2. Stack Tecnológico

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Frontend | React 18 + Vite + TypeScript | SPA rápida, tipado estricto |
| UI Components | shadcn/ui + Tailwind CSS | Componentes accesibles, diseño consistente |
| Estado global | Zustand | Ligero, sin boilerplate de Redux |
| Backend/DB | Supabase (PostgreSQL) | Auth, Storage, Realtime, RLS integrados |
| Storage | Supabase Storage | Buckets para documentos médicos |
| OCR | Tesseract.js (client) + Google Vision API (server) | Fallback robusto |
| IA/LLM | Claude API (claude-haiku-4-5) | Extracción estructurada, clasificación |
| Email | Gmail API (OAuth2) | Envío con adjuntos desde cuenta del usuario |
| Hosting | Vercel (frontend) + Supabase Cloud | Deploy simple, escala automática |

---

## 3. Arquitectura de Módulos

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                       │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │Dashboard │  │ Upload   │  │  Cases   │  │  Timeline   │ │
│  │          │  │DropZone  │  │  List    │  │  Tracker    │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Case Detail View                         │   │
│  │  [Documents] [State Machine] [VUMI Send Button]      │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + Realtime (Supabase Client)
┌──────────────────────────▼──────────────────────────────────┐
│                    SUPABASE BACKEND                           │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ PostgreSQL  │  │   Storage    │  │   Edge Functions  │  │
│  │             │  │  (Buckets)   │  │                   │  │
│  │ - patients  │  │              │  │ - process-doc     │  │
│  │ - cases     │  │ - documents/ │  │ - ai-extract      │  │
│  │ - documents │  │ - originals/ │  │ - send-email      │  │
│  │ - claims    │  │ - processed/ │  │ - gen-correlativo │  │
│  │ - email_logs│  │              │  │                   │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
┌────────▼───────┐ ┌───────▼──────┐ ┌───────▼──────┐
│  Claude API    │ │ Google Vision │ │  Gmail API   │
│  (IA/LLM)      │ │  (OCR)        │ │  (Email)     │
└────────────────┘ └──────────────┘ └──────────────┘
```

---

## 4. Módulos del Sistema

### 4.1 Módulo de Ingesta de Documentos
**Responsabilidad:** Recibir archivos del usuario y persistirlos.

- Acepta: PDF, JPG, JPEG, PNG, HEIC
- Convierte HEIC → JPEG automáticamente (client-side, heic2any)
- Sube a Supabase Storage bucket `documents/originals/`
- Genera hash SHA-256 para detección de duplicados
- Dispara evento → Módulo OCR+IA

### 4.2 Módulo OCR + IA (Extracción)
**Responsabilidad:** Extraer datos estructurados de cada documento.

**Pipeline:**
```
Archivo → Pre-procesamiento → OCR (Google Vision) → LLM Claude → JSON estructurado
```

**Campos extraídos:**
```json
{
  "patient_name": "string",
  "document_type": "boleta|orden_medica|liquidacion_banmedica|liquidacion_metlife|otro",
  "date": "YYYY-MM-DD",
  "amount": 0.00,
  "currency": "CLP|USD",
  "provider": "string",
  "receipt_number": "string",
  "insurance_hint": "banmedica|metlife|vumi|null",
  "confidence": 0.0-1.0,
  "raw_text": "string"
}
```

**Regla IA:** Si `confidence < 0.7`, marcar campo como `needs_review: true`. No inventar datos.

### 4.3 Módulo de Casos Médicos
**Responsabilidad:** Agrupar documentos relacionados en un caso.

**Lógica de agrupación (IA-asistida):**
1. Mismo paciente + misma fecha ± 7 días → sugerir mismo caso
2. Mismo proveedor + mismo monto → posible duplicado (alertar)
3. Documentos huérfanos sin caso → aparecen en "Bandeja de entrada"

**Caso completo = tiene:**
- ✅ Al menos 1 boleta
- ✅ Al menos 1 orden médica
- ✅ Al menos 1 liquidación Banmédica

### 4.4 Motor de Estados (State Machine)
**Responsabilidad:** Controlar el ciclo de vida de cada caso.

```
SUBIDO
  └─► PROCESANDO (OCR en curso)
        └─► INCOMPLETO (faltan documentos)
              └─► LISTO_PARA_VUMI (caso completo)
                    └─► ENVIADO_VUMI
                          └─► ENVIADO_METLIFE
                                └─► ENVIADO_BANMEDICA
                                      └─► CERRADO

(cualquier estado) ──► RECHAZADO (error o cancelación manual)
```

**Transiciones válidas:** definidas en tabla `case_state_transitions` (no se puede saltar estados hacia atrás).

### 4.5 Módulo de Correlativos
**Responsabilidad:** Generar IDs únicos y trazables para envíos VUMI.

**Formato:** `{AÑO}-{SECUENCIA_6_DÍGITOS}`
**Ejemplo:** `2026-000001`

- Secuencia global por año, auto-incremental en PostgreSQL
- Una vez asignado a un caso, es inmutable
- Usado en: asunto del correo, nombre de archivos, base de datos

### 4.6 Módulo Email (Gmail API)
**Responsabilidad:** Crear y enviar correos a aseguradoras con adjuntos.

**Flujo:**
1. Usuario hace clic en "Generar envío VUMI"
2. Sistema asigna correlativo (si no tiene)
3. Genera draft en Gmail con:
   - **Asunto:** `Rendición N° {correlativo}`
   - **Cuerpo:** plantilla HTML con datos del caso
   - **Adjuntos:** todos los documentos del caso (PDF/imagen)
4. Abre Gmail en nueva pestaña (modo previsualización) **O** envía automáticamente
5. Registra en `email_logs`

---

## 5. Modelo de Datos (Resumen)

```
patients
  └── medical_cases (1:N)
        ├── case_documents (N:M) ── documents
        ├── insurance_claims (1:N)
        └── email_logs (1:N)
```

**Tablas principales:**
- `patients` — Felipe, Ana Luisa, Antonia, Felipe Jr, Ana, Martín, Ignacio
- `medical_cases` — casos con estado, correlativo, paciente
- `documents` — archivos con metadatos OCR+IA
- `case_documents` — tabla pivot casos↔documentos (con rol: boleta/orden/liquidacion)
- `insurance_claims` — historial de envíos por aseguradora
- `email_logs` — trazabilidad de emails enviados

---

## 6. Pantallas de la Aplicación

| Ruta | Pantalla | Descripción |
|------|----------|-------------|
| `/` | Dashboard | KPIs: casos pendientes, enviados, monto total |
| `/upload` | Subir Documentos | Drag & drop, progreso OCR en tiempo real |
| `/cases` | Lista de Casos | Filtros por estado, paciente, aseguradora |
| `/cases/:id` | Detalle de Caso | Documentos, estado, botón "Enviar VUMI" |
| `/timeline` | Timeline | Vista cronológica de todos los reembolsos |
| `/documents` | Bandeja de Entrada | Documentos sin caso asignado |

---

## 7. Seguridad y Acceso

- **Auth:** Supabase Auth (Google OAuth — misma cuenta Gmail)
- **RLS:** Row Level Security en todas las tablas (solo datos del usuario autenticado)
- **Storage:** Buckets privados, URLs firmadas con expiración
- **API Keys:** Claude API y Gmail API guardados en Supabase Vault (no en frontend)
- **HEIC Processing:** Solo client-side, nunca se sube el archivo original sin conversión previa

---

## 8. Flujo End-to-End (Happy Path)

```
1. Usuario sube boleta.pdf + orden.jpg + liquidacion_banmedica.pdf
2. Sistema OCR extrae datos de cada archivo
3. IA detecta que son del mismo paciente (Felipe) y misma fecha
4. Se crea automáticamente Caso #2026-000001 en estado PROCESANDO
5. Validación: tiene boleta ✅, orden ✅, liquidación ✅ → LISTO_PARA_VUMI
6. Usuario hace clic "Generar envío VUMI"
7. Sistema crea draft en Gmail con adjuntos y plantilla
8. Usuario revisa y envía → estado → ENVIADO_VUMI
9. Log guardado en email_logs con timestamp y message_id de Gmail
```

---

## 9. Consideraciones de Escalabilidad

- Supabase Edge Functions para procesamiento pesado (OCR, IA) → sin bloqueo en UI
- Realtime subscriptions para actualizar estado de casos sin polling
- Storage con CDN para acceso rápido a documentos
- Índices en `documents.hash` para detección de duplicados O(1)

---

## 10. Fases de Construcción

| Fase | Módulo | Estimación |
|------|--------|-----------|
| 1 | ✅ Arquitectura (este documento) | — |
| 2 | Base de datos SQL + migraciones Supabase | Siguiente |
| 3 | Backend: Edge Functions + servicios | |
| 4 | Frontend React + pantallas | |
| 5 | Integración OCR + IA (Claude API) | |
| 6 | Email automation (Gmail API) | |
