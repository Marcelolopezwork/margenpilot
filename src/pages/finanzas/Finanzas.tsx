import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrg, useOrgElegida, puedeEscribirDinero } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { currencyOf, format, fromRow, toDb, zero, type Money } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import { cobradoPorDocumento } from './cobrado';
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

export default function Finanzas() {
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
          onChange={(e) => setCuentaId(e.target.value)}
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
