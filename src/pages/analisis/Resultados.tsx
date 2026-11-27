import { useState } from 'react';
import { useHechosDelPeriodo } from '../../app/consultas';
import { useOrg, useOrgElegida, puedeEscribirDinero } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { currencyOf, format, fromRow } from '../../lib/money';
import { Aviso, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import Barras from './Barras';
import BarrasH from './BarrasH';
import { nombreTipoMovimiento } from '../finanzas/cartera';
import {
  fueraDelResultado,
  gastosPorCategoria,
  gastosPorProveedor,
  ingresosPorCliente,
  nombrePeriodo,
  rangoDe,
  resultadoPorMoneda,
  seriePorMes,
  type Fila as FilaDeResultado,
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

/**
 * Un grupo de barras por moneda.
 *
 * Por moneda y no todo junto porque soles y dólares no comparten escala: una
 * barra de 1.000 al lado de otra de 1.000 que valen cosas distintas es un
 * gráfico que miente sin decir una sola cifra falsa (INV-10).
 */
function PorGrupo({
  titulo,
  explica,
  filas,
  nota,
  destacarSobre,
}: {
  titulo: string;
  explica?: string;
  filas: readonly FilaDeResultado[];
  nota: (hechos: number) => string;
  destacarSobre?: number;
}) {
  if (filas.length === 0) return null;
  const monedas = [...new Set(filas.map((f) => f.moneda))];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">{titulo}</h2>
      {explica && <p className="max-w-prose text-sm text-muted">{explica}</p>}
      {monedas.map((moneda) => (
        <Tarjeta key={moneda} className="p-5">
          <BarrasH
            rotulo={titulo}
            moneda={moneda}
            destacarSobre={destacarSobre}
            filas={filas
              .filter((f) => f.moneda === moneda)
              .map((f) => ({
                clave: `${moneda}-${f.clave}`,
                nombre: f.nombre,
                total: f.total,
                nota: nota(f.hechos),
              }))}
          />
        </Tarjeta>
      ))}
    </section>
  );
}

export default function Resultados() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const conDinero = puedeEscribirDinero(organizacion.rol);

  const hoy = new Date().toISOString().slice(0, 10);
  const [periodo, setPeriodo] = useState<Periodo>('doce-meses');
  const rango = rangoDe(periodo, hoy);

  const datos = useHechosDelPeriodo({
    orgId: organizacion.id,
    entidadId: entidad?.id ?? null,
    desde: rango.desde,
    hasta: rango.hasta,
    habilitada: conDinero,
  });

  // La vista cuelga de las tablas del dinero, así que al rol comercial la base
  // no le devuelve ni una fila. Se lo explica en vez de dejar ceros, que
  // parecerían un negocio parado.
  if (!conDinero) {
    return (
      <Seccion
        titulo="Resultado"
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
  // La serie sale de los mismos hechos que las cifras de arriba, así que la
  // suma de los meses es el total de la tarjeta por construcción. Calcularla
  // con otra consulta sería tener dos cifras que un día discrepan.
  const series = seriePorMes(hechos, rango.desde, rango.hasta);

  return (
    <Seccion
      titulo="Resultado"
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

          {/* El gráfico va dentro de la tarjeta de su moneda, no aparte: una
              serie sin moneda al lado es una serie que se puede leer mal. */}
          <div className="mt-5 border-t border-border pt-5">
            <h3 className="mb-3 text-xs uppercase tracking-widest text-subtle">Mes a mes</h3>
            {(() => {
              const serie = series.find((x) => x.moneda === r.moneda);
              return serie ? <Barras serie={serie} /> : null;
            })()}
          </div>

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

      {/*
        Las tres preguntas de «¿de dónde vino y en qué se fue?», en barras y
        no en listas de números. La lista tenía todo el dato y aun así no se
        podía leer: «visualmente no acompaña, me pierdo con la información».
        Una barra contesta de un vistazo quién es el primero y cuánto le saca
        al segundo, que es lo que se mira. La tabla sigue estando, dentro de
        cada gráfico.
      */}
      <PorGrupo
        titulo="De dónde vino el ingreso"
        filas={porCliente}
        nota={(n) => `${n} ${n === 1 ? 'documento o cobro' : 'documentos o cobros'}`}
        // Medio total en un solo cliente es el riesgo que nadie mira hasta
        // que ese cliente se va.
        destacarSobre={50}
      />

      <PorGrupo
        titulo="En qué se fue"
        filas={porCategoria}
        nota={(n) => `${n} ${n === 1 ? 'salida' : 'salidas'}`}
      />

      <PorGrupo
        titulo="A quién se le pagó"
        explica="La misma salida que arriba, mirada por el otro lado: la categoría dice en qué se fue y esto dice a quién. Un gasto anotado como movimiento suelto no tiene proveedor, así que queda junto en su propio grupo."
        filas={porProveedor}
        nota={(n) => `${n} ${n === 1 ? 'compra o salida' : 'compras o salidas'}`}
      />

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
