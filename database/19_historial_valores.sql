-- ============================================================
-- VUMI — Migration 19: Hoja de Vida Médica — Valores estructurados
-- Guarda los valores individuales de exámenes tabulares (hemogramas,
-- perfiles bioquímicos, etc.) asociados a un informe ya existente.
-- No toca ninguna tabla existente del sistema de reembolsos ni de
-- la migración 18.
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

CREATE TABLE historial_valores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  informe_id      UUID NOT NULL REFERENCES historial_informes(id) ON DELETE CASCADE,

  nombre_valor    TEXT NOT NULL,      -- ej: 'Glucosa', 'Nitrógeno Ureico', 'Urea'
  valor           NUMERIC,
  unidad          TEXT,               -- ej: 'mg/dL'
  rango_min       NUMERIC,
  rango_max       NUMERIC,
  fuera_de_rango  BOOLEAN GENERATED ALWAYS AS (
    valor IS NOT NULL AND rango_min IS NOT NULL AND rango_max IS NOT NULL
    AND (valor < rango_min OR valor > rango_max)
  ) STORED,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_historial_valores_informe ON historial_valores(informe_id);
CREATE INDEX idx_historial_valores_nombre ON historial_valores(nombre_valor);

-- ============================================================
-- RLS — mismo patrón que case_documents/insurance_claims (04_rls.sql):
-- esta tabla no tiene user_id propio, se valida vía join al informe.
-- ============================================================

ALTER TABLE historial_valores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historial_valores: usuario accede a los suyos"
  ON historial_valores FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM historial_informes
      WHERE id = historial_valores.informe_id
      AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM historial_informes
      WHERE id = historial_valores.informe_id
      AND user_id = auth.uid()
    )
  );
