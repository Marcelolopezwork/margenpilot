import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeEscribirDinero, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { currencyOf, format, fromDb, fromRow, toDb, zero } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import { nombreTipoDocumento, porMoneda } from './cartera';
import { cobradoPorDocumento } from './cobrado';
import {
  TIPOS_DE_COMPRA,
  conceptoDeCompra,
  desglose,
  impuestoDe,
  nombreEstadoCompra,
  pendienteDeCompra,
  vencidaDesde,
  yaExisteProveedor,
  type CompraEnCartera,
} from './compra';

/**
 * Lo que compras: la factura del proveedor, lo que le debes y cuándo.
 *
 * Esta pantalla existe por dos cifras que sin ella no se podían saber.
 *
 * La primera es el resultado. Hasta ahora un gasto se podía anotar como
 * movimiento suelto, es decir cuando ya había salido el dinero. Una factura a
 * treinta días no existía hasta pagarla, así que el mes en que se compró
 * parecía más rentable de lo que fue y el mes en que se pagó, peor.
 *
 * La segunda es el IGV. El impuesto que pagas dentro de una compra no es tu
 * gasto: es crédito fiscal que vuelve contra el IGV que cobraste. Sumarlo al
 * gasto desinfla el resultado todos los meses, y es un error que no se nota
 * porque la cifra sigue pareciendo razonable.
 */
export default function Compras() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const recargar = useRecargar(['compras', 'saldos', 'movimientos', 'proveedores']);
  const conDinero = puedeEscribirDinero(organizacion.rol);
  const hoy = new Date().toISOString().slice(0, 10);
  const listaProveedores = useId();

  const [exito, setExito] = useState<string | null>(null);
  const [accion, setAccion] = useState<{ tipo: 'pagar' | 'anular'; compra: string } | null>(null);

  // El alta
  const [entidadId, setEntidadId] = useState(entidad?.id ?? '');
  const [proveedor, setProveedor] = useState('');
  const [tipoDoc, setTipoDoc] = useState<Enums<'document_type'>>('invoice');
  const [serie, setSerie] = useState('');
  const [concepto, setConcepto] = useState('');
  const [total, setTotal] = useState('');
  const [moneda, setMoneda] = useState('');
  const [tasa, setTasa] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [vence, setVence] = useState('');
  const [categoriaId, setCategoriaId] = useState('');

  // El pago
  const [cuentaId, setCuentaId] = useState('');
  const [importe, setImporte] = useState('');
  const [fechaPago, setFechaPago] = useState(hoy);
  const [refPago, setRefPago] = useState('');
  const [motivo, setMotivo] = useState('');

  const compras = useQuery({
    queryKey: ['compras', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      const cliente = requireSupabase();
      let q = cliente
        .from('billing_documents')
        .select(
          'id, series_number, description, doc_type, issue_date, due_date, currency_code, amount_total, amount_net, amount_tax, tax_rate, status, legal_entity_id, supplier_id, category_id',
        )
        .eq('organization_id', organizacion.id)
        .eq('direction', 'purchase')
        .in('status', ['open', 'partially_paid'])
        .order('due_date', { nullsFirst: false });
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data: docs, error } = await q;
      if (error) throw error;
      if (!docs || docs.length === 0) return [];

      const pagado = await cobradoPorDocumento(docs.map((d) => d.id));

      const { data: provs, error: e2 } = await cliente
        .from('suppliers')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e2) throw e2;
      const nombreProv = new Map((provs ?? []).map((p) => [p.id, p.name]));

      const { data: cats, error: e3 } = await cliente
        .from('financial_categories')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e3) throw e3;
      const nombreCat = new Map((cats ?? []).map((c) => [c.id, c.name]));

      return docs.map((d) => {
        const compra: CompraEnCartera = {
          id: d.id,
          series_number: d.series_number,
          description: d.description,
          doc_type: d.doc_type,
          issue_date: d.issue_date,
          due_date: d.due_date,
          currency_code: d.currency_code,
          amount_total: String(d.amount_total),
          amount_net: String(d.amount_net),
          amount_tax: String(d.amount_tax),
          tax_rate: d.tax_rate === null ? null : String(d.tax_rate),
          status: d.status,
          legal_entity_id: d.legal_entity_id,
          proveedor: nombreProv.get(d.supplier_id ?? '') ?? 'Proveedor desconocido',
          categoria: d.category_id ? nombreCat.get(d.category_id) ?? null : null,
        };
        const yaPagado = pagado.get(d.id) ?? zero(currencyOf(d.currency_code));
        return { compra, pagado: yaPagado, pendiente: pendienteDeCompra(compra, yaPagado) };
      });
    },
  });

  const proveedores = useQuery({
    queryKey: ['proveedores', organizacion.id],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('suppliers')
        .select('id, name, is_active')
        .eq('organization_id', organizacion.id)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const cuentas = useQuery({
    queryKey: ['cuentas', organizacion.id, 'para-compras'],
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

  const categorias = useQuery({
    queryKey: ['categorias', organizacion.id, 'de-gasto'],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('financial_categories')
        .select('id, name, direction')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .in('direction', ['out', 'both'])
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  const impuestos = useQuery({
    queryKey: ['impuestos', organizacion.id, 'para-compras'],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('tax_rates')
        .select('legal_entity_id, name, rate, is_default')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
  });

  function limpiar() {
    setProveedor('');
    setSerie('');
    setConcepto('');
    setTotal('');
    setTasa('');
    setVence('');
    setCategoriaId('');
    setFecha(hoy);
  }

  const anotar = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('registrar_compra', {
        p_entity: entidadId,
        p_supplier: proveedor.trim(),
        p_amount: Number(total.replace(',', '.')),
        p_currency: moneda,
        p_doc_type: tipoDoc,
        p_issue_date: fecha,
        ...(serie.trim() ? { p_series: serie.trim() } : {}),
        ...(vence ? { p_due_date: vence } : {}),
        ...(tasa.trim() ? { p_tax_rate: Number(tasa.replace(',', '.')) } : {}),
        ...(categoriaId ? { p_category: categoriaId } : {}),
        ...(concepto.trim() ? { p_description: concepto.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(
        `Queda anotada la compra de ${proveedor.trim()}. Ya cuenta como gasto del ${formatoFecha(fecha)}, aunque todavía no la hayas pagado: eso es lo que hace que el resultado del mes sea el del mes.`,
      );
      limpiar();
      recargar();
    },
  });

  const pagar = useMutation({
    mutationFn: async (compra: string) => {
      const { error } = await requireSupabase().rpc('registrar_pago_de_compra', {
        p_document: compra,
        p_account: cuentaId,
        p_amount: Number(importe.replace(',', '.')),
        p_value_date: fechaPago,
        ...(refPago.trim() ? { p_external_ref: refPago.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAccion(null);
      setRefPago('');
      recargar();
    },
  });

  const anular = useMutation({
    mutationFn: async (compra: string) => {
      const { error } = await requireSupabase().rpc('anular_documento', {
        p_document: compra,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAccion(null);
      setMotivo('');
      recargar();
    },
  });

  if (!conDinero) {
    return (
      <Seccion
        titulo="Compras"
        regla="Lo que compras y lo que debes a tus proveedores."
      >
        <Vacio
          titulo="Esta sección es de finanzas"
          explicacion="Tu rol en esta organización es comercial. Lo que la empresa compra no te lo enseña la base de datos."
          siguiente="Si necesitas verlo, el dueño puede cambiarte el rol a finanzas."
        />
      </Seccion>
    );
  }

  const filas = compras.data ?? [];
  const porPagar = porMoneda(
    filas.map((f) => ({ currency_code: f.compra.currency_code, importe: toDb(f.pendiente) })),
  );

  const monedasDeLaEntidad = [
    ...new Set(
      (cuentas.data ?? [])
        .filter((c) => c.legal_entity_id === entidadId)
        .map((c) => c.currency_code),
    ),
  ];
  const nombreEntidad =
    entidades.find((x) => x.id === entidadId)?.legal_name ?? 'Esa empresa';

  // El impuesto por defecto de la empresa elegida, para enseñarlo en la ayuda
  // en vez de hacer que alguien lo adivine.
  const porDefecto = (impuestos.data ?? []).find(
    (t) => t.legal_entity_id === entidadId && t.is_default,
  );
  const tasaEfectiva = tasa.trim() !== '' ? tasa.trim() : String(porDefecto?.rate ?? 0);

  // El desglose en vivo: lo que de verdad es gasto y lo que es crédito fiscal.
  let parte: { neto: string; impuesto: string } | null = null;
  if (total.trim() !== '' && moneda) {
    try {
      const { neto, impuesto } = desglose(fromDb(total, currencyOf(moneda)), tasaEfectiva);
      parte = { neto: format(neto), impuesto: format(impuesto) };
    } catch {
      parte = null;
    }
  }

  const sinCuentas = entidadId !== '' && monedasDeLaEntidad.length === 0;

  return (
    <Seccion
      titulo="Compras"
      regla="La factura de un proveedor es un gasto el día que llega, no el día que la pagas. Y el IGV que lleva dentro no es tu gasto: es crédito fiscal que vuelve contra el IGV que cobraste, así que se guarda aparte y no se resta del resultado."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      {porPagar.length > 0 && (
        <Tarjeta className="p-5">
          <p className="text-sm text-muted">Lo que debes a proveedores</p>
          <div className="mt-2 flex flex-wrap gap-8">
            {porPagar.map((t) => {
              const igv = impuestoDe(
                filas.filter((f) => f.compra.currency_code === t.moneda).map((f) => f.compra),
                t.moneda,
              );
              return (
                <div key={t.moneda}>
                  <p className="num text-2xl font-semibold tracking-tight">{format(t.total)}</p>
                  <p className="mt-1 text-sm text-muted">
                    {t.cuantos} {t.cuantos === 1 ? 'factura' : 'facturas'}
                    {porPagar.length > 1 ? ` · ${t.moneda}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-subtle">
                    De eso, {format(igv)} es IGV: crédito fiscal, no gasto.
                  </p>
                </div>
              );
            })}
          </div>
        </Tarjeta>
      )}

      {compras.isPending && <Cargando que="tus compras" />}
      {compras.error && <Aviso tipo="error">{mensajeDeError(compras.error)}</Aviso>}
      {pagar.error && <Aviso tipo="error">{mensajeDeError(pagar.error)}</Aviso>}
      {anular.error && <Aviso tipo="error">{mensajeDeError(anular.error)}</Aviso>}

      {compras.data?.length === 0 && (
        <Vacio
          titulo="Todavía no hay ninguna compra anotada"
          explicacion="Mientras no estén, Análisis enseña los ingresos con una parte de sus costos: los que ya pagaste. Un mes con mucha compra a crédito parece el mejor del año."
          siguiente="Empieza por las facturas que tengas sin pagar. Las que ya pagaste y anotaste como movimiento suelto ya están contadas: no las metas otra vez."
        />
      )}

      {filas.length > 0 && (
        <Lista>
          {filas.map(({ compra, pagado, pendiente }) => {
            const atraso = vencidaDesde(compra, hoy);
            const suEmpresa =
              entidades.find((x) => x.id === compra.legal_entity_id)?.legal_name ?? 'Su empresa';
            return (
              <Fila
                key={compra.id}
                principal={
                  <>
                    <span className="font-medium">{conceptoDeCompra(compra)}</span>
                    <Etiqueta tono={atraso > 0 ? 'atencion' : 'neutro'}>
                      {atraso > 0
                        ? `vencida hace ${atraso} ${atraso === 1 ? 'día' : 'días'}`
                        : nombreEstadoCompra(compra.status)}
                    </Etiqueta>
                  </>
                }
                secundario={
                  <>
                    {compra.proveedor} · {nombreTipoDocumento(compra.doc_type)}
                    {compra.series_number ? ` ${compra.series_number}` : ''} ·{' '}
                    {formatoFecha(compra.issue_date)}
                    {compra.due_date ? ` · vence ${formatoFecha(compra.due_date)}` : ' · sin plazo'}
                    {compra.categoria ? ` · ${compra.categoria}` : ''}
                    {entidades.length > 1 ? ` · ${suEmpresa}` : ''}
                    <br />
                    Gasto {format(fromRow(compra.amount_net, currencyOf(compra.currency_code)))} ·
                    IGV {format(fromRow(compra.amount_tax, currencyOf(compra.currency_code)))}
                    {compra.status === 'partially_paid' ? ` · pagado ${format(pagado)}` : ''}
                  </>
                }
                extremo={
                  <>
                    <span className="num text-sm font-medium">{format(pendiente)}</span>
                    <Boton
                      variante="primario"
                      onClick={() => {
                        setAccion({ tipo: 'pagar', compra: compra.id });
                        setEntidadId(compra.legal_entity_id);
                        setImporte(toDb(pendiente));
                        setCuentaId('');
                      }}
                    >
                      Pagar
                    </Boton>
                    <Boton onClick={() => setAccion({ tipo: 'anular', compra: compra.id })}>
                      Anular
                    </Boton>
                  </>
                }
              />
            );
          })}
        </Lista>
      )}

      {accion?.tipo === 'pagar' &&
        (() => {
          const fila = filas.find((f) => f.compra.id === accion.compra);
          if (!fila) return null;
          const suyas = (cuentas.data ?? []).filter(
            (c) =>
              c.legal_entity_id === fila.compra.legal_entity_id &&
              c.currency_code === fila.compra.currency_code,
          );
          return (
            <Alta titulo={`Pagar a ${fila.compra.proveedor}`} onSubmit={() => pagar.mutate(accion.compra)}>
              {suyas.length === 0 ? (
                <Aviso tipo="atencion">
                  Esta factura está en {fila.compra.currency_code} y{' '}
                  {entidades.find((x) => x.id === fila.compra.legal_entity_id)?.legal_name ??
                    'su empresa'}{' '}
                  no tiene ninguna cuenta en esa moneda. El dinero sale de una cuenta concreta de
                  una empresa concreta: crea la cuenta en Configuración → Cuentas, o págala desde
                  la empresa a la que de verdad pertenece la factura.
                </Aviso>
              ) : (
                <>
                  <Selector
                    etiqueta="De qué cuenta sale"
                    value={cuentaId}
                    onChange={(e) => setCuentaId(e.target.value)}
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
                    etiqueta="Cuánto pagas"
                    ayuda={`Quedan ${format(fila.pendiente)}. Puedes pagar menos: la factura se queda pagada a medias.`}
                    inputMode="decimal"
                    value={importe}
                    onChange={(e) => setImporte(e.target.value)}
                    required
                  />
                  <Campo
                    etiqueta="Fecha del pago"
                    type="date"
                    value={fechaPago}
                    onChange={(e) => setFechaPago(e.target.value)}
                    required
                  />
                  <Campo
                    etiqueta="Referencia del pago"
                    ayuda="El número de operación del banco, para poder conciliarlo después."
                    value={refPago}
                    onChange={(e) => setRefPago(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Boton variante="primario" type="submit" disabled={pagar.isPending}>
                      {pagar.isPending ? 'Registrando…' : 'Registrar el pago'}
                    </Boton>
                    <Boton onClick={() => setAccion(null)}>Cancelar</Boton>
                  </div>
                </>
              )}
            </Alta>
          );
        })()}

      {accion?.tipo === 'anular' && (
        <Alta
          titulo="Anular esta compra"
          onSubmit={() => anular.mutate(accion.compra)}
        >
          <Aviso tipo="info">
            No se borra: queda anulada con el motivo escrito. Si ya le registraste un pago, anula
            primero ese movimiento desde Caja; anular la factura dejando el pago vivo convertiría
            ese dinero en una salida sin nada que la explique.
          </Aviso>
          <Campo
            etiqueta="Por qué se anula"
            ayuda="Queda guardado y no se borra."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <Boton variante="primario" type="submit" disabled={anular.isPending}>
              {anular.isPending ? 'Anulando…' : 'Anular la compra'}
            </Boton>
            <Boton onClick={() => setAccion(null)}>Cancelar</Boton>
          </div>
        </Alta>
      )}

      <Alta titulo="Anotar una compra" exito={exito} onSubmit={() => anotar.mutate()}>
        <Selector
          etiqueta="De qué empresa es la compra"
          value={entidadId}
          onChange={(e) => {
            setEntidadId(e.target.value);
            setMoneda('');
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

        {sinCuentas && (
          <Aviso tipo="atencion">
            {nombreEntidad} no tiene ninguna cuenta activa. La compra se puede anotar igual —la
            deuda existe aunque no haya con qué pagarla—, pero no podrás registrar el pago hasta
            crear su cuenta en Configuración → Cuentas.
          </Aviso>
        )}

        <Campo
          etiqueta="A quién le compras"
          ayuda={
            proveedor.trim() === ''
              ? 'Escribe el nombre. Si no existe todavía, se crea al guardar.'
              : yaExisteProveedor(proveedor, proveedores.data ?? [])
                ? 'Ya existe: se usará ese mismo proveedor.'
                : 'Es nuevo: se creará al guardar.'
          }
          list={listaProveedores}
          value={proveedor}
          onChange={(e) => setProveedor(e.target.value)}
          required
        />
        <datalist id={listaProveedores}>
          {(proveedores.data ?? []).map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>

        <Campo
          etiqueta="Qué compraste"
          ayuda="En palabras: «Hosting anual», «Licencias de diseño». Es lo único que se entiende dentro de tres meses; el número de factura no dice nada."
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Selector
            etiqueta="Tipo de comprobante"
            value={tipoDoc}
            onChange={(e) => setTipoDoc(e.target.value as Enums<'document_type'>)}
          >
            {TIPOS_DE_COMPRA.map((t) => (
              <option key={t} value={t}>
                {nombreTipoDocumento(t)}
              </option>
            ))}
          </Selector>
          <Campo
            etiqueta="Número del comprobante"
            ayuda="Como viene en la factura. La misma no se puede anotar dos veces."
            value={serie}
            onChange={(e) => setSerie(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Selector
            etiqueta="Moneda de la compra"
            value={moneda}
            onChange={(e) => setMoneda(e.target.value)}
            required
          >
            <option value="">Elige una moneda</option>
            {monedasDeLaEntidad.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Selector>
          <Campo
            etiqueta="Total de la factura"
            ayuda="El total que vas a pagar, con el impuesto dentro, tal como está escrito."
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            required
          />
        </div>

        <Campo
          etiqueta="Impuesto en porcentaje"
          ayuda={
            porDefecto
              ? `Si lo dejas vacío se usa el ${porDefecto.name} de ${nombreEntidad}: ${porDefecto.rate} %. Pon 0 si la factura está exonerada.`
              : 'Si lo dejas vacío se toma 0: esta empresa no tiene impuesto por defecto configurado.'
          }
          inputMode="decimal"
          value={tasa}
          onChange={(e) => setTasa(e.target.value)}
        />

        {parte && (
          <p className="rounded-card border border-border bg-surface-2 p-4 text-sm">
            De ese total, <strong className="num">{parte.neto}</strong> es gasto y{' '}
            <strong className="num">{parte.impuesto}</strong> es impuesto. Solo el primero baja tu
            resultado; el segundo es crédito fiscal.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Fecha de la factura"
            ayuda="El día que se emitió. Es la fecha con la que cuenta como gasto."
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
          />
          <Campo
            etiqueta="Fecha de pago acordada"
            ayuda="Si la dejas vacía, la compra queda sin plazo: no aparecerá vencida."
            type="date"
            value={vence}
            onChange={(e) => setVence(e.target.value)}
          />
        </div>

        <Selector
          etiqueta="Categoría del gasto"
          ayuda="Es lo que hace que Análisis pueda decir en qué se fue el dinero. Sin ella la compra cae en «sin categoría»."
          value={categoriaId}
          onChange={(e) => setCategoriaId(e.target.value)}
        >
          <option value="">Sin categoría</option>
          {(categorias.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Selector>

        {anotar.error && <Aviso tipo="error">{mensajeDeError(anotar.error)}</Aviso>}

        <div>
          <Boton variante="primario" type="submit" disabled={anotar.isPending}>
            {anotar.isPending ? 'Anotando…' : 'Anotar la compra'}
          </Boton>
        </div>
      </Alta>

      <p className="max-w-prose text-xs text-subtle">
        Lo que todavía no hace esta pantalla: decir a qué trabajo pertenece cada compra. Mientras
        no se pueda, Análisis sabe cuánto gastaste y en qué, pero no cuánto dejó cada servicio.
        Para eso hace falta atar cada compra y cada venta a las líneas de la cotización aceptada.
      </p>
    </Seccion>
  );
}
