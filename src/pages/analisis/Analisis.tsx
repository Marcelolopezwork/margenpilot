import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrg, useOrgElegida, puedeEscribirDinero } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { currencyOf, format, fromRow } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { nombreTipoMovimiento } from '../finanzas/cartera';
import {
  fueraDelResultado,
  gastosPorCategoria,
  gastosPorProveedor,
  ingresosPorCliente,
  nombrePeriodo,
  rangoDe,
  resultadoPorMoneda,
  type Hecho,
  type Periodo,
} from './resultado';

const PERIODOS: readonly Periodo[] = ['mes', 'mes-pasado', 'anio', 'doce-meses'];

function Cifra({
  rotulo,
  valor,
  nota,
  tono,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  tono?: 'positivo' | 'atencion';
}) {
  return (
    <div>
      <p className="text-sm text-muted">{rotulo}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${
          tono === 'positivo' ? 'text-positive' : tono === 'atencion' ? 'text-warning' : ''
        }`}
      >
        {valor}
      </p>
      {nota && <p className="mt-1 text-xs text-muted">{nota}</p>}
    </div>
  );
}

export default function Analisis() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const conDinero = puedeEscribirDinero(organizacion.rol);

  const hoy = new Date().toISOString().slice(0, 10);
  const [periodo, setPeriodo] = useState<Periodo>('doce-meses');
  const rango = rangoDe(periodo, hoy);

  const datos = useQuery({
    queryKey: ['resultado', organizacion.id, entidad?.id ?? null, rango.desde, rango.hasta],
    enabled: conDinero,
    queryFn: async () => {
      const cliente = requireSupabase();

      let q = cliente
        .from('economic_facts')
        .select(
          'origen, fecha, direction, flow_class, kind, currency_code, amount_total, amount_net, amount_tax, category_id, client_id, supplier_id, concepto',
        )
        .eq('organization_id', organizacion.id)
        .gte('fecha', rango.desde)
        .lte('fecha', rango.hasta)
        .order('fecha', { ascending: false });
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;

      const { data: clientes, error: e2 } = await cliente
        .from('clients')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e2) throw e2;

      const { data: categorias, error: e3 } = await cliente
        .from('financial_categories')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e3) throw e3;

      const { data: proveedores, error: e4 } = await cliente
        .from('suppliers')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e4) throw e4;

      return {
        hechos: (data ?? []) as unknown as Hecho[],
        clientes: new Map((clientes ?? []).map((c) => [c.id, c.name])),
        categorias: new Map((categorias ?? []).map((c) => [c.id, c.name])),
        proveedores: new Map((proveedores ?? []).map((p) => [p.id, p.name])),
      };
    },
  });

  // La vista cuelga de las tablas del dinero, así que al rol comercial la base
  // no le devuelve ni una fila. Se lo explica en vez de dejar ceros, que
  // parecerían un negocio parado.
  if (!conDinero) {
    return (
      <Seccion
        titulo="Análisis"
        regla="El resultado se calcula sobre hechos económicos: los documentos emitidos más los movimientos que no saldan ninguno. Así nada se cuenta dos veces."
      >
        <Vacio
          titulo="Esta sección es de finanzas"
          explicacion="Tu rol en esta organización es comercial. El resultado se calcula sobre la cartera y el libro de caja, y esas tablas no te las enseña la base de datos."
          siguiente="El margen de cada cotización sí es tuyo: está en Comercial, al abrirla."
        />
      </Seccion>
    );
  }

  const hechos = datos.data?.hechos ?? [];
  const porMoneda = resultadoPorMoneda(hechos);
  const porCliente = ingresosPorCliente(hechos, datos.data?.clientes ?? new Map());
  const porCategoria = gastosPorCategoria(hechos, datos.data?.categorias ?? new Map());
  const porProveedor = gastosPorProveedor(hechos, datos.data?.proveedores ?? new Map());
  const aparte = fueraDelResultado(hechos);

  return (
    <Seccion
      titulo="Análisis"
      regla="El resultado se calcula sobre hechos económicos: cada documento emitido, más cada movimiento que no salda ninguno. Un cobro asignado a su factura no se cuenta dos veces, y mover dinero entre tus cuentas no cuenta como nada."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      <Selector
        etiqueta="Periodo"
        ayuda="Meses y años completos a propósito: «los últimos 30 días» da una cifra que cambia cada mañana y no se puede cuadrar con nada."
        value={periodo}
        onChange={(e) => setPeriodo(e.target.value as Periodo)}
      >
        {PERIODOS.map((p) => (
          <option key={p} value={p}>
            {nombrePeriodo(p)}
          </option>
        ))}
      </Selector>

      {datos.isPending && <Cargando que="el resultado" />}
      {datos.error && <Aviso tipo="error">{mensajeDeError(datos.error)}</Aviso>}

      {datos.data && hechos.length === 0 && (
        <Vacio
          titulo={`No hay nada en ${nombrePeriodo(periodo).toLowerCase()}`}
          explicacion="Aquí entran los documentos que emitiste y los gastos que anotaste sin documento. Las transferencias entre tus cuentas y los saldos de apertura no entran nunca: no son ingreso ni gasto."
          siguiente="Emite el documento de una cuota en Comercial, o anota un gasto en Finanzas → Caja."
        />
      )}

      {porMoneda.map((r) => (
        <Tarjeta key={r.moneda} className="p-5">
          <div className="flex flex-wrap items-start gap-10">
            <Cifra
              rotulo={`Ingresos · ${r.moneda}`}
              valor={format(r.ingresos)}
              nota="neto, sin impuesto"
            />
            <Cifra rotulo="Gastos" valor={format(r.gastos)} nota="neto, sin impuesto" />
            <Cifra
              rotulo="Resultado"
              valor={format(r.resultado)}
              tono={r.resultado.minor < 0n ? 'atencion' : 'positivo'}
              nota={r.margen === null ? 'sin ingresos que comparar' : `margen del ${r.margen.toFixed(1)} %`}
            />
          </div>

          <p className="mt-4 max-w-prose text-xs text-muted">
            {r.hechos} {r.hechos === 1 ? 'hecho económico' : 'hechos económicos'} entre el{' '}
            {formatoFecha(rango.desde)} y el {formatoFecha(rango.hasta)}. IGV cobrado{' '}
            {format(r.igvCobrado)} y pagado {format(r.igvPagado)}: ni uno ni otro es resultado, son
            dinero de la SUNAT que pasa por tus cuentas.
          </p>

          {r.noOperativo.minor !== 0n && (
            <p className="mt-2 max-w-prose text-xs text-warning">
              Fuera del resultado hay {format(r.noOperativo)} de movimientos que no son del
              negocio: retiros, aportes o préstamos. No se suman arriba a propósito —un retiro no
              es un gasto y un préstamo recibido no es una venta—, pero el dinero sí se movió.
            </p>
          )}
        </Tarjeta>
      ))}

      {porMoneda.length > 1 && (
        <p className="max-w-prose text-xs text-muted">
          Una tarjeta por moneda y no una suma: soles y dólares son dos contabilidades. Un total
          único exigiría un tipo de cambio, y un total con un tipo de cambio escondido dentro no se
          puede auditar (INV-10).
        </p>
      )}

      {porCliente.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">De dónde vino el ingreso</h2>
          <Lista>
            {porCliente.map((f) => (
              <Fila
                key={`${f.moneda}-${f.clave}`}
                principal={
                  <>
                    <span className="font-medium">{f.nombre}</span>
                    <Etiqueta>{f.moneda}</Etiqueta>
                  </>
                }
                secundario={
                  <>
                    {f.hechos} {f.hechos === 1 ? 'documento o cobro' : 'documentos o cobros'}
                  </>
                }
                extremo={<p className="font-medium tabular-nums">{format(f.total)}</p>}
              />
            ))}
          </Lista>
        </section>
      )}

      {porCategoria.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">En qué se fue</h2>
          <Lista>
            {porCategoria.map((f) => (
              <Fila
                key={`${f.moneda}-${f.clave}`}
                principal={
                  <>
                    <span className="font-medium">{f.nombre}</span>
                    <Etiqueta>{f.moneda}</Etiqueta>
                  </>
                }
                secundario={
                  <>
                    {f.hechos} {f.hechos === 1 ? 'salida' : 'salidas'}
                  </>
                }
                extremo={<p className="font-medium tabular-nums">{format(f.total)}</p>}
              />
            ))}
          </Lista>
        </section>
      )}

      {porProveedor.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">A quién se le pagó</h2>
          <p className="max-w-prose text-sm text-muted">
            La misma salida que arriba, mirada por el otro lado: la categoría dice en qué se fue y
            esto dice a quién. Un gasto anotado como movimiento suelto no tiene proveedor, así que
            queda junto en su propio grupo.
          </p>
          <Lista>
            {porProveedor.map((f) => (
              <Fila
                key={`${f.moneda}-${f.clave}`}
                principal={
                  <>
                    <span className="font-medium">{f.nombre}</span>
                    <Etiqueta>{f.moneda}</Etiqueta>
                  </>
                }
                secundario={
                  <>
                    {f.hechos} {f.hechos === 1 ? 'compra o salida' : 'compras o salidas'}
                  </>
                }
                extremo={<p className="font-medium tabular-nums">{format(f.total)}</p>}
              />
            ))}
          </Lista>
        </section>
      )}

      {aparte.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Fuera del resultado</h2>
          <p className="max-w-prose text-sm text-muted">
            Movimientos que no son del negocio. Están aquí porque pasaron, y no están arriba porque
            llamarlos gasto o ingreso haría que el resultado dejara de significar lo que significa.
          </p>
          <Lista>
            {aparte.map((h) => (
              <Fila
                key={`${h.concepto}-${h.fecha}-${String(h.amount_total)}`}
                principal={
                  <>
                    <span className="font-medium">{h.concepto}</span>
                    {h.kind && <Etiqueta>{nombreTipoMovimiento(h.kind)}</Etiqueta>}
                  </>
                }
                secundario={<>{formatoFecha(h.fecha)}</>}
                extremo={
                  <p className="font-medium tabular-nums">
                    {h.direction === 'in' ? '+' : '−'}
                    {format(fromRow(h.amount_total, currencyOf(h.currency_code)))}
                  </p>
                }
              />
            ))}
          </Lista>
        </section>
      )}

      {hechos.length > 0 && (
        <p className="max-w-prose text-xs text-muted">
          Lo que todavía no está aquí: cuánto deja cada servicio. El margen de una cotización ya se
          calcula y se ve al abrirla en Comercial, pero para llevarlo a este lente hace falta atar
          cada documento a las líneas de la versión que se aceptó, y eso llega con las compras —hoy
          un gasto no sabe a qué trabajo pertenece—.
        </p>
      )}

      {entidades.length > 1 && !entidad && (
        <p className="max-w-prose text-xs text-muted">
          Estás viendo las {entidades.length} empresas a la vez. Cada una tiene su propia
          contabilidad; elige una arriba para mirarla sola.
        </p>
      )}
    </Seccion>
  );
}
