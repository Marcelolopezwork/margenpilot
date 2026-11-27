#!/bin/sh
# Rearma supabase/seed/demo.sql: la migración que falta + su apunte en el
# historial + los datos. Se genera en vez de mantenerse a mano para que la
# migración del archivo sea, byte a byte, la que está en migrations/.
set -eu
cd "$(dirname "$0")/../.."
SALIDA=supabase/seed/demo.sql
# Las migraciones que todavía no están en producción, en orden. Son varias
# desde que una entrega lleva más de una: el archivo las aplica en el mismo
# orden en que la CI las replica, que es el único orden que se ha probado.
MIGS="20261127120000_que_no_falte_ninguna_linea"

cat > "$SALIDA" <<'CAB'
-- ===========================================================================
-- UN SOLO ARCHIVO para pegar en Supabase → SQL Editor y pulsar Run.
--
-- Generado por supabase/seed/armar.sh. No se edita a mano.
--
-- Hace tres cosas, en este orden y en una sola pasada:
--
--  1. aplica la migración que falta en el proyecto —la comprobación de que
--     un extracto no venga cortado (F4-4)— y la deja apuntada en el
--     historial para que no se vuelva a aplicar;
--  2. borra la organización «Margen Demo» si existe de una pasada anterior,
--     para volver a crearla con los datos nuevos. Esto NO toca «Margen
--     Pilot»: borra una sola fila, la de la demo, y lo demás cae por cascada;
--  3. vuelve a crear «Margen Demo» con datos de prueba en todo: sus trabajos
--     con dos compras atribuidas, dos previstos de una sola vez —uno
--     adelantado a medias— y un extracto de banco de tres líneas con sus
--     saldos declarados: una cuadrada y dos que no están en el libro.
--
-- Todo va dentro de una transacción: o entra el archivo entero o no entra
-- nada. Si algo falla a mitad, la base se queda exactamente como estaba, sin
-- una tabla a medias ni una migración apuntada que no se aplicó. En Postgres
-- el DDL también es transaccional, así que esto vale para las tablas y las
-- funciones igual que para los datos.
--
-- Para quitar la demo después, sin volver a crearla: borrar-demo.sql.
-- ===========================================================================

begin;

CAB

for MIG in $MIGS; do
  VERSION=$(echo "$MIG" | cut -d_ -f1)
  NOMBRE=$(echo "$MIG" | cut -d_ -f2-)
  cat "supabase/migrations/$MIG.sql" >> "$SALIDA"
  cat >> "$SALIDA" <<APUNTE

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('$VERSION', '$NOMBRE')
on conflict (version) do nothing;

APUNTE
done

cat >> "$SALIDA" <<'APUNTE'

-- La demo de la pasada anterior, si está. Solo la demo: el slug es exacto y
-- «margen-pilot» no se parece a «margen-demo».
delete from organizations where slug = 'margen-demo';

APUNTE

cat supabase/seed/_datos-demo.sql >> "$SALIDA"

cat >> "$SALIDA" <<'CIERRE'

commit;
CIERRE

echo "armado: $SALIDA ($(wc -l < "$SALIDA") lineas)"
