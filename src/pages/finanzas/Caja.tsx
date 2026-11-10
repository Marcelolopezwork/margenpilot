import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrg, useOrgElegida, puedeEscribirDinero } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import {
  currencyOf,
  effectiveRate,
  format,
  fromDb,
  fromRow,
  toDb,
  zero,
  type Money,
} from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import { cobradoPorDocumento } from './cobrado';
import { pagableDesde } from './proyeccion';
import {
  destinosPosibles,
  haceFaltaMontoDestino,
  porQueNoHayDestino,
} from './transferencia';
import {
  TIPOS_A_MANO,
  diasDeAtraso,
  enRojo,
  nombreEstadoDocumento,
  nombreTipoDocumento,
  nombreTipoMovimiento,
  pendienteDe,
  porMoneda,
  tonoEstadoDocumento,
  vencido,
  type DocumentoEnCartera,
} from './cartera';

/** Una cifra grande con su rótulo. Para los dos totales de arriba. */
function Cifra({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div>
      <p className="text-sm text-muted">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{valor}</p>
      {nota && <p className="mt-1 text-xs text-muted">{nota}</p>}
    </div>
  );
}

/**
 * Nunca una cifra sola cuando hay dos monedas: una por moneda, en columnas
 * separadas, y la nota que explica por qué no hay un total único (INV-10).
 */
function PorMoneda({
  rotulo,
  filas,
}: {
  rotulo: string;
  filas: readonly { moneda: string; total: Money; cuantos: number }[];
}) {
  if (filas.length === 0) return <Cifra rotulo={rotulo} valor="—" />;
  return (
    <div className="flex flex-wrap gap-8">
      {filas.map((f) => (
        <Cifra
          key={f.moneda}
          rotulo={filas.length > 1 ? `${rotulo} · ${f.moneda}` : rotulo}
          valor={format(f.total)}
          nota={`${f.cuantos} ${f.cuantos === 1 ? 'registro' : 'registros'}`}
        />
      ))}
    </div>
  );
}

/**
 * Lo que el usuario está tecleando, como dinero, o null si todavía no lo es.
 * Solo para enseñar la tasa mientras escribe: la que se guarda la calcula la
 * base con los dos importes, que es la única que no se puede teclear mal.
 */
function aMoney(texto: string, moneda: string | undefined): Money | null {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio || !moneda) return null;
  try {
    return fromDb(limpio, currencyOf(moneda));
  } catch {
    return null;
  }
}

export default function Caja() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const recargar = useRecargar(['saldos', 'cartera', 'movimientos']);
  const conDinero = puedeEscribirDinero(organizacion.rol);

  const hoy = new Date().toISOString().slice(0, 10);

  const [exito, setExito] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState('');
  const [direccion, setDireccion] = useState<Enums<'cash_direction'>>('out');
  const [importe, setImporte] = useState('');
  const [concepto, setConcepto] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [tipo, setTipo] = useState<Enums<'cash_kind'>>('operating');
  const [referencia, setReferencia] = useState('');
  const [gastoFijo, setGastoFijo] = useState('');

  const [exitoMover, setExitoMover] = useState<string | null>(null);
  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [sale, setSale] = useState('');
  const [llega, setLlega] = useState('');
  const [fechaMov, setFechaMov] = useState(hoy);
  const [conceptoMov, setConceptoMov] = useState('');
  const [comision, setComision] = useState('');
  const [comisionDe, setComisionDe] = useState('');
  const [refMov, setRefMov] = useState('');

  const cuentas = useQuery({
    queryKey: ['saldos', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      const cliente = requireSupabase();
      let q = cliente
        .from('cash_accounts')
        .select('id, name, bank_name, currency_code, legal_entity_id, is_active')
        .eq('organization_id', organizacion.id)
        .order('sort');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data: lista, error } = await q;
      if (error) throw error;

      const { data: saldos, error: e2 } = await cliente
        .from('account_balances')
        .select('cash_account_id, currency_code, balance, movimientos, ultimo_movimiento')
        .eq('organization_id', organizacion.id);
      if (e2) throw e2;

      return (lista ?? []).map((c) => {
        const s = (saldos ?? []).find((x) => x.cash_account_id === c.id);
        return {
          ...c,
          // Una cuenta sin movimientos no tiene fila en la vista. Su saldo es
          // cero, no «desconocido»: la fórmula es la misma, con cero sumandos.
          saldo: fromRow(s?.balance ?? 0, currencyOf(c.currency_code)),
          movimientos: s?.movimientos ?? 0,
          ultimo: s?.ultimo_movimiento ?? null,
        };
      });
    },
  });

  const cartera = useQuery({
    queryKey: ['cartera', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      const cliente = requireSupabase();
      let q = cliente
        .from('billing_documents')
        .select(
          'id, series_number, doc_type, issue_date, due_date, currency_code, amount_total, status, client_id, legal_entity_id',
        )
        .in('status', ['open', 'partially_paid'])
        .eq('organization_id', organizacion.id)
        .order('due_date', { nullsFirst: false });
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data: docs, error } = await q;
      if (error) throw error;
      if (!docs || docs.length === 0) return [];

      const cobrado = await cobradoPorDocumento(docs.map((d) => d.id));

      const { data: clientes, error: e4 } = await cliente
        .from('clients')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e4) throw e4;
      const nombre = new Map((clientes ?? []).map((c) => [c.id, c.name]));

      return docs.map((d) => {
        const doc: DocumentoEnCartera = {
          id: d.id,
          series_number: d.series_number,
          issue_date: d.issue_date,
          due_date: d.due_date,
          currency_code: d.currency_code,
          amount_total: String(d.amount_total),
          status: d.status,
          cliente: nombre.get(d.client_id) ?? 'Cliente desconocido',
        };
        const pagado = cobrado.get(d.id) ?? zero(currencyOf(d.currency_code));
        return { ...d, doc, pagado, pendiente: pendienteDe(doc, pagado) };
      });
    },
  });

  const movimientos = useQuery({
    queryKey: ['movimientos', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      let q = requireSupabase()
        .from('cash_movements')
        .select(
          'id, value_date, description, direction, amount, currency_code, kind, is_void, void_reason, cash_account_id, external_ref, source',
        )
        .eq('organization_id', organizacion.id)
        .order('value_date', { ascending: false })
        .order('booked_at', { ascending: false })
        .limit(60);
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Para poder decir «esto pagó el hosting de noviembre». Sin esto, la
  // proyección seguiría esperando un pago que ya hiciste.
  const gastosFijos = useQuery({
    queryKey: ['gastos-fijos', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      let q = requireSupabase()
        .from('recurring_expenses')
        .select('id, label, amount, currency_code, cadence, legal_entity_id, cash_account_id')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('label');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('registrar_movimiento', {
        p_account: cuentaId,
        p_direction: direccion,
        p_amount: Number(importe.replace(',', '.')),
        p_description: concepto.trim(),
        p_value_date: fecha,
        p_kind: tipo,
        ...(referencia.trim() ? { p_external_ref: referencia.trim() } : {}),
        ...(gastoFijo && direccion === 'out' ? { p_recurring: gastoFijo } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(
        `${direccion === 'in' ? 'Entrada' : 'Salida'} de ${importe} anotada. El saldo de la cuenta ya la incluye.`,
      );
      setImporte('');
      setConcepto('');
      setReferencia('');
      setGastoFijo('');
      recargar();
    },
  });

  const mover = useMutation({
    onMutate: () => setExitoMover(null),
    mutationFn: async () => {
      const cuentaComision = comision.trim() ? comisionDe || origenId : null;
      const { error } = await requireSupabase().rpc('registrar_transferencia', {
        p_from: origenId,
        p_to: destinoId,
        p_amount_from: Number(sale.replace(',', '.')),
        // Solo cuando cambia de moneda. En la misma, mandar el monto de destino
        // sería repetir el de origen, y si no coincidieran la base lo
        // rechazaría con razón.
        ...(cambiaMoneda ? { p_amount_to: Number(llega.replace(',', '.')) } : {}),
        p_value_date: fechaMov,
        ...(conceptoMov.trim() ? { p_description: conceptoMov.trim() } : {}),
        ...(cuentaComision
          ? { p_fee: Number(comision.replace(',', '.')), p_fee_account: cuentaComision }
          : {}),
        ...(refMov.trim() ? { p_external_ref: refMov.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExitoMover(
        `Transferencia anotada: salieron ${sale} de ${origen?.name ?? 'la cuenta de origen'} y ${
          cambiaMoneda ? `llegaron ${llega}` : 'llegó lo mismo'
        } a ${destino?.name ?? 'la de destino'}. Los dos saldos ya lo incluyen.`,
      );
      setSale('');
      setLlega('');
      setConceptoMov('');
      setComision('');
      setRefMov('');
      recargar();
    },
  });

  const anular = useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await requireSupabase().rpc('anular_movimiento', {
        p_movement: id,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  // El rol comercial no ve nada de esto porque la base no se lo enseña. Sin
  // este aviso, la pantalla parecería vacía y no prohibida, que es peor.
  if (!conDinero) {
    return (
      <Seccion
        titulo="Finanzas"
        regla="El saldo de una cuenta sale solo del libro de caja: cada entrada y cada salida, una por una. Ninguna otra tabla mueve dinero."
      >
        <Vacio
          titulo="Esta sección es de finanzas"
          explicacion="Tu rol en esta organización es comercial: cotizas, envías y apruebas. Las cuentas, la cartera y el libro de caja no te los enseña la base de datos, no es que la pantalla los esconda."
          siguiente="Si necesitas verlos, el dueño de la organización puede cambiarte el rol a finanzas."
        />
      </Seccion>
    );
  }

  const saldos = porMoneda(
    (cuentas.data ?? []).map((c) => ({ currency_code: c.currency_code, importe: toDb(c.saldo) })),
  );
  const porCobrar = porMoneda(
    (cartera.data ?? []).map((d) => ({
      currency_code: d.currency_code,
      importe: toDb(d.pendiente),
    })),
  );
  const vencidas = (cartera.data ?? []).filter((d) => vencido(d.doc, hoy));

  const cuentasActivas = (cuentas.data ?? []).filter((c) => c.is_active);
  const cuentaElegida = cuentasActivas.find((c) => c.id === cuentaId);

  // Un gasto fijo solo se paga desde una cuenta de su empresa y en su moneda.
  // Antes se ofrecían todos los de la organización y la base rechazaba el
  // imposible con una violación de clave ajena, que en pantalla se leía como
  // «falta un dato relacionado». Ahora la lista es la de los que esta cuenta
  // puede pagar, y lo que queda fuera se explica.
  const gastosDeLaCuenta = (gastosFijos.data ?? []).filter((g) =>
    pagableDesde(g, cuentaElegida),
  );
  const gastosFuera = (gastosFijos.data ?? []).length - gastosDeLaCuenta.length;

  // Mover dinero entre cuentas. El destino no se ofrece entero: una
  // transferencia va entre dos cuentas de la misma empresa, porque entre dos
  // empresas el dinero cambia de libro y eso es otro hecho (INV-5).
  const origen = cuentasActivas.find((c) => c.id === origenId);
  const destino = cuentasActivas.find((c) => c.id === destinoId);
  const destinos = destinosPosibles(cuentasActivas, origen);
  const faltaDestino = porQueNoHayDestino(cuentasActivas, origen);
  const cambiaMoneda = haceFaltaMontoDestino(origen, destino);
  const dineroSale = aMoney(sale, origen?.currency_code);
  const dineroLlega = aMoney(llega, destino?.currency_code);
  const tasa =
    cambiaMoneda && dineroSale && dineroLlega ? effectiveRate(dineroSale, dineroLlega) : null;
  const nombreEmpresa = (id: string | undefined) =>
    entidades.find((e) => e.id === id)?.legal_name ?? 'Esa empresa';

  return (
    <Seccion
      titulo="Finanzas"
      regla="El saldo de una cuenta sale solo del libro de caja: cada entrada y cada salida, una por una. Lo que está por cobrar son documentos emitidos, no cuotas pactadas: una cuota prevista entra en la proyección y no en la cartera."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      <Tarjeta className="p-5">
        <div className="flex flex-wrap gap-10">
          <PorMoneda rotulo="En las cuentas" filas={saldos} />
          <PorMoneda rotulo="Por cobrar" filas={porCobrar} />
        </div>
        {saldos.length > 1 && (
          <p className="mt-4 max-w-prose text-xs text-muted">
            Una cifra por moneda y no una sola: soles y dólares son dos contabilidades. Sumarlas
            exigiría un tipo de cambio, y un total con un tipo de cambio escondido dentro es un
            total que no se puede auditar.
          </p>
        )}
        {vencidas.length > 0 && (
          <p className="mt-4 text-sm text-warning">
            {vencidas.length === 1 ? 'Hay 1 documento vencido' : `Hay ${vencidas.length} documentos vencidos`}
            , el más atrasado por {Math.max(...vencidas.map((d) => diasDeAtraso(d.doc, hoy)))} días.
          </p>
        )}
      </Tarjeta>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Por cobrar</h2>
        {cartera.isPending && <Cargando que="la cartera" />}
        {cartera.error && <Aviso tipo="error">{mensajeDeError(cartera.error)}</Aviso>}
        {cartera.data?.length === 0 && (
          <Vacio
            titulo="No hay nada emitido pendiente de cobro"
            explicacion="Aquí salen los documentos emitidos que el cliente todavía no ha pagado. Una cuota pactada en un cronograma no cuenta: se le debe cuando hay documento."
            siguiente="Aprueba una cotización, reparte su cronograma y emite el documento de la primera cuota."
          />
        )}
        {cartera.data && cartera.data.length > 0 && (
          <Lista>
            {cartera.data.map((d) => (
              <Fila
                key={d.id}
                principal={
                  <>
                    <span className="font-medium">
                      {nombreTipoDocumento(d.doc_type)}
                      {d.series_number ? ` ${d.series_number}` : ' sin número'}
                    </span>
                    <Etiqueta tono={tonoEstadoDocumento(d.doc, hoy)}>
                      {vencido(d.doc, hoy)
                        ? `vencido hace ${diasDeAtraso(d.doc, hoy)} días`
                        : nombreEstadoDocumento(d.status)}
                    </Etiqueta>
                  </>
                }
                secundario={
                  <>
                    {d.doc.cliente} · emitido el {formatoFecha(d.issue_date)}
                    {d.due_date ? ` · vence el ${formatoFecha(d.due_date)}` : ' · sin plazo'}
                  </>
                }
                extremo={
                  <div className="text-right">
                    <p className="font-medium tabular-nums">{format(d.pendiente)}</p>
                    <p className="text-xs text-muted tabular-nums">
                      de {format(fromRow(d.amount_total, currencyOf(d.currency_code)))}
                    </p>
                  </div>
                }
              />
            ))}
          </Lista>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Cuentas</h2>
        {cuentas.isPending && <Cargando que="tus cuentas" />}
        {cuentas.error && <Aviso tipo="error">{mensajeDeError(cuentas.error)}</Aviso>}
        {cuentas.data?.length === 0 && (
          <Vacio
            titulo="No hay ninguna cuenta"
            explicacion="Una cuenta es donde entra y de donde sale el dinero. Tiene una sola moneda y pertenece a una sola empresa del grupo."
            siguiente="Créala en Configuración → Cuentas."
          />
        )}
        {cuentas.data && cuentas.data.length > 0 && (
          <Lista>
            {cuentas.data.map((c) => (
              <Fila
                key={c.id}
                principal={
                  <>
                    <span className="font-medium">{c.name}</span>
                    <Etiqueta>{c.currency_code}</Etiqueta>
                    {!c.is_active && <Etiqueta tono="atencion">inactiva</Etiqueta>}
                    {enRojo(c.saldo) && <Etiqueta tono="atencion">en rojo</Etiqueta>}
                  </>
                }
                secundario={
                  <>
                    {c.bank_name ?? 'Sin banco anotado'} ·{' '}
                    {c.movimientos === 0
                      ? 'sin movimientos todavía'
                      : `${c.movimientos} movimientos, el último el ${formatoFecha(c.ultimo ?? '')}`}
                  </>
                }
                extremo={<p className="font-medium tabular-nums">{format(c.saldo)}</p>}
              />
            ))}
          </Lista>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <Alta titulo="Anotar un movimiento" exito={exito} onSubmit={() => crear.mutate()}>
        <p className="max-w-prose text-sm text-muted">
          Para lo que no viene de una cotización: el hosting, una comisión del banco, el saldo con
          el que arrancas, un aporte o un retiro. Los cobros de clientes no se anotan aquí: se
          registran sobre su documento, para que quede claro qué saldaban.
        </p>

        <Selector
          etiqueta="Cuenta"
          value={cuentaId}
          onChange={(e) => {
            const id = e.target.value;
            setCuentaId(id);
            // Cambiar de cuenta puede dejar el gasto elegido fuera de su
            // libro. Se suelta en vez de mandarlo y que lo rechace la base.
            const nueva = cuentasActivas.find((c) => c.id === id);
            const elegido = (gastosFijos.data ?? []).find((g) => g.id === gastoFijo);
            if (elegido && !pagableDesde(elegido, nueva)) setGastoFijo('');
          }}
          required
        >
          <option value="">Elige una cuenta</option>
          {cuentasActivas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.currency_code}
            </option>
          ))}
        </Selector>

        <Selector
          etiqueta="Dirección"
          value={direccion}
          onChange={(e) => setDireccion(e.target.value as Enums<'cash_direction'>)}
        >
          <option value="out">Sale dinero</option>
          <option value="in">Entra dinero</option>
        </Selector>

        <Campo
          etiqueta={`Importe${cuentaElegida ? ` en ${cuentaElegida.currency_code}` : ''}`}
          ayuda="Siempre en positivo. El signo lo da la dirección."
          inputMode="decimal"
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          required
        />

        <Campo
          etiqueta="Concepto"
          ayuda="Lo que vas a leer dentro de tres meses cuando lo cuadres con el extracto."
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          required
        />

        <Campo
          etiqueta="Fecha"
          ayuda="La fecha en que el banco movió el dinero, no la de hoy si no coinciden."
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          required
        />

        <Selector
          etiqueta="Tipo"
          ayuda="Decide si cuenta como resultado del negocio o no. Un retiro del dueño no es un gasto."
          value={tipo}
          onChange={(e) => setTipo(e.target.value as Enums<'cash_kind'>)}
        >
          {TIPOS_A_MANO.map((t) => (
            <option key={t} value={t}>
              {nombreTipoMovimiento(t)}
            </option>
          ))}
        </Selector>

        {/*
          Solo para salidas: un gasto recurrente se paga, no se cobra. La base
          lo rechaza igual (`recurrente_solo_sale`), pero ofrecerlo en una
          entrada sería invitar al error.
        */}
        {direccion === 'out' && gastosDeLaCuenta.length > 0 && (
          <Selector
            etiqueta="¿Paga un gasto fijo?"
            ayuda="Opcional. Decirlo saca ese periodo de la proyección, para que no siga apareciendo como pendiente."
            value={gastoFijo}
            onChange={(e) => {
              const id = e.target.value;
              setGastoFijo(id);
              const g = gastosDeLaCuenta.find((x) => x.id === id);
              if (!g) return;
              if (!concepto.trim()) setConcepto(g.label);
              if (!importe.trim()) setImporte(toDb(fromRow(g.amount, currencyOf(g.currency_code))));
            }}
          >
            <option value="">No, es un gasto suelto</option>
            {gastosDeLaCuenta.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label} · {g.amount} {g.currency_code}
              </option>
            ))}
          </Selector>
        )}

        {/*
          Lo que queda fuera se dice. Un desplegable que no aparece es un
          misterio; peor aún si el gasto que falta es el único que hay.
        */}
        {direccion === 'out' && gastosFuera > 0 && (
          <p className="max-w-prose text-xs text-subtle">
            {cuentaElegida
              ? `${gastosFuera === 1 ? 'Hay 1 gasto fijo que no sale' : `Hay ${gastosFuera} gastos fijos que no salen`} de esta cuenta: son de otra empresa del grupo o están en otra moneda. De una cuenta sale el dinero de su empresa y en su moneda, así que para pagarlos hace falta una cuenta de la empresa que los paga.`
              : 'Elige primero la cuenta y, si lo que sale paga un gasto fijo, podrás decir cuál: solo se ofrecen los que esa cuenta puede pagar.'}
          </p>
        )}

        <Campo
          etiqueta="Referencia del banco"
          ayuda="Opcional. El número de operación, para encontrarlo después en el extracto."
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
        />

        {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

        <div>
          <Boton variante="primario" type="submit" disabled={crear.isPending}>
            {crear.isPending ? 'Anotando…' : 'Anotar movimiento'}
          </Boton>
        </div>
      </Alta>

      {/* ---------------------------------------------------------------- */}
      <Alta titulo="Mover dinero entre cuentas" exito={exitoMover} onSubmit={() => mover.mutate()}>
        <p className="max-w-prose text-sm text-muted">
          Un traslado entre tus propias cuentas no es un ingreso ni un gasto, así que se anota de
          una vez: queda como un solo hecho con dos patas, lo que sale de una y lo que entra en la
          otra. Anotado como dos movimientos sueltos, un mes en el que no pasó nada enseñaría un
          ingreso y un gasto del mismo tamaño.
        </p>

        <Selector
          etiqueta="Sale de"
          value={origenId}
          onChange={(e) => {
            const id = e.target.value;
            setOrigenId(id);
            // Cambiar el origen puede dejar el destino en otra empresa. Se
            // suelta en vez de mandarlo y que lo rechace la base.
            const nuevo = cuentasActivas.find((c) => c.id === id);
            const elegido = cuentasActivas.find((c) => c.id === destinoId);
            if (elegido && !destinosPosibles(cuentasActivas, nuevo).some((c) => c.id === elegido.id))
              setDestinoId('');
          }}
          required
        >
          <option value="">Elige la cuenta de la que sale</option>
          {cuentasActivas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.currency_code}
            </option>
          ))}
        </Selector>

        {faltaDestino && (
          <Aviso tipo="atencion">
            {faltaDestino === 'sin-origen'
              ? 'Primero di de qué cuenta sale el dinero: como destino solo se ofrecen las otras cuentas de esa misma empresa.'
              : `${nombreEmpresa(origen?.legal_entity_id)} solo tiene esta cuenta, así que no hay a dónde mover el dinero dentro de su libro. Si de verdad existe otra, créala en Configuración → Cuentas. Y mover dinero a una cuenta de otra empresa del grupo no es una transferencia: es un préstamo, un aporte o una venta con su factura, y entonces son dos movimientos, uno en cada libro, cada uno diciendo qué fue.`}
          </Aviso>
        )}

        {destinos.length > 0 && (
          <>
            <Selector
              etiqueta="Entra en"
              ayuda="Solo las otras cuentas de la misma empresa: el dinero no cruza de un libro a otro."
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
              required
            >
              <option value="">Elige la cuenta que lo recibe</option>
              {destinos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.currency_code}
                </option>
              ))}
            </Selector>

            <Campo
              etiqueta={`Lo que sale${origen ? ` en ${origen.currency_code}` : ''}`}
              ayuda="Lo que el banco quitó de la cuenta de origen."
              inputMode="decimal"
              value={sale}
              onChange={(e) => setSale(e.target.value)}
              required
            />

            {cambiaMoneda && (
              <Campo
                etiqueta={`Lo que llegó en ${destino?.currency_code ?? ''}`}
                ayuda="Lo que el banco dejó de verdad en la cuenta de destino, no lo que daría la tasa del día. La diferencia entre las dos es lo que se quedó el banco, y así queda contada."
                inputMode="decimal"
                value={llega}
                onChange={(e) => setLlega(e.target.value)}
                required
              />
            )}

            {tasa && (
              <p className="max-w-prose text-xs text-subtle">
                Tasa aplicada: {tasa} {destino?.currency_code} por {origen?.currency_code}. No se
                teclea en ninguna parte: sale de lo que salió y lo que llegó, y por eso es la del
                banco y no una de referencia.
              </p>
            )}

            <Campo
              etiqueta="Fecha de la transferencia"
              ayuda="La fecha en que el banco movió el dinero."
              type="date"
              value={fechaMov}
              onChange={(e) => setFechaMov(e.target.value)}
              required
            />

            <Campo
              etiqueta="Concepto de la transferencia"
              ayuda={`Opcional. Si lo dejas vacío queda «Transferencia de ${origen?.name ?? 'una cuenta'} a ${destino?.name ?? 'otra'}».`}
              value={conceptoMov}
              onChange={(e) => setConceptoMov(e.target.value)}
            />

            <Campo
              etiqueta="Comisión del banco"
              ayuda="Opcional, y va aparte a propósito: la comisión sí es un gasto de verdad, así que se anota como tal en vez de desaparecer dentro del importe."
              inputMode="decimal"
              value={comision}
              onChange={(e) => setComision(e.target.value)}
            />

            {comision.trim() && (
              <Selector
                etiqueta="La comisión sale de"
                ayuda="La cobra el banco de una de las dos cuentas, y el extracto dice de cuál."
                value={comisionDe || origenId}
                onChange={(e) => setComisionDe(e.target.value)}
              >
                <option value={origenId}>
                  {origen?.name} · {origen?.currency_code}
                </option>
                <option value={destinoId}>
                  {destino?.name} · {destino?.currency_code}
                </option>
              </Selector>
            )}

            <Campo
              etiqueta="Referencia de la operación"
              ayuda="Opcional. El número de operación, para encontrarla después en el extracto."
              value={refMov}
              onChange={(e) => setRefMov(e.target.value)}
            />

            {mover.error && <Aviso tipo="error">{mensajeDeError(mover.error)}</Aviso>}

            <div>
              <Boton variante="primario" type="submit" disabled={mover.isPending}>
                {mover.isPending ? 'Anotando…' : 'Anotar transferencia'}
              </Boton>
            </div>
          </>
        )}
      </Alta>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Libro de caja</h2>
        <p className="max-w-prose text-sm text-muted">
          Los últimos sesenta movimientos. Nada se borra: anular marca la fila con su motivo y la
          saca del saldo, y la fila se queda para que la historia siga completa.
        </p>
        {movimientos.isPending && <Cargando que="el libro de caja" />}
        {movimientos.error && <Aviso tipo="error">{mensajeDeError(movimientos.error)}</Aviso>}
        {movimientos.data?.length === 0 && (
          <Vacio
            titulo="El libro está vacío"
            explicacion="Todavía no hay ni una entrada ni una salida, así que todos los saldos están en cero."
            siguiente="Si arrancas con dinero en la cuenta, anótalo como «Saldo de apertura»: así el saldo sale de una sola fórmula y no de un saldo inicial aparte."
          />
        )}
        {anular.error && <Aviso tipo="error">{mensajeDeError(anular.error)}</Aviso>}
        {movimientos.data && movimientos.data.length > 0 && (
          <Lista>
            {movimientos.data.map((m) => {
              const dinero = fromRow(m.amount, currencyOf(m.currency_code));
              const cuenta = (cuentas.data ?? []).find((c) => c.id === m.cash_account_id);
              return (
                <Fila
                  key={m.id}
                  principal={
                    <>
                      <span className={`font-medium ${m.is_void ? 'line-through text-muted' : ''}`}>
                        {m.description}
                      </span>
                      {m.kind !== 'operating' && (
                        <Etiqueta>{nombreTipoMovimiento(m.kind)}</Etiqueta>
                      )}
                      {m.is_void && <Etiqueta tono="atencion">anulado</Etiqueta>}
                      {m.source === 'quote' && <Etiqueta>cobro de cotización</Etiqueta>}
                      {m.source === 'recurring' && <Etiqueta>gasto fijo</Etiqueta>}
                    </>
                  }
                  secundario={
                    <>
                      {formatoFecha(m.value_date)} · {cuenta?.name ?? 'otra cuenta'}
                      {m.external_ref ? ` · ref. ${m.external_ref}` : ''}
                      {m.is_void && m.void_reason ? ` · anulado: ${m.void_reason}` : ''}
                    </>
                  }
                  extremo={
                    <>
                      <p
                        className={`font-medium tabular-nums ${m.is_void ? 'text-muted line-through' : m.direction === 'in' ? 'text-positive' : ''}`}
                      >
                        {m.direction === 'in' ? '+' : '−'}
                        {format(dinero)}
                      </p>
                      {!m.is_void && (
                        <Boton
                          onClick={() => {
                            const motivo = window.prompt(
                              '¿Por qué se anula? Queda escrito y no se borra.',
                            );
                            if (motivo && motivo.trim()) anular.mutate({ id: m.id, motivo });
                          }}
                          disabled={anular.isPending}
                        >
                          Anular
                        </Boton>
                      )}
                    </>
                  }
                />
              );
            })}
          </Lista>
        )}
      </section>

      {entidades.length > 1 && !entidad && (
        <p className="max-w-prose text-xs text-muted">
          Estás viendo las {entidades.length} empresas a la vez. Cada una tiene su propia
          contabilidad y su moneda; elige una arriba para mirarla sola.
        </p>
      )}
    </Seccion>
  );
}
