#!/bin/sh
# Rearma supabase/seed/demo.sql: la migración que falta + su apunte en el
# historial + los datos. Se genera en vez de mantenerse a mano para que la
# migración del archivo sea, byte a byte, la que está en migrations/.
set -eu
cd "$(dirname "$0")/../.."
SALIDA=supabase/seed/demo.sql
MIG=supabase/migrations/20261123120000_cuanto_deja_cada_trabajo.sql
VERSION=20261123120000
NOMBRE=cuanto_deja_cada_trabajo

cat > "$SALIDA" <<'CAB'
-- ===========================================================================
-- UN SOLO ARCHIVO para pegar en Supabase → SQL Editor y pulsar Run.
--
-- Generado por supabase/seed/armar.sh. No se edita a mano.
--
-- Hace tres cosas, en este orden y en una sola pasada:
--
--  1. aplica la migración de «cuánto deja cada trabajo» (F5), que es la única
--     que falta en el proyecto, y la deja apuntada en el historial de
--     migraciones para que no se vuelva a aplicar;
--  2. borra la organización «Margen Demo» si existe de una pasada anterior.
--     Los trabajos nacen al aprobar una cotización, así que una demo creada
--     antes de esta migración no tiene ninguno y la pantalla nueva saldría
--     vacía. Esto NO toca «Margen Pilot»: borra una sola fila, la de la demo,
--     y lo demás cae por cascada;
--  3. vuelve a crear «Margen Demo» con datos de prueba en todo, ahora con sus
--     trabajos y con dos compras atribuidas.
--
-- Para quitar la demo después, sin volver a crearla: borrar-demo.sql.
-- ===========================================================================

CAB

cat "$MIG" >> "$SALIDA"

cat >> "$SALIDA" <<APUNTE

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('$VERSION', '$NOMBRE')
on conflict (version) do nothing;

-- La demo de la pasada anterior, si está. Solo la demo: el slug es exacto y
-- «margen-pilot» no se parece a «margen-demo».
delete from organizations where slug = 'margen-demo';

APUNTE

cat supabase/seed/_datos-demo.sql >> "$SALIDA"
echo "armado: $SALIDA ($(wc -l < "$SALIDA") lineas)"
