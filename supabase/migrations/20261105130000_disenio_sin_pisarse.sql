-- ---------------------------------------------------------------------------
-- El diseño se parchea, no se reescribe entero
-- ---------------------------------------------------------------------------
--
-- Marcelo probó la propuesta en línea y dijo que la portada y la tipografía
-- «no hacen nada». La bitácora de `audit_log` contó otra cosa: sus clics sí
-- escribían —`dividida`, `banda`, `editorial`— y un instante después llegaba
-- otra escritura con `completa` y `bebas`, los valores de serie, que deshacía
-- lo anterior.
--
-- La causa: cada control guardaba el objeto de diseño **entero**, armado a
-- partir del que la pantalla tuviera a mano. Si ese estaba viejo —y lo estaba,
-- porque el editor y la propuesta compartían la misma clave de caché con
-- columnas distintas y una de las dos no traía `design`— lo viejo pisaba lo
-- nuevo.
--
-- La cura es que nadie escriba el objeto entero. Cada control manda solo su
-- campo y la base lo funde con lo que ya hay. Dos cambios seguidos ya no
-- pueden borrarse el uno al otro, venga de donde venga cada uno.
-- ---------------------------------------------------------------------------

create or replace function set_quote_design(p_quote uuid, p_patch jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_design jsonb;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'design_patch_invalid: el parche de diseño tiene que ser un objeto';
  end if;

  update quotes
     set design = coalesce(design, '{}'::jsonb) || p_patch
   where id = p_quote
  returning design into v_design;

  -- Sin esto, una cotización de otra organización devolvería cero filas y la
  -- pantalla diría que guardó. Es justo el fallo que se está arreglando.
  if v_design is null then
    raise exception 'quote_not_found: la cotización no existe o no es de tu organización';
  end if;

  return v_design;
end;
$$;

comment on function set_quote_design(uuid, jsonb) is
  'Funde un parche en quotes.design sin reescribir lo demás. security invoker: manda la política de quotes.';

grant execute on function set_quote_design(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Cada ficha de servicio lleva su foto
-- ---------------------------------------------------------------------------
--
-- Lo pidió él: que una propuesta de branding salga con el banner de branding
-- sin tener que elegirlo cada vez. La foto de la ficha es el valor de partida;
-- la cotización puede poner otra encima y esa manda.

alter table services add column cover_path text;

comment on column services.cover_path is
  'Foto de la biblioteca que acompaña a este servicio en la propuesta. La cotización puede sustituirla.';
