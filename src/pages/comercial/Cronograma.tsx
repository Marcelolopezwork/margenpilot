import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Aviso, Boton, Cargando, Tarjeta } from '../../components/ui';
import { mensajeDeError } from '../../lib/errors';
import { format, fromRow, subtract, toDb, zero } from '../../lib/money';
import type { CurrencyCode, Money } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { diferencia, estaCongelada, hoyIso, reparto, sumaDe } from './cuotas';
import type { EstadoCuota, FilaCuota } from './cuotas';
import type { Estado } from './estados';
import { cobradoPorDocumento } from '../finanzas/cobrado';
import { TIPOS_DE_VENTA, nombreTipoDocumento } from '../finanzas/cartera';
import type { Enums } from '../../types/database';

/**
 * El cronograma de cobro de una cotización aprobada.
 *
 * Es la bisagra entre el cotizador y las finanzas: hasta aquí el producto
 * sabía cuánto se ofertó, y a partir de aquí sabe cuándo se espera el dinero.
 *
 * Lo que esta pantalla tiene que dejar claro, porque es la confusión que
 * arruina una proyección, es que **una cuota prevista no es una factura**.
 * Entra en el flujo de caja de las próximas semanas y no entra en «Por
 * cobrar»: en servicios se pacta el cobro mucho antes de facturar.
 *
 * El cronograma se manda entero y no cuota por cuota. Mientras se edita puede
 * no cuadrar, y no pasa nada; al guardar, o suma el total de la versión
 * aprobada o no se guarda nada. Eso lo decide la base, no este botón.
 */
export default function Cronograma({
  cotizacion,
  estado,
  moneda,
  entidad,
  puedeEditar,
}: {
  cotizacion: string;
  estado: Estado;
  moneda: CurrencyCode;
  entidad: string;
  puedeEditar: boolean;
}) {
  const cliente = useQueryClient();
  const [borrador, setBorrador] = useState<FilaCuota[] | null>(null);

  // Qué se está haciendo con una cuota: nada, emitir su documento, o
  // registrar un cobro. Una sola a la vez, porque son acciones que mueven
  // dinero y abrir dos formularios invita a confundirlas.
  const [accion, setAccion] = useState<{ tipo: 'emitir' | 'cobrar'; cuota: string } | null>(null);
  const [tipoDoc, setTipoDoc] = useState<Enums<'document_type'>>('invoice');
  const [serie, setSerie] = useState('');
  const [fechaEmision, setFechaEmision] = useState(hoyIso());
  const [cuentaCobro, setCuentaCobro] = useState('');
  const [importeCobro, setImporteCobro] = useState('');
  const [fechaCobro, setFechaCobro] = useState(hoyIso());
  const [refCobro, setRefCobro] = useState('');

  const cuotas = useQuery({
    queryKey: ['cotizacion', cotizacion, 'cronograma'],
    enabled: estado === 'approved',
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('payment_schedule_items')
        .select(
          'id, label, due_date, amount, expected_cash_account_id, status, sort, billing_document_id',
        )
        .eq('quote_id', cotizacion)
        .order('due_date')
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  // El total que hay que repartir es el de la versión aprobada, no el de la
  // cotización de hoy. Hoy son lo mismo —una aprobada no se reemite— pero la
  // cifra que el cliente aceptó es la de la versión.
  const version = useQuery({
    queryKey: ['cotizacion', cotizacion, 'version-vigente'],
    enabled: estado === 'approved',
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quote_versions')
        .select('version_no, totals')
        .eq('quote_id', cotizacion)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const cuentas = useQuery({
    queryKey: ['cuentas', entidad, moneda],
    enabled: estado === 'approved' && puedeEditar,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('cash_accounts')
        .select('id, name, bank_name')
        .eq('legal_entity_id', entidad)
        .eq('currency_code', moneda)
        .eq('is_active', true)
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Lo cobrado de cada documento de este cronograma, para saber cuánto queda.
  // Depende de las cuotas, así que se declara después y se activa sola.
  const documentos = useQuery({
    queryKey: [
      'cotizacion',
      cotizacion,
      'cobrado',
      (cuotas.data ?? []).map((c) => c.billing_document_id ?? '').join(','),
    ],
    enabled: estado === 'approved' && puedeEditar,
    queryFn: async () => {
      const ids = (cuotas.data ?? [])
        .map((c) => c.billing_document_id)
        .filter((id): id is string => id !== null);
      return cobradoPorDocumento(ids);
    },
  });

  function cerrar() {
    setAccion(null);
    setSerie('');
    setRefCobro('');
    setImporteCobro('');
  }

  function alCambiarElDinero() {
    cerrar();
    void cliente.invalidateQueries({ queryKey: ['cotizacion', cotizacion] });
    // Finanzas mira las mismas filas desde el otro lado: si no se invalida,
    // el saldo de la cuenta se queda con la cifra de antes del cobro.
    void cliente.invalidateQueries({ queryKey: ['saldos'] });
    void cliente.invalidateQueries({ queryKey: ['cartera'] });
    void cliente.invalidateQueries({ queryKey: ['movimientos'] });
  }

  const emitir = useMutation({
    mutationFn: async (cuota: string) => {
      const { error } = await requireSupabase().rpc('emitir_documento', {
        p_item: cuota,
        p_doc_type: tipoDoc,
        p_issue_date: fechaEmision,
        ...(serie.trim() ? { p_series: serie.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: alCambiarElDinero,
  });

  const cobrar = useMutation({
    mutationFn: async ({ documento }: { documento: string }) => {
      const { error } = await requireSupabase().rpc('registrar_cobro', {
        p_document: documento,
        p_account: cuentaCobro,
        p_amount: Number(importeCobro.replace(',', '.')),
        p_value_date: fechaCobro,
        ...(refCobro.trim() ? { p_external_ref: refCobro.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: alCambiarElDinero,
  });

  const guardar = useMutation({
    mutationFn: async (filas: FilaCuota[]) => {
      const { error } = await requireSupabase().rpc('guardar_cronograma', {
        p_quote: cotizacion,
        p_items: filas
          .filter((f) => !estaCongelada(f.status))
          .map((f) => ({
            label: f.label.trim(),
            due_date: f.due_date,
            amount: f.amount.trim(),
            cash_account_id: f.cash_account_id,
          })),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBorrador(null);
      void cliente.invalidateQueries({ queryKey: ['cotizacion', cotizacion] });
    },
  });

  if (estado !== 'approved') return null;
  if (cuotas.isPending || version.isPending) return <Cargando que="el cronograma de cobro" />;

  const guardadas: FilaCuota[] = (cuotas.data ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    due_date: c.due_date,
    amount: String(c.amount),
    cash_account_id: c.expected_cash_account_id ?? '',
    status: c.status as EstadoCuota,
  }));

  const filas = borrador ?? guardadas;
  const congeladas = filas.filter((f) => estaCongelada(f.status));
  const editables = filas.filter((f) => !estaCongelada(f.status));

  const totalVersion: Money | null = leerTotal(version.data?.totals, moneda);
  const suma = sumaDe(filas, moneda);
  const falta = totalVersion && suma ? diferencia(suma, totalVersion) : null;
  const cuadra = falta !== null && falta.minor === 0n;
  const sinRepartir =
    totalVersion === null
      ? null
      : subtract(
          totalVersion,
          sumaDe(congeladas, moneda) ?? zero(moneda),
        );

  function cambiar(indice: number, campo: keyof FilaCuota, valor: string) {
    const copia = filas.map((f) => ({ ...f }));
    const fila = copia[indice];
    if (!fila || estaCongelada(fila.status)) return;
    if (campo === 'id' || campo === 'status') return;
    fila[campo] = valor;
    setBorrador(copia);
  }

  function quitar(indice: number) {
    const copia = filas.filter((_, i) => i !== indice);
    setBorrador(copia);
  }

  function anadir() {
    const ultima = editables[editables.length - 1];
    setBorrador([
      ...filas,
      {
        id: null,
        label: `Cuota ${editables.length + congeladas.length + 1}`,
        due_date: ultima?.due_date ?? hoyIso(),
        amount: '0',
        cash_account_id: ultima?.cash_account_id ?? '',
        status: 'planned',
      },
    ]);
  }

  function repartirEn(partes: number) {
    if (!sinRepartir || sinRepartir.minor <= 0n) return;
    setBorrador([...congeladas, ...reparto(sinRepartir, partes, hoyIso(), congeladas)]);
  }

  const nombreCuenta = (id: string) =>
    (cuentas.data ?? []).find((c) => c.id === id)?.name ?? '—';

  const documentoDe = (cuota: string): string | null =>
    (cuotas.data ?? []).find((c) => c.id === cuota)?.billing_document_id ?? null;

  /** Lo que queda por cobrar de la cuota, que es lo que el cobro prellena. */
  function pendienteDeLaCuota(fila: FilaCuota): Money | null {
    if (!fila.id) return null;
    const doc = documentoDe(fila.id);
    let total: Money;
    try {
      total = fromRow(fila.amount, moneda);
    } catch {
      return null;
    }
    const cobrado = doc ? documentos.data?.get(doc) : undefined;
    return cobrado ? subtract(total, cobrado) : total;
  }

  function abrirEmision(fila: FilaCuota) {
    if (!fila.id) return;
    setTipoDoc('invoice');
    setSerie('');
    setFechaEmision(hoyIso());
    setAccion({ tipo: 'emitir', cuota: fila.id });
  }

  function abrirCobro(fila: FilaCuota) {
    if (!fila.id) return;
    const queda = pendienteDeLaCuota(fila);
    setCuentaCobro(fila.cash_account_id || ((cuentas.data ?? [])[0]?.id ?? ''));
    setImporteCobro(queda ? toDb(queda) : fila.amount);
    setFechaCobro(hoyIso());
    setRefCobro('');
    setAccion({ tipo: 'cobrar', cuota: fila.id });
  }

  const cuotaDeLaAccion = accion ? filas.find((f) => f.id === accion.cuota) : undefined;

  return (
    <Tarjeta className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Cronograma de cobro</h2>
          <p className="mt-1 max-w-xl text-xs text-subtle">
            Reparte el total aceptado en las fechas en que esperas el dinero. Una cuota
            prevista entra en la proyección de caja y <strong>no</strong> en «Por cobrar»:
            es una expectativa, no una factura.
          </p>
        </div>
        {totalVersion && (
          <p className="text-right text-xs text-subtle">
            Total de la v{version.data?.version_no}
            <span className="num mt-0.5 block text-base font-semibold text-text">
              {format(totalVersion)}
            </span>
          </p>
        )}
      </div>

      {!puedeEditar && (
        <div className="mt-3">
          <Aviso tipo="info">
            Tu rol ve el cronograma pero no lo arma. Lo cambia quien lleva las finanzas.
          </Aviso>
        </div>
      )}

      {puedeEditar && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Repartir en</span>
          {[1, 2, 3].map((n) => (
            <Boton
              key={n}
              variante="secundario"
              className="min-h-0 px-3 py-2 text-xs"
              onClick={() => repartirEn(n)}
              disabled={!sinRepartir || sinRepartir.minor <= 0n}
            >
              {n === 1 ? 'Pago único' : n === 2 ? '50 / 50' : '3 cuotas'}
            </Boton>
          ))}
          <Boton
            variante="sutil"
            className="min-h-0 px-3 py-2 text-xs"
            onClick={anadir}
          >
            + Añadir cuota
          </Boton>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-subtle">
              <th scope="col" className="pb-2 font-normal">Concepto</th>
              <th scope="col" className="pb-2 font-normal">Vence</th>
              <th scope="col" className="pb-2 text-right font-normal">Importe</th>
              {/* Las cuentas de la empresa solo las ve quien escribe dinero: la
                  política de `cash_accounts` no se las enseña al rol comercial,
                  así que la columna tampoco. */}
              {puedeEditar && <th scope="col" className="pb-2 font-normal">Entra en</th>}
              <th scope="col" className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filas.map((f, i) => {
              const fija = estaCongelada(f.status);
              return (
                <tr key={f.id ?? `nueva-${i}`}>
                  <td className="py-2 pr-2">
                    {fija || !puedeEditar ? (
                      <span>{f.label}</span>
                    ) : (
                      <input
                        aria-label={`Concepto de la cuota ${i + 1}`}
                        value={f.label}
                        onChange={(e) => cambiar(i, 'label', e.target.value)}
                        placeholder="Anticipo 50 %"
                        className="min-h-11 w-full rounded-control border border-border bg-surface px-2 text-sm"
                      />
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    {fija || !puedeEditar ? (
                      <span className="num text-xs">{f.due_date}</span>
                    ) : (
                      <input
                        type="date"
                        aria-label={`Fecha de la cuota ${i + 1}`}
                        value={f.due_date}
                        onChange={(e) => cambiar(i, 'due_date', e.target.value)}
                        className="num min-h-11 rounded-control border border-border bg-surface px-2 text-sm"
                      />
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {fija || !puedeEditar ? (
                      <span className="num">{importeLegible(f.amount, moneda)}</span>
                    ) : (
                      <input
                        inputMode="decimal"
                        aria-label={`Importe de la cuota ${i + 1}`}
                        value={f.amount}
                        onChange={(e) => cambiar(i, 'amount', e.target.value)}
                        className="num min-h-11 w-28 rounded-control border border-border bg-surface px-2 text-right text-sm"
                      />
                    )}
                  </td>
                  {puedeEditar && (
                    <td className="py-2 pr-2">
                      {fija ? (
                        <span className="text-xs text-muted">
                          {f.cash_account_id ? nombreCuenta(f.cash_account_id) : '—'}
                        </span>
                      ) : (
                        <select
                          aria-label={`Cuenta de destino de la cuota ${i + 1}`}
                          value={f.cash_account_id}
                          onChange={(e) => cambiar(i, 'cash_account_id', e.target.value)}
                          className="min-h-11 rounded-control border border-border bg-surface px-2 text-sm"
                        >
                          <option value="">Sin decidir</option>
                          {(cuentas.data ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  )}
                  <td className="py-2 text-right">
                    {f.status === 'settled' ? (
                      <span className="text-xs text-positive">cobrada</span>
                    ) : f.status === 'documented' ? (
                      puedeEditar && f.id ? (
                        <Boton
                          variante="secundario"
                          className="min-h-0 px-2 py-1 text-xs"
                          onClick={() => abrirCobro(f)}
                        >
                          Cobrar
                        </Boton>
                      ) : (
                        <span className="text-xs text-subtle">documentada</span>
                      )
                    ) : f.status === 'cancelled' ? (
                      <span className="text-xs text-subtle">cancelada</span>
                    ) : (
                      puedeEditar && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {/* Emitir pide que la cuota esté guardada: emitir un
                              documento por una cifra que solo existe en la
                              pantalla sería emitirlo por otra cantidad. */}
                          {f.id && (
                            <Boton
                              variante="secundario"
                              className="min-h-0 px-2 py-1 text-xs"
                              onClick={() => abrirEmision(f)}
                              disabled={borrador !== null}
                              title={
                                borrador !== null
                                  ? 'Guarda el cronograma antes de emitir: el documento se emite por el importe guardado.'
                                  : undefined
                              }
                            >
                              Emitir
                            </Boton>
                          )}
                          <Boton
                            variante="sutil"
                            className="min-h-0 px-2 py-1 text-xs"
                            onClick={() => quitar(i)}
                          >
                            Quitar
                          </Boton>
                        </div>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={puedeEditar ? 5 : 4} className="py-4 text-xs text-subtle">
                  Todavía no hay cuotas. Reparte el total con uno de los botones de arriba.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {accion && cuotaDeLaAccion && (
        <div className="mt-4 rounded-card border border-border bg-canvas p-4">
          {accion.tipo === 'emitir' ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                emitir.mutate(accion.cuota);
              }}
            >
              <div>
                <h3 className="text-sm font-semibold">
                  Emitir el documento de «{cuotaDeLaAccion.label}»
                </h3>
                <p className="mt-1 max-w-xl text-xs text-subtle">
                  Por {importeLegible(cuotaDeLaAccion.amount, moneda)}, el importe exacto de la
                  cuota. A partir de aquí entra en «Por cobrar» y el cliente te lo debe. El neto y
                  el impuesto los parte la base con la tasa de esta cotización.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-xs text-subtle">
                  Tipo
                  <select
                    value={tipoDoc}
                    onChange={(e) => setTipoDoc(e.target.value as Enums<'document_type'>)}
                    className="min-h-11 rounded-control border border-border bg-surface px-2 text-sm text-text"
                  >
                    {TIPOS_DE_VENTA.map((t) => (
                      <option key={t} value={t}>
                        {nombreTipoDocumento(t)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-subtle">
                  Serie y número
                  <input
                    value={serie}
                    onChange={(e) => setSerie(e.target.value)}
                    placeholder="F001-00000123"
                    className="num min-h-11 rounded-control border border-border bg-surface px-2 text-sm text-text"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-subtle">
                  Fecha de emisión
                  <input
                    type="date"
                    value={fechaEmision}
                    onChange={(e) => setFechaEmision(e.target.value)}
                    className="num min-h-11 rounded-control border border-border bg-surface px-2 text-sm text-text"
                  />
                </label>
              </div>

              <p className="max-w-xl text-xs text-subtle">
                El número lo copias del comprobante que ya emitiste en tu sistema de facturación.
                Puede quedar vacío: aquí no se inventa, porque en Perú lo asigna SUNAT y un número
                inventado en la cartera es peor que ninguno.
              </p>

              {emitir.error && <Aviso tipo="error">{mensajeDeError(emitir.error)}</Aviso>}

              <div className="flex gap-2">
                <Boton variante="primario" type="submit" disabled={emitir.isPending}>
                  {emitir.isPending ? 'Emitiendo…' : 'Emitir documento'}
                </Boton>
                <Boton variante="sutil" type="button" onClick={cerrar}>
                  Cancelar
                </Boton>
              </div>
            </form>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const doc = documentoDe(accion.cuota);
                if (doc) cobrar.mutate({ documento: doc });
              }}
            >
              <div>
                <h3 className="text-sm font-semibold">
                  Registrar el cobro de «{cuotaDeLaAccion.label}»
                </h3>
                <p className="mt-1 max-w-xl text-xs text-subtle">
                  Esto crea el movimiento en la cuenta y lo ata al documento. Puede ser parcial: si
                  cobras la mitad, el documento queda cobrado a medias y la cuota sigue en cartera.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-xs text-subtle">
                  Entra en
                  <select
                    value={cuentaCobro}
                    onChange={(e) => setCuentaCobro(e.target.value)}
                    required
                    className="min-h-11 rounded-control border border-border bg-surface px-2 text-sm text-text"
                  >
                    <option value="">Elige una cuenta</option>
                    {(cuentas.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-subtle">
                  Importe en {moneda}
                  <input
                    inputMode="decimal"
                    value={importeCobro}
                    onChange={(e) => setImporteCobro(e.target.value)}
                    required
                    className="num min-h-11 w-32 rounded-control border border-border bg-surface px-2 text-right text-sm text-text"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-subtle">
                  Fecha en que entró
                  <input
                    type="date"
                    value={fechaCobro}
                    onChange={(e) => setFechaCobro(e.target.value)}
                    className="num min-h-11 rounded-control border border-border bg-surface px-2 text-sm text-text"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-subtle">
                  Referencia
                  <input
                    value={refCobro}
                    onChange={(e) => setRefCobro(e.target.value)}
                    placeholder="N.º de operación"
                    className="min-h-11 rounded-control border border-border bg-surface px-2 text-sm text-text"
                  />
                </label>
              </div>

              {cobrar.error && <Aviso tipo="error">{mensajeDeError(cobrar.error)}</Aviso>}

              <div className="flex gap-2">
                <Boton variante="primario" type="submit" disabled={cobrar.isPending}>
                  {cobrar.isPending ? 'Registrando…' : 'Registrar cobro'}
                </Boton>
                <Boton variante="sutil" type="button" onClick={cerrar}>
                  Cancelar
                </Boton>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs">
          {suma === null ? (
            <span className="text-warning">Hay un importe que no se entiende.</span>
          ) : cuadra ? (
            <>
              <span className="text-subtle">Suman </span>
              <span className="num font-medium">{format(suma)}</span>
              <span className="text-positive"> · cuadra con la versión aceptada</span>
            </>
          ) : falta === null ? (
            <span className="text-subtle">Sin versión emitida no hay nada que repartir.</span>
          ) : (
            <>
              <span className="num font-medium">{format(suma)}</span>
              <span className="text-warning">
                {falta.minor > 0n
                  ? ` · faltan ${format(falta)} por repartir`
                  : ` · te pasas por ${format({ minor: -falta.minor, currency: falta.currency })}`}
              </span>
            </>
          )}
        </p>
        {puedeEditar && (
          <div className="flex items-center gap-2">
            {borrador !== null && (
              <Boton variante="sutil" onClick={() => setBorrador(null)}>
                Descartar cambios
              </Boton>
            )}
            <Boton
              variante="primario"
              onClick={() => guardar.mutate(filas)}
              disabled={guardar.isPending || !cuadra || borrador === null}
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar cronograma'}
            </Boton>
          </div>
        )}
      </div>

      {guardar.error && (
        <div className="mt-3">
          <Aviso tipo="error">{mensajeDeError(guardar.error)}</Aviso>
        </div>
      )}
      {cuotas.error && (
        <div className="mt-3">
          <Aviso tipo="error">{mensajeDeError(cuotas.error)}</Aviso>
        </div>
      )}
    </Tarjeta>
  );
}

/** El total guardado en la versión, que viaja como texto dentro de `totals`. */
function leerTotal(totals: unknown, moneda: CurrencyCode): Money | null {
  if (typeof totals !== 'object' || totals === null) return null;
  const valor = (totals as Record<string, unknown>)['total'];
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  try {
    return fromRow(valor, moneda);
  } catch {
    return null;
  }
}

function importeLegible(valor: string, moneda: CurrencyCode): string {
  try {
    return format(fromRow(valor, moneda));
  } catch {
    return valor;
  }
}
