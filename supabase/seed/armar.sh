#!/bin/sh
# Rearma supabase/seed/demo.sql: la migración que falta + su apunte en el
# historial + los datos. Se genera en vez de mantenerse a mano para que la
# migración del archivo sea, byte a byte, la que está en migrations/.
set -eu
cd "$(dirname "$0")/../.."
SALIDA=supabase/seed/demo.sql
MIG=supabase/migrations/20261110120000_lo_que_compras_tiene_proveedor.sql

cat > "$SALIDA" <<'CAB'
-- ===========================================================================
-- UN SOLO ARCHIVO para pegar en Supabase → SQL Editor y pulsar Run.
--
-- Generado por supabase/seed/armar.sh. No se edita a mano.
--
-- Hace dos cosas, en este orden y en una sola pasada:
--
--  1. aplica la migración de proveedores y compras (F3-6), que es la única que
--     falta en el proyecto, y la deja apuntada en el historial de migraciones
--     para que no se vuelva a aplicar;
--  2. crea la organización «Margen Demo» con datos de prueba en todo.
--
-- No toca «Margen Pilot». Para quitar la demo después: borrar-demo.sql.
-- ===========================================================================

CAB

cat "$MIG" >> "$SALIDA"

cat >> "$SALIDA" <<'APUNTE'

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261110120000', 'lo_que_compras_tiene_proveedor')
on conflict (version) do nothing;

APUNTE

cat supabase/seed/_datos-demo.sql >> "$SALIDA"
echo "armado: $SALIDA ($(wc -l < "$SALIDA") lineas)"
