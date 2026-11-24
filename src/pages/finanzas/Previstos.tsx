import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeEscribirDinero, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { format, toDb } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import { asignadoPorCuota } from './cobrado';
import {
  enLista,
  explica,
  totalesPrevistos,
  type PrevistoEnBase,
} from './previsto';

/**
 * Lo que entra y sale una sola vez: un adelanto, un equipo pactado.
 *
 * Es la última cosa que la proyección de trece semanas no veía. No cabía en
 * nada de lo que ya había: no es una cuota de una cotización, no es un gasto
 * fijo que se repite, y no es una factura de proveedor porque no hay factura.
 *
 * Y es la pantalla de un **plan**, no de dinero. Mientras un previsto no
 * tenga movimiento, no toca el saldo: solo mueve la curva. El día que el
 * dinero sale o entra se registra aquí mismo, y entonces deja de proyectarse
 * porque ya está en el saldo.
 */
export default function Previstos() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const conDinero = puedeEscribirDinero(organizacion.rol);
  const recargar = useRecargar(['previstos', 'cuotas-esperadas', 'saldos', 'movimientos']);
  const hoy = new Date().toISOString().slice(0, 10);

  const [exito, setExito] = useState<string | null>(null);
  const [accion, setAccion] = useState<{ tipo: 'saldar' | 'quitar'; item: string } | null>(null);

  // El alta
  const [entidadId, setEntidadId] = useState(entidad?.id ?? '');
  const [direccion, setDireccion] = useState('out');
  const [etiqueta, setEtiqueta] = useState('');
  const [importe, setImporte] = useState('');
  const [moneda, setMoneda] = useState('');
  const [fecha, setFecha] = useState('');
  const [cuentaId, setCuentaId] = useState('');

  // El pago
  const [importePago, setImportePago] = useState('');
  const [fechaPago, setFechaPago] = useState(hoy);
  const [cuentaPago, setCuentaPago] = useState('');
  const [referencia, setReferencia] = useState('');

  const previstos = useQuery({
    queryKey: ['previstos', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      let q = requireSupabase()
        .from('payment_schedule_items')
        .select(
          'id, label, direction, due_date, amount, currency_code, status, quote_id, expected_cash_account_id, legal_entity_id',
        )
        .eq('organization_id', organizacion.id)
        .is('quote_id', null)
        .order('due_date');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      const filas = data ?? [];
      if (filas.length === 0) return { filas: [] as PrevistoEnBase[], asignado: new Map(), entidadDe: new Map<string, string>() };

      const asignado = await asignadoPorCuota(filas.map((f) => f.id));
      return {
        filas: filas as unknown as PrevistoEnBase[],
        asignado,
        entidadDe: new Map(filas.map((f) => [f.id, f.legal_entity_id])),
      };
    },
  });

  const cuentas = useQuery({
    queryKey: ['cuentas', organizacion.id, 'para-previstos'],
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

  const monedas = useQuery({
    queryKey: ['monedas', organizacion.id, 'habilitadas'],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('organization_currencies')
        .select('currency_code')
        .eq('organization_id', organizacion.id)
        .eq('is_enabled', true);
      if (error) throw error;
      return (data ?? []).map((m) => m.currency_code);
    },
  });

  const guardar = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('guardar_previsto', {
        p_entity: entidadId,
        p_direction: direccion,
        p_label: etiqueta.trim(),
        p_amount: Number(importe.replace(',', '.')),
        p_currency: moneda,
        p_due_date: fecha,
        ...(cuentaId ? { p_account: cuentaId } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(
        `«${etiqueta.trim()}» ya está en la proyección de trece semanas. Todavía no toca el saldo: eso pasa el día que registres el dinero.`,
      );
      setEtiqueta('');
      setImporte('');
      setFecha('');
      setCuentaId('');
      recargar();
    },
  });

  const saldar = useMutation({
    mutationFn: async (item: string) => {
      const { error } = await requireSupabase().rpc('saldar_previsto', {
        p_item: item,
        p_account: cuentaPago,
        p_amount: Number(importePago.replace(',', '.')),
        p_value_date: fechaPago,
        ...(referencia.trim() ? { p_external_ref: referencia.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAccion(null);
      setReferencia('');
      recargar();
    },
  });

  const quitar = useMutation({
    mutationFn: async (item: string) => {
      const { error } = await requireSupabase().rpc('quitar_previsto', { p_item: item });
      if (error) throw error;
    },
    onSuccess: () => {
      setAccion(null);
      recargar();
    },
  });

  if (!conDinero) {
    return (
      <Seccion
        titulo="Previstos"
        regla="Un cobro o un pago de una sola vez, con fecha, que no viene de una cotización ni de una factura."
      >
        <Vacio
          titulo="Esta sección es de finanzas"
          explicacion="Tu rol en esta organización es comercial. La proyección de caja y lo que la alimenta no te los enseña la base de datos."
          siguiente="Las cotizaciones y su cronograma de cobro sí son tuyos: están en Comercial."
        />
      </Seccion>
    );
  }

  const filas = enLista(previstos.data?.filas ?? [], previstos.data?.asignado ?? new Map(), hoy);
  const totales = totalesPrevistos(filas);
  const vivos = filas.filter((f) => !f.saldado);
  const cuentasPosibles = (cuentas.data ?? []).filter(
    (c) => c.legal_entity_id === entidadId && (!moneda || c.currency_code === moneda),
  );

  return (
    <Seccion
      titulo="Previstos"
      regla="Un cobro o un pago de una sola vez: un adelanto, un equipo pactado. Es un plan y no dinero, así que no toca el saldo; entra en la proyección de trece semanas y sale de ella el día que registras el movimiento. Lo que ya se registró deja de proyectarse, porque ya está en el saldo."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      {previstos.isPending && <Cargando que="lo previsto" />}
      {previstos.error && <Aviso tipo="error">{mensajeDeError(previstos.error)}</Aviso>}
      {saldar.error && <Aviso tipo="error">{mensajeDeError(saldar.error)}</Aviso>}
      {quitar.error && <Aviso tipo="error">{mensajeDeError(quitar.error)}</Aviso>}

      {totales.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {totales.map((t) => (
            <Tarjeta key={t.moneda} className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">{t.moneda}</h2>
                <Etiqueta>{t.cuantos === 1 ? '1 sin saldar' : `${t.cuantos} sin saldar`}</Etiqueta>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted">Por cobrar</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{format(t.entra)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted">Por pagar</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{format(t.sale)}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-subtle">
                No se restan entre sí: son dos cifras y cada una pasa en su semana.
              </p>
            </Tarjeta>
          ))}
        </div>
      )}

      {!previstos.isPending && filas.length === 0 && (
        <Vacio
          titulo="Todavía no hay nada previsto de una sola vez"
          explicacion="Mientras no haya, la proyección de trece semanas solo ve los cobros de las cotizaciones, los gastos fijos y las facturas de proveedor. Un adelanto pactado o un equipo que vas a comprar no están en ninguna de las tres, así que la curva no los cuenta."
          siguiente="Anota abajo el primero: basta un nombre, un importe y una fecha."
        />
      )}

      {filas.length > 0 && (
        <Lista>
          {filas.map((f) => {
            const suEmpresa =
              entidades.find((x) => x.id === previstos.data?.entidadDe.get(f.id))?.legal_name ??
              'Su empresa';
            return (
              <Fila
                key={f.id}
                principal={
                  <>
                    <span className="font-medium">{f.label}</span>
                    <Etiqueta tono={f.entra ? 'positivo' : 'neutro'}>
                      {f.entra ? 'entra' : 'sale'}
                    </Etiqueta>
                    {f.saldado ? (
                      <Etiqueta tono="positivo">saldado</Etiqueta>
                    ) : f.atraso > 0 ? (
                      <Etiqueta tono="atencion">
                        {`la fecha pasó hace ${f.atraso} ${f.atraso === 1 ? 'día' : 'días'}`}
                      </Etiqueta>
                    ) : null}
                  </>
                }
                secundario={
                  <>
                    {formatoFecha(f.fecha)} · {explica(f)}
                    {entidades.length > 1 ? ` · ${suEmpresa}` : ''}
                  </>
                }
                extremo={
                  f.saldado ? (
                    <span className="num text-sm text-muted">{format(f.previsto)}</span>
                  ) : (
                    <>
                      <span className="num text-sm font-medium">{format(f.pendiente)}</span>
                      <Boton
                        variante="primario"
                        onClick={() => {
                          setAccion({ tipo: 'saldar', item: f.id });
                          setImportePago(toDb(f.pendiente));
                          setCuentaPago(f.cuentaId ?? '');
                          setFechaPago(hoy);
                        }}
                      >
                        {f.entra ? 'Registrar cobro' : 'Registrar pago'}
                      </Boton>
                      <Boton onClick={() => setAccion({ tipo: 'quitar', item: f.id })}>Quitar</Boton>
                    </>
                  )
                }
              />
            );
          })}
        </Lista>
      )}

      {accion?.tipo === 'saldar' &&
        (() => {
          const fila = filas.find((f) => f.id === accion.item);
          if (!fila) return null;
          const suyas = (cuentas.data ?? []).filter(
            (c) =>
              c.legal_entity_id === previstos.data?.entidadDe.get(fila.id) &&
              c.currency_code === fila.moneda,
          );
          return (
            <Alta
              titulo={`${fila.entra ? 'Cobrar' : 'Pagar'} ${fila.label}`}
              onSubmit={() => saldar.mutate(accion.item)}
            >
              {suyas.length === 0 ? (
                <Aviso tipo="atencion">
                  No hay ninguna cuenta de esa empresa en {fila.moneda}, así que este previsto no
                  se puede saldar todavía: de una cuenta sale el dinero de su empresa y en su
                  moneda. Crea la cuenta en Configuración → Cuentas.
                </Aviso>
              ) : (
                <>
                  <Selector
                    etiqueta={fila.entra ? 'En qué cuenta entra' : 'De qué cuenta sale'}
                    value={cuentaPago}
                    onChange={(e) => setCuentaPago(e.target.value)}
                    required
                  >
                    <option value="">Elige una cuenta</option>
                    {suyas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.currency_code}
                      </option>
                    ))}
                  </Selector>
                  <Campo
                    etiqueta={`Cuánto ${fila.entra ? 'cobras' : 'pagas'}`}
                    ayuda={`Faltan ${format(fila.pendiente)}. Puedes poner menos y el resto sigue proyectándose; y más, porque un previsto es una estimación tuya y no un importe acordado.`}
                    inputMode="decimal"
                    value={importePago}
                    onChange={(e) => setImportePago(e.target.value)}
                    required
                  />
                  <Campo
                    etiqueta="Fecha"
                    type="date"
                    value={fechaPago}
                    onChange={(e) => setFechaPago(e.target.value)}
                    required
                  />
                  <Campo
                    etiqueta="Referencia del banco"
                    ayuda="Opcional. El número de operación, para conciliarlo después."
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Boton variante="primario" type="submit" disabled={saldar.isPending}>
                      {saldar.isPending ? 'Registrando…' : 'Registrar el movimiento'}
                    </Boton>
                    <Boton onClick={() => setAccion(null)}>Cancelar</Boton>
                  </div>
                </>
              )}
            </Alta>
          );
        })()}

      {accion?.tipo === 'quitar' && (
        <Alta titulo="Quitar este previsto" onSubmit={() => quitar.mutate(accion.item)}>
          <Aviso tipo="info">
            Esto sí se borra, y se puede porque todavía no es un hecho económico: no hay documento
            ni dinero detrás, solo una fila de la proyección. El rastro queda en la auditoría. Si
            ya tuviera un movimiento asignado, la base se negaría y te diría qué anular primero.
          </Aviso>
          <div className="flex gap-2">
            <Boton variante="peligro" type="submit" disabled={quitar.isPending}>
              {quitar.isPending ? 'Quitando…' : 'Quitarlo'}
            </Boton>
            <Boton onClick={() => setAccion(null)}>Cancelar</Boton>
          </div>
        </Alta>
      )}

      {/* ---------------------------------------------------------------- */}
      <Alta titulo="Anotar un previsto" exito={exito} onSubmit={() => guardar.mutate()}>
        <Selector
          etiqueta="De qué empresa"
          value={entidadId}
          onChange={(e) => {
            setEntidadId(e.target.value);
            setCuentaId('');
          }}
          required
        >
          <option value="">Elige una empresa</option>
          {entidades.map((x) => (
            <option key={x.id} value={x.id}>
              {x.legal_name}
            </option>
          ))}
        </Selector>

        <Selector
          etiqueta="Entra o sale"
          ayuda="Un adelanto que te van a pasar entra; un equipo que pactaste sale. Una vez anotado, el dinero tiene que ir en ese sentido: la base no deja saldar un cobro previsto con un pago."
          value={direccion}
          onChange={(e) => setDireccion(e.target.value)}
        >
          <option value="out">Sale · un pago previsto</option>
          <option value="in">Entra · un cobro previsto</option>
        </Selector>

        <Campo
          etiqueta="Qué es"
          ayuda="El nombre que vas a reconocer en la proyección dentro de dos meses."
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          required
        />

        <Selector
          etiqueta="Moneda"
          value={moneda}
          onChange={(e) => {
            setMoneda(e.target.value);
            setCuentaId('');
          }}
          required
        >
          <option value="">Elige una moneda</option>
          {(monedas.data ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Selector>

        <Campo
          etiqueta="Cuánto"
          inputMode="decimal"
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          required
        />

        <Campo
          etiqueta="Cuándo"
          ayuda="La semana en la que va a caer. Sin fecha no proyecta nada, así que es obligatoria."
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          required
        />

        {cuentasPosibles.length > 0 && (
          <Selector
            etiqueta="De qué cuenta esperas que salga o entre"
            ayuda="Opcional. Solo sirve para que el día que lo registres venga ya elegida."
            value={cuentaId}
            onChange={(e) => setCuentaId(e.target.value)}
          >
            <option value="">Todavía no lo sé</option>
            {cuentasPosibles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.currency_code}
              </option>
            ))}
          </Selector>
        )}

        {guardar.error && <Aviso tipo="error">{mensajeDeError(guardar.error)}</Aviso>}

        <div>
          <Boton variante="primario" type="submit" disabled={guardar.isPending}>
            {guardar.isPending ? 'Anotando…' : 'Anotar el previsto'}
          </Boton>
        </div>
      </Alta>

      <p className="max-w-prose text-xs text-subtle">
        {vivos.length > 0
          ? `Los ${vivos.length === 1 ? 'ese previsto sin saldar ya está' : `${vivos.length} previstos sin saldar ya están`} en la curva de Inicio, cada uno en su semana. Con esto la proyección ve las cuatro cosas que mueven tu caja: los cobros de las cotizaciones, los gastos fijos, las facturas de proveedor y esto.`
          : 'Con esta pantalla la proyección ya ve las cuatro cosas que mueven tu caja: los cobros de las cotizaciones, los gastos fijos, las facturas de proveedor y los previstos de una sola vez.'}{' '}
        Lo que todavía no hace: repetir uno —para eso están los gastos fijos— ni atarlo a un
        trabajo, porque un previsto no tiene factura y el costo de un trabajo se cuenta por la
        factura.
      </p>
    </Seccion>
  );
}
