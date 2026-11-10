import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeEscribirDinero, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { currencyOf, format, fromRow, toDb } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import { porMoneda } from './cartera';
import {
  CADENCIAS,
  lunesDe,
  nombreCadencia,
  ocurrencias,
  pagableDesde,
  salidasEsperadas,
  sumarSemanas,
} from './proyeccion';
import type { GastoRecurrente, PagoRegistrado } from './proyeccion';

/**
 * Los gastos que salen todos los meses: suscripciones, hosting, el contador.
 *
 * La idea que esta pantalla tiene que dejar clara es que **un gasto fijo no es
 * un movimiento**. Es una regla que dice «el día 5 de cada mes salen 200
 * dólares». No toca el saldo de ninguna cuenta hasta que lo pagas de verdad y
 * lo registras, igual que una cuota prevista no es una factura. Lo que hace es
 * aparecer en la proyección, que es donde sirve.
 */
export default function GastosFijos() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const recargar = useRecargar(['gastos-fijos', 'pagos-de-gastos']);
  const conDinero = puedeEscribirDinero(organizacion.rol);
  const hoy = new Date().toISOString().slice(0, 10);

  const [exito, setExito] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [entidadId, setEntidadId] = useState(entidad?.id ?? '');
  const [etiqueta, setEtiqueta] = useState('');
  const [importe, setImporte] = useState('');
  const [moneda, setMoneda] = useState('');
  const [cadencia, setCadencia] = useState<Enums<'recurrence'>>('monthly');
  const [dia, setDia] = useState('');
  const [desde, setDesde] = useState(hoy);
  const [cuentaId, setCuentaId] = useState('');
  const [fichaId, setFichaId] = useState('');
  const [nota, setNota] = useState('');

  const consulta = useQuery({
    queryKey: ['gastos-fijos-todos', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      let q = requireSupabase()
        .from('recurring_expenses')
        .select('id, label, amount, currency_code, cadence, day_of_month, starts_on, ends_on, is_active, cash_account_id, legal_entity_id, cost_item_id, notes, created_at')
        .eq('organization_id', organizacion.id)
        .order('is_active', { ascending: false })
        .order('label');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const pagos = useQuery({
    queryKey: ['pagos-de-gastos', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('cash_movements')
        .select('recurring_expense_id, value_date, is_void')
        .eq('organization_id', organizacion.id)
        .not('recurring_expense_id', 'is', null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cuentas = useQuery({
    queryKey: ['cuentas', organizacion.id, 'para-gastos'],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('cash_accounts')
        .select('id, name, currency_code, legal_entity_id')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  // El catálogo de costos sirve para no teclear dos veces lo mismo: las once
  // herramientas que ya están cargadas como costo son, casi todas,
  // suscripciones que salen cada mes.
  const fichas = useQuery({
    queryKey: ['costos-para-gastos', organizacion.id],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('cost_items')
        .select('id, name, unit, unit_cost, currency_code, kind, legal_entity_id')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  function limpiar() {
    setEditando(null);
    setEtiqueta('');
    setImporte('');
    setDia('');
    setNota('');
    setFichaId('');
    setCadencia('monthly');
    setDesde(hoy);
  }

  const guardar = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('guardar_gasto_recurrente', {
        p_entity: entidadId,
        p_label: etiqueta.trim(),
        p_amount: Number(importe.replace(',', '.')),
        p_currency: moneda,
        p_cadence: cadencia,
        p_starts_on: desde,
        ...(editando ? { p_id: editando } : {}),
        ...(dia.trim() ? { p_day: Number(dia) } : {}),
        ...(cuentaId ? { p_account: cuentaId } : {}),
        ...(fichaId ? { p_cost_item: fichaId } : {}),
        ...(nota.trim() ? { p_notes: nota.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(
        editando
          ? `${etiqueta.trim()} queda actualizado. La proyección ya usa el importe nuevo.`
          : `${etiqueta.trim()} entra en la proyección ${nombreCadencia(cadencia)}. No ha movido ningún saldo: es una regla, no un pago.`,
      );
      limpiar();
      recargar();
    },
  });

  const archivar = useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo?: string }) => {
      const { error } = await requireSupabase().rpc('archivar_gasto_recurrente', {
        p_id: id,
        ...(motivo ? { p_motivo: motivo } : {}),
      });
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  if (!conDinero) {
    return (
      <Seccion
        titulo="Gastos fijos"
        regla="Un gasto fijo es una regla de proyección, no un movimiento: no toca el saldo de ninguna cuenta hasta que lo pagas."
      >
        <Vacio
          titulo="Esta sección es de finanzas"
          explicacion="Tu rol en esta organización es comercial. Los gastos de la empresa no te los enseña la base de datos."
          siguiente="Si necesitas verlos, el dueño puede cambiarte el rol a finanzas."
        />
      </Seccion>
    );
  }

  const gastos: GastoRecurrente[] = (consulta.data ?? []).map((g) => ({
    id: g.id,
    label: g.label,
    amount: String(g.amount),
    currency_code: g.currency_code,
    cadence: g.cadence,
    day_of_month: g.day_of_month,
    starts_on: g.starts_on,
    ends_on: g.ends_on,
    is_active: g.is_active,
    recorded_on: g.created_at.slice(0, 10),
  }));

  const registrados: PagoRegistrado[] = (pagos.data ?? []).map((p) => ({
    recurring_expense_id: p.recurring_expense_id,
    value_date: p.value_date,
    is_void: p.is_void,
  }));

  // Lo que sale en las próximas trece semanas. Exacto y no un promedio: un
  // gasto anual dividido entre doce es una cifra que no sale ningún mes.
  const primeraSemana = lunesDe(hoy);
  const salidas = salidasEsperadas(
    gastos.filter((g) => g.is_active),
    registrados,
    primeraSemana,
    sumarSemanas(primeraSemana, 13),
  );
  const totales = porMoneda(
    salidas.map((s) => ({ currency_code: s.currency_code, importe: s.amount })),
  );

  const cuentasDeLaEntidad = (cuentas.data ?? []).filter(
    (c) => c.legal_entity_id === entidadId && (!moneda || c.currency_code === moneda),
  );

  // Cuántos pagos señalan al gasto que se está editando. Mientras sean cero, su
  // empresa y su moneda se pueden cambiar: no hay enlace que romper. Es el caso
  // de un gasto que se cargó en una empresa que no tiene cuentas en esa moneda,
  // y que por tanto nunca se pudo pagar.
  const pagosDelQueEdito = editando
    ? (pagos.data ?? []).filter((p) => p.recurring_expense_id === editando).length
    : 0;
  const puedeMudarse = pagosDelQueEdito === 0;

  // El dinero sale de una cuenta concreta de una empresa concreta. Si la
  // empresa elegida no tiene ninguna cuenta en esa moneda, el gasto se puede
  // guardar —entra en la proyección igual— pero no se podrá pagar. Decirlo
  // ahora es la diferencia entre un aviso y un error una semana después.
  const nombreEntidad = entidades.find((x) => x.id === entidadId)?.legal_name ?? 'Esa empresa';
  const sinCuentaPosible = entidadId !== '' && moneda !== '' && cuentasDeLaEntidad.length === 0;
  // Un costo compartido no tiene entidad, así que vale para las dos.
  const fichasPosibles = (fichas.data ?? []).filter(
    (f) => f.legal_entity_id === null || f.legal_entity_id === entidadId,
  );

  function elegirFicha(id: string) {
    setFichaId(id);
    const ficha = (fichas.data ?? []).find((f) => f.id === id);
    if (!ficha) return;
    setEtiqueta(ficha.name);
    setImporte(toDb(fromRow(ficha.unit_cost, currencyOf(ficha.currency_code))));
    setMoneda(ficha.currency_code);
    // «año» en el catálogo es un gasto anual; el resto se trata como mensual,
    // que es lo que son las suscripciones.
    setCadencia(ficha.unit === 'año' ? 'yearly' : 'monthly');
  }

  function editar(id: string) {
    const g = (consulta.data ?? []).find((x) => x.id === id);
    if (!g) return;
    setEditando(id);
    setEntidadId(g.legal_entity_id);
    setEtiqueta(g.label);
    setImporte(toDb(fromRow(g.amount, currencyOf(g.currency_code))));
    setMoneda(g.currency_code);
    setCadencia(g.cadence);
    setDia(g.day_of_month === null ? '' : String(g.day_of_month));
    setDesde(g.starts_on);
    setCuentaId(g.cash_account_id ?? '');
    setFichaId(g.cost_item_id ?? '');
    setNota(g.notes ?? '');
    setExito(null);
  }

  return (
    <Seccion
      titulo="Gastos fijos"
      regla="Un gasto fijo es una regla, no un movimiento: dice cuánto sale y cada cuánto, y aparece en la proyección de caja. No toca el saldo de ninguna cuenta hasta que lo pagas de verdad y lo registras en el libro."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      {totales.length > 0 && (
        <Tarjeta className="p-5">
          <p className="text-sm text-muted">Lo que sale en las próximas trece semanas</p>
          <div className="mt-2 flex flex-wrap gap-8">
            {totales.map((t) => (
              <div key={t.moneda}>
                <p className="num text-2xl font-semibold tracking-tight">{format(t.total)}</p>
                <p className="mt-1 text-sm text-muted">
                  {t.cuantos} {t.cuantos === 1 ? 'pago' : 'pagos'}
                  {totales.length > 1 ? ` · ${t.moneda}` : ''}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 max-w-prose text-xs text-subtle">
            Es la suma exacta de los pagos que caen en esas trece semanas, no un promedio
            mensual: un gasto anual dividido entre doce da una cifra que no sale ningún mes.
          </p>
        </Tarjeta>
      )}

      {consulta.isPending && <Cargando que="tus gastos fijos" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}
      {archivar.error && <Aviso tipo="error">{mensajeDeError(archivar.error)}</Aviso>}

      {consulta.data?.length === 0 && (
        <Vacio
          titulo="Todavía no hay ningún gasto fijo"
          explicacion="Mientras no los cargues, la proyección de caja solo tiene entradas y dice que vas a tener más dinero del que vas a tener."
          siguiente="Empieza por las suscripciones que ya tienes en el catálogo de costos: el formulario de abajo las ofrece para no teclearlas otra vez."
        />
      )}

      {consulta.data && consulta.data.length > 0 && (
        <Lista>
          {consulta.data.map((g) => {
            const dinero = fromRow(g.amount, currencyOf(g.currency_code));
            const cuenta = (cuentas.data ?? []).find((c) => c.id === g.cash_account_id);
            // Un gasto al que ninguna cuenta puede pagar se dice en la lista y
            // no al intentar pagarlo. Ahí ya es un error; aquí todavía es algo
            // que se puede arreglar.
            const pagable = (cuentas.data ?? []).some((c) =>
              pagableDesde(g, { legal_entity_id: c.legal_entity_id, currency_code: c.currency_code }),
            );
            const suEmpresa =
              entidades.find((x) => x.id === g.legal_entity_id)?.legal_name ?? 'Su empresa';
            const proximas = ocurrencias(
              {
                id: g.id, label: g.label, amount: String(g.amount),
                currency_code: g.currency_code, cadence: g.cadence,
                day_of_month: g.day_of_month, starts_on: g.starts_on,
                ends_on: g.ends_on, is_active: g.is_active,
                recorded_on: g.created_at.slice(0, 10),
              },
              hoy,
              sumarSemanas(primeraSemana, 13),
            );
            return (
              <Fila
                key={g.id}
                principal={
                  <>
                    <span className={`font-medium ${g.is_active ? '' : 'text-muted'}`}>
                      {g.label}
                    </span>
                    <Etiqueta>{nombreCadencia(g.cadence)}</Etiqueta>
                    {!g.is_active && <Etiqueta tono="atencion">archivado</Etiqueta>}
                    {g.is_active && !pagable && (
                      <Etiqueta tono="atencion">no se puede pagar</Etiqueta>
                    )}
                  </>
                }
                secundario={
                  <>
                    {cuenta
                      ? `Sale de ${cuenta.name}`
                      : pagable
                        ? 'Sin cuenta decidida'
                        : `${suEmpresa} no tiene cuentas en ${g.currency_code}`}
                    {g.is_active && proximas[0]
                      ? ` · el próximo el ${formatoFecha(proximas[0])}`
                      : g.is_active
                        ? ' · sin pagos en las próximas trece semanas'
                        : g.ends_on
                          ? ` · archivado el ${formatoFecha(g.ends_on)}`
                          : ''}
                    {g.notes ? ` · ${g.notes}` : ''}
                  </>
                }
                extremo={
                  <>
                    <p className="num font-medium">{format(dinero)}</p>
                    <Boton onClick={() => editar(g.id)}>Editar</Boton>
                    <Boton
                      onClick={() => {
                        if (!g.is_active) {
                          archivar.mutate({ id: g.id });
                          return;
                        }
                        const motivo = window.prompt(
                          '¿Por qué se archiva? Queda escrito. Deja vacío si no hace falta.',
                        );
                        if (motivo === null) return;
                        archivar.mutate(
                          motivo.trim() ? { id: g.id, motivo: motivo.trim() } : { id: g.id },
                        );
                      }}
                      disabled={archivar.isPending}
                    >
                      {g.is_active ? 'Archivar' : 'Reactivar'}
                    </Boton>
                  </>
                }
              />
            );
          })}
        </Lista>
      )}

      <Alta
        titulo={editando ? 'Editar el gasto fijo' : 'Añadir un gasto fijo'}
        exito={exito}
        onSubmit={() => guardar.mutate()}
      >
        <Selector
          etiqueta="Empresa que lo paga"
          ayuda="Obligatoria: el dinero sale de una cuenta concreta de una empresa concreta. Si lo pagan las dos a medias, son dos gastos."
          value={entidadId}
          onChange={(e) => setEntidadId(e.target.value)}
          required
          disabled={!puedeMudarse}
        >
          <option value="">Elige una empresa</option>
          {entidades.map((x) => (
            <option key={x.id} value={x.id}>
              {x.legal_name}
            </option>
          ))}
        </Selector>

        {entidadId && fichasPosibles.length > 0 && !editando && (
          <Selector
            etiqueta="¿Ya está en el catálogo de costos?"
            ayuda="Elegirlo rellena el nombre, el importe y la moneda. Opcional."
            value={fichaId}
            onChange={(e) => elegirFicha(e.target.value)}
          >
            <option value="">No, lo escribo a mano</option>
            {fichasPosibles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} · {f.unit_cost} {f.currency_code}/{f.unit}
              </option>
            ))}
          </Selector>
        )}

        <Campo
          etiqueta="Concepto"
          ayuda="Como lo vas a reconocer en el extracto del banco."
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          required
        />

        <Selector
          etiqueta="Moneda"
          ayuda={
            puedeMudarse
              ? 'Se puede cambiar mientras el gasto no tenga ningún pago registrado. Con pagos dentro, no: lo señalan con su moneda.'
              : `Este gasto ya tiene ${pagosDelQueEdito === 1 ? 'un pago' : `${pagosDelQueEdito} pagos`} registrado${pagosDelQueEdito === 1 ? '' : 's'}, que lo apuntan con su empresa y su moneda dentro. Para cambiarlas, archívalo y crea el nuevo.`
          }
          value={moneda}
          onChange={(e) => setMoneda(e.target.value)}
          required
          disabled={!puedeMudarse}
        >
          <option value="">Elige una moneda</option>
          <option value="PEN">PEN</option>
          <option value="USD">USD</option>
        </Selector>

        {sinCuentaPosible && (
          <Aviso tipo="atencion">
            {nombreEntidad} no tiene ninguna cuenta en {moneda}. Puedes guardarlo y entra en la
            proyección igual, pero no podrás registrar su pago: el dinero sale de una cuenta
            concreta y no cruza de una empresa a otra. O creas esa cuenta en Configuración →
            Cuentas, o el gasto lo paga la empresa que sí la tiene.
          </Aviso>
        )}

        <Campo
          etiqueta="Importe"
          inputMode="decimal"
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          required
        />

        <Selector
          etiqueta="Cada cuánto"
          value={cadencia}
          onChange={(e) => setCadencia(e.target.value as Enums<'recurrence'>)}
        >
          {CADENCIAS.map((c) => (
            <option key={c} value={c}>
              {nombreCadencia(c)}
            </option>
          ))}
        </Selector>

        {cadencia !== 'weekly' && (
          <Campo
            etiqueta="Día del mes"
            ayuda="Opcional. Si lo dejas vacío se usa el día de la fecha de abajo. Un 31 se recorta al último día del mes que no lo tenga."
            inputMode="numeric"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
          />
        )}

        <Campo
          etiqueta="Desde"
          ayuda="La primera vez que se cobra. Antes de esta fecha no aparece en la proyección."
          type="date"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          required
        />

        {entidadId && (
          <Selector
            etiqueta="Sale de"
            ayuda="Opcional, y tiene que ser una cuenta de esa empresa y en esa moneda."
            value={cuentaId}
            onChange={(e) => setCuentaId(e.target.value)}
          >
            <option value="">Sin decidir</option>
            {cuentasDeLaEntidad.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.currency_code}
              </option>
            ))}
          </Selector>
        )}

        <Campo
          etiqueta="Nota"
          ayuda="Opcional. Para qué es, o cuándo toca revisarlo."
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />

        {guardar.error && <Aviso tipo="error">{mensajeDeError(guardar.error)}</Aviso>}

        <div className="flex gap-2">
          <Boton variante="primario" type="submit" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : editando ? 'Guardar cambios' : 'Añadir gasto fijo'}
          </Boton>
          {editando && (
            <Boton variante="sutil" type="button" onClick={limpiar}>
              Cancelar
            </Boton>
          )}
        </div>
      </Alta>
    </Seccion>
  );
}
