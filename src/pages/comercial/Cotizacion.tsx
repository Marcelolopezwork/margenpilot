import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeVerCostos, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoTasa } from '../../lib/format';
import {
  add,
  currencyOf,
  format,
  fromRow,
  marginPercent,
  markupPercent,
  multiplyByQuantity,
  subtract,
  sumLines,
  taxOn,
  zero,
} from '../../lib/money';
import type { CurrencyCode, Money } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Constants } from '../../types/database';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta } from '../../components/ui';
import { useRecargar } from '../../components/recargar';
import LineaCostos from './LineaCostos';
import type { Costo } from './LineaCostos';
import { ESTADOS } from './estados';

type Linea = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  fee_pct: number | null;
  sort: number;
};

export default function Cotizacion() {
  const { id = '' } = useParams();
  const { organizacion } = useOrgElegida();
  const { entidades } = useOrg();
  const conCostos = puedeVerCostos(organizacion.rol);
  const recargar = useRecargar(['cotizacion', 'cotizaciones']);

  const [abierta, setAbierta] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [editCant, setEditCant] = useState('');
  const [editPrecio, setEditPrecio] = useState('');

  const [servicioId, setServicioId] = useState('');
  const [cantServicio, setCantServicio] = useState('1');
  const [desc, setDesc] = useState('');
  const [cant, setCant] = useState('1');
  const [precio, setPrecio] = useState('');

  const cabecera = useQuery({
    queryKey: ['cotizacion', id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quotes')
        .select(
          'id, number, status, currency_code, tax_rate_pct, tax_label, valid_until, notes, legal_entity_id, client_id',
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const servicios = useQuery({
    queryKey: ['servicios', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('services')
        .select('id, code, name, default_fee_pct, is_active')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });

  const lineas = useQuery({
    queryKey: ['cotizacion', id, 'lineas'],
    queryFn: async (): Promise<Linea[]> => {
      const { data, error } = await requireSupabase()
        .from('quote_lines')
        .select('id, description, quantity, unit_price, fee_pct, sort')
        .eq('quote_id', id)
        .eq('is_active', true)
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  const costos = useQuery({
    queryKey: ['cotizacion', id, 'costos'],
    enabled: conCostos,
    queryFn: async (): Promise<Costo[]> => {
      const { data, error } = await requireSupabase()
        .from('quote_line_costs')
        .select('id, quote_line_id, label, cost_item_id, quantity, unit_cost, unit')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  const cliente = useQuery({
    queryKey: ['cliente', cabecera.data?.client_id],
    enabled: Boolean(cabecera.data?.client_id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('clients')
        .select('name, tax_id')
        .eq('id', cabecera.data?.client_id as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  /** El camino principal: la ficha trae su descripción, sus costos y su fee. */
  const lineaDesdeServicio = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('add_quote_line_from_service', {
        p_quote: id,
        p_service: servicioId,
        p_quantity: Number(cantServicio.replace(',', '.')),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setServicioId('');
      setCantServicio('1');
      recargar();
    },
  });

  const lineaAMano = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('quote_lines')
        .insert({
          organization_id: organizacion.id,
          quote_id: id,
          description: desc.trim(),
          quantity: Number(cant.replace(',', '.')),
          unit_price: Number(precio.replace(',', '.')),
          sort: (lineas.data?.length ?? 0) * 10 + 10,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      setDesc('');
      setCant('1');
      setPrecio('');
      recargar();
    },
  });

  /** No se borra: se desactiva. La fila y su rastro de auditoría se quedan. */
  const quitarLinea = useMutation({
    mutationFn: async (lineaId: string) => {
      const { error } = await requireSupabase()
        .from('quote_lines')
        .update({ is_active: false })
        .eq('id', lineaId);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const guardarLinea = useMutation({
    mutationFn: async (lineaId: string) => {
      const { error } = await requireSupabase()
        .from('quote_lines')
        .update({
          quantity: Number(editCant.replace(',', '.')),
          unit_price: Number(editPrecio.replace(',', '.')),
          // Escribir el precio a mano desengancha la línea del fee.
          fee_pct: null,
        })
        .eq('id', lineaId);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditando(null);
      recargar();
    },
  });

  const cambiarFee = useMutation({
    mutationFn: async ({ lineaId, fee }: { lineaId: string; fee: number | null }) => {
      const supabase = requireSupabase();
      const up = await supabase.from('quote_lines').update({ fee_pct: fee }).eq('id', lineaId);
      if (up.error) throw up.error;
      const re = await supabase.rpc('recalc_quote_line_price', { p_line: lineaId });
      if (re.error) throw re.error;
    },
    onSuccess: recargar,
  });

  /** Tras tocar los costos, el precio derivado deja de cuadrar. */
  const recalcular = useMutation({
    mutationFn: async (lineaId: string) => {
      const { error } = await requireSupabase().rpc('recalc_quote_line_price', {
        p_line: lineaId,
      });
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const cambiarEstado = useMutation({
    mutationFn: async (estado: Enums<'quote_status'>) => {
      const { error } = await requireSupabase()
        .from('quotes')
        .update({ status: estado })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  if (cabecera.isPending) return <Cargando que="la cotización" />;
  if (cabecera.error) return <Aviso tipo="error">{mensajeDeError(cabecera.error)}</Aviso>;

  const q = cabecera.data;
  const moneda: CurrencyCode = currencyOf(q.currency_code);
  const filas = lineas.data ?? [];

  // R-4.2: se redondea al cerrar cada línea y el total es la suma de líneas ya
  // redondeadas. R-4.3: el impuesto va sobre el neto ya redondeado de la línea.
  const netoDe = (l: Linea): Money =>
    multiplyByQuantity(fromRow(l.unit_price, moneda), String(l.quantity));
  const costosDe = (lineaId: string) =>
    (costos.data ?? []).filter((c) => c.quote_line_id === lineaId);
  const costoDe = (l: Linea): Money =>
    multiplyByQuantity(
      sumLines(
        costosDe(l.id).map((c) =>
          multiplyByQuantity(fromRow(c.unit_cost, moneda), String(c.quantity)),
        ),
        moneda,
      ),
      String(l.quantity),
    );

  const neto = sumLines(filas.map(netoDe), moneda);
  const impuesto = sumLines(
    filas.map((l) => taxOn(netoDe(l), String(q.tax_rate_pct))),
    moneda,
  );
  const total = add(neto, impuesto);
  const costo = conCostos ? sumLines(filas.map(costoDe), moneda) : zero(moneda);
  const utilidad = subtract(neto, costo);
  const margen = marginPercent(neto, costo);
  const markup = markupPercent(neto, costo);

  const entidad = entidades.find((e) => e.id === q.legal_entity_id);
  const fichas = servicios.data ?? [];

  function empezarEdicion(l: Linea) {
    setEditando(l.id);
    setEditCant(String(l.quantity));
    setEditPrecio(String(l.unit_price));
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/comercial/cotizaciones" className="text-sm text-muted underline">
            ← Cotizaciones
          </Link>
          <h1 className="num mt-1 text-xl font-semibold tracking-tight">{q.number}</h1>
          <p className="mt-1 text-sm text-muted">
            {cliente.data?.name ?? '…'} · {entidad?.legal_name ?? '…'} · {q.currency_code}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Etiqueta tono={q.status === 'approved' ? 'positivo' : 'neutro'}>
            {ESTADOS[q.status]}
          </Etiqueta>
          <Selector
            etiqueta="Estado"
            value={q.status}
            onChange={(e) => cambiarEstado.mutate(e.target.value as Enums<'quote_status'>)}
          >
            {Constants.public.Enums.quote_status.map((s) => (
              <option key={s} value={s}>
                {ESTADOS[s]}
              </option>
            ))}
          </Selector>
        </div>
      </header>

      {cambiarEstado.error && <Aviso tipo="error">{mensajeDeError(cambiarEstado.error)}</Aviso>}
      {quitarLinea.error && <Aviso tipo="error">{mensajeDeError(quitarLinea.error)}</Aviso>}
      {recalcular.error && <Aviso tipo="error">{mensajeDeError(recalcular.error)}</Aviso>}
      {cambiarFee.error && <Aviso tipo="error">{mensajeDeError(cambiarFee.error)}</Aviso>}

      <Tarjeta className="p-5">
        <h2 className="mb-3 font-medium">Líneas</h2>

        {lineas.isPending && <Cargando que="las líneas" />}
        {filas.length === 0 && !lineas.isPending && (
          <p className="text-sm text-muted">
            Todavía no hay líneas. Elige una ficha de servicio abajo: llegan sus costos y el
            precio sale solo del fee.
          </p>
        )}

        {filas.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {filas.map((l) => {
              const net = netoDe(l);
              const cost = costoDe(l);
              const m = marginPercent(net, cost);
              const mk = markupPercent(net, cost);
              const derivada = l.fee_pct !== null;
              return (
                <li key={l.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{l.description}</span>
                    <span className="num">{format(net)}</span>
                  </div>

                  {editando === l.id ? (
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <Campo
                        etiqueta="Cantidad"
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={editCant}
                        onChange={(e) => setEditCant(e.target.value)}
                      />
                      <Campo
                        etiqueta={`Precio unitario (${q.currency_code})`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={editPrecio}
                        onChange={(e) => setEditPrecio(e.target.value)}
                        ayuda="Escribirlo a mano desengancha la línea del fee."
                      />
                      <Boton
                        variante="primario"
                        disabled={guardarLinea.isPending}
                        onClick={() => guardarLinea.mutate(l.id)}
                      >
                        Guardar
                      </Boton>
                      <Boton variante="sutil" onClick={() => setEditando(null)}>
                        Cancelar
                      </Boton>
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <span className="num text-sm text-muted">
                        {String(l.quantity)} × {format(fromRow(l.unit_price, moneda))}
                      </span>
                      <Boton
                        variante="sutil"
                        className="min-h-0 px-2 py-1 text-xs"
                        onClick={() => empezarEdicion(l)}
                      >
                        Editar
                      </Boton>
                      <Boton
                        variante="sutil"
                        className="min-h-0 px-2 py-1 text-xs"
                        disabled={quitarLinea.isPending}
                        onClick={() => quitarLinea.mutate(l.id)}
                      >
                        Quitar
                      </Boton>
                    </div>
                  )}

                  {guardarLinea.error && editando === l.id && (
                    <Aviso tipo="error">{mensajeDeError(guardarLinea.error)}</Aviso>
                  )}

                  {conCostos && (
                    <>
                      {/* La economía de la línea, siempre a la vista. Esconderla
                          detrás de un clic es esconder lo único que importa. */}
                      <div className="num mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <span className="text-muted">costo {format(cost)}</span>

                        {derivada ? (
                          <label className="flex items-center gap-1 text-muted">
                            fee
                            <input
                              type="number"
                              step="1"
                              min="0"
                              defaultValue={String(l.fee_pct)}
                              onBlur={(e) =>
                                cambiarFee.mutate({
                                  lineaId: l.id,
                                  fee: Number(e.target.value.replace(',', '.')),
                                })
                              }
                              aria-label={`Fee de ${l.description}`}
                              className="w-16 rounded-control border border-border bg-surface px-2 py-0.5 text-text"
                            />
                            %
                          </label>
                        ) : (
                          <span className="text-muted">precio a mano</span>
                        )}

                        <span className="font-medium">
                          margen {m === null ? '—' : `${m.toFixed(1)} %`}
                        </span>
                        <span className="text-muted">
                          markup {mk === null ? '—' : `${mk.toFixed(1)} %`}
                        </span>

                        {!derivada && (
                          <Boton
                            variante="sutil"
                            className="min-h-0 px-2 py-1 text-xs"
                            disabled={cambiarFee.isPending}
                            onClick={() => cambiarFee.mutate({ lineaId: l.id, fee: 80 })}
                          >
                            Derivar del costo
                          </Boton>
                        )}
                      </div>

                      <Boton
                        variante="sutil"
                        onClick={() => setAbierta(abierta === l.id ? null : l.id)}
                        aria-expanded={abierta === l.id}
                        className="min-h-0 px-0 py-1 text-xs"
                      >
                        {abierta === l.id ? '▾' : '▸'} {costosDe(l.id).length} conceptos de costo
                      </Boton>

                      {abierta === l.id && (
                        <LineaCostos
                          lineaId={l.id}
                          organizacionId={organizacion.id}
                          moneda={moneda}
                          costos={costosDe(l.id)}
                          alCambiar={() => recalcular.mutate(l.id)}
                        />
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ---------- Alta desde una ficha: el camino principal ---------- */}
        <form
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            lineaDesdeServicio.mutate();
          }}
        >
          <h3 className="text-sm font-medium">Añadir desde el catálogo</h3>

          {fichas.length === 0 ? (
            <Aviso tipo="atencion">
              No hay fichas de servicio todavía. Créalas en Catálogo → Servicios y ponles su
              composición de costos: entonces una cotización se arma en dos clics.
            </Aviso>
          ) : (
            <>
              <Selector
                etiqueta="Ficha de servicio"
                value={servicioId}
                onChange={(e) => setServicioId(e.target.value)}
                ayuda="Trae su nombre, sus costos y su fee. Todo editable después."
              >
                <option value="">Elige una ficha</option>
                {fichas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name} · fee {s.default_fee_pct} %
                  </option>
                ))}
              </Selector>

              <Campo
                etiqueta="Cantidad"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={cantServicio}
                onChange={(e) => setCantServicio(e.target.value)}
                required
              />

              {lineaDesdeServicio.error && (
                <Aviso tipo="error">{mensajeDeError(lineaDesdeServicio.error)}</Aviso>
              )}

              <Boton
                type="submit"
                variante="primario"
                disabled={lineaDesdeServicio.isPending || !servicioId}
              >
                {lineaDesdeServicio.isPending ? 'Añadiendo…' : 'Añadir desde la ficha'}
              </Boton>
            </>
          )}
        </form>

        {/* ---------- Alta a mano, para lo que no está en catálogo ---------- */}
        <details className="mt-4 border-t border-border pt-4">
          <summary className="cursor-pointer text-sm text-muted">
            O escribir una línea a mano
          </summary>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              lineaAMano.mutate();
            }}
          >
            <Campo
              etiqueta="Qué incluye esta línea"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={300}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Cantidad"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={cant}
                onChange={(e) => setCant(e.target.value)}
              />
              <Campo
                etiqueta={`Precio unitario (${q.currency_code})`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                ayuda="Sin costos cargados, el margen de esta línea saldrá 100 %."
              />
            </div>

            {lineaAMano.error && <Aviso tipo="error">{mensajeDeError(lineaAMano.error)}</Aviso>}

            <Boton
              type="submit"
              variante="secundario"
              disabled={lineaAMano.isPending || !desc.trim() || precio.trim() === ''}
            >
              {lineaAMano.isPending ? 'Añadiendo…' : 'Añadir línea a mano'}
            </Boton>
          </form>
        </details>
      </Tarjeta>

      <Tarjeta className="p-5">
        <h2 className="mb-3 font-medium">Totales</h2>
        <dl className="num flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Neto</dt>
            <dd>{format(neto)}</dd>
          </div>
          {Number(q.tax_rate_pct) > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">
                {q.tax_label ?? 'Impuesto'} {formatoTasa(q.tax_rate_pct)}
              </dt>
              <dd>{format(impuesto)}</dd>
            </div>
          ) : (
            <div className="flex justify-between">
              <dt className="text-muted">Sin impuesto</dt>
              <dd className="text-muted">—</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 font-medium">
            <dt>Total</dt>
            <dd>{format(total, { showCode: true })}</dd>
          </div>
        </dl>

        {conCostos && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-xs uppercase tracking-widest text-subtle">Solo finanzas</p>
            <dl className="num flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Costo directo</dt>
                <dd>{format(costo)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Utilidad</dt>
                <dd>{format(utilidad)}</dd>
              </div>
              <div className="flex justify-between font-medium">
                <dt>Margen sobre precio</dt>
                <dd>{margen === null ? '—' : `${margen.toFixed(1)} %`}</dd>
              </div>
              <div className="flex justify-between text-muted">
                <dt>Markup sobre costo</dt>
                <dd>{markup === null ? '—' : `${markup.toFixed(1)} %`}</dd>
              </div>
            </dl>
            <p className="mt-3 max-w-prose text-xs text-subtle">
              El fee que pones es el markup: lo que le sumas al costo. El margen es otra cifra, la
              que de verdad te queda sobre lo que cobras. Con costo 100 y fee 80 %, el precio es
              180, el markup 80 % y el margen 44,4 %.
            </p>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
