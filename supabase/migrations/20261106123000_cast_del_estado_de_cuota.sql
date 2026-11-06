-- ---------------------------------------------------------------------------
-- Margen Pilot · F3-1 · El estado de la cuota necesita su cast
-- ---------------------------------------------------------------------------
--
-- `20261106120000` aplicó bien y falló al primer cobro de verdad:
--
--   column "status" is of type schedule_status but expression is of type text
--
-- Un `case` devuelve texto, y `payment_schedule_items.status` es un enum.
-- Postgres no lo convierte solo en un `update`, así que el disparador que
-- pasa la cuota a `settled` reventaba justo en el momento en que entraba el
-- dinero: el peor sitio posible.
--
-- Va en su propia migración y no reescribiendo la anterior, porque la anterior
-- ya está aplicada en la base real. Un archivo de migración tiene que decir
-- lo que de verdad se ejecutó, incluido lo que salió mal.
--
-- Lo cazó la comprobación contra la base real, no la revisión del código: el
-- cast que falta se ve cuando se ejecuta.
-- ---------------------------------------------------------------------------

create or replace function app.recalcula_estado_documento(p_doc uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc    record;
  v_pagado numeric;
  v_estado document_status;
begin
  if p_doc is null then return; end if;

  select d.id, d.amount_total, d.status into v_doc
    from billing_documents d where d.id = p_doc;
  if v_doc.id is null then return; end if;

  -- Un documento anulado se queda anulado: un cobro posterior no lo revive.
  if v_doc.status = 'void' then return; end if;

  select coalesce(sum(a.amount), 0) into v_pagado
    from payment_allocations a
    join cash_movements m on m.id = a.cash_movement_id
   where a.billing_document_id = p_doc and not m.is_void;

  v_estado := case
                when v_pagado >= v_doc.amount_total then 'paid'
                when v_pagado > 0                   then 'partially_paid'
                else                                     'open'
              end::document_status;

  if v_estado is distinct from v_doc.status then
    update billing_documents set status = v_estado where id = p_doc;
  end if;

  -- La cuota sigue a su documento. Cobrado del todo, `settled`; si se anula el
  -- cobro, vuelve a `documented`. Las previstas y las canceladas no se tocan.
  update payment_schedule_items
     set status = (case when v_estado = 'paid' then 'settled' else 'documented' end)::schedule_status
   where billing_document_id = p_doc
     and status in ('documented', 'settled');
end $$;
