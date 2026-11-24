import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeEscribirDinero, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoTasa } from '../../lib/format';
import { format, type Money } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import {
  conCostoYSinFacturar,
  conMargen,
  nombreEstadoDeTrabajo,
  resumenPorMoneda,
  resumenPorServicio,
  seComenElMargen,
  type MargenEnBase,
  type ResumenDeServicio,
  type TrabajoEnBase,
} from './trabajo';

/**
 * Cuánto deja cada trabajo: la pregunta con la que empezó el producto.
 *
 * Las dos cifras que ya existían no la contestaban. El margen de una
 * cotización dice lo que **prometía** la propuesta, y el resultado del mes
 * dice lo que pasó con **todo junto**. Un trabajo rentable que se cobra en
 * enero y se paga en marzo deja un enero magnífico y un marzo malo, y
 * ninguno de los dos meses dice nada del trabajo.
 *
 * Aquí se comparan dos márgenes sobre el mismo precio acordado —el cotizado y
 * el real—, así que la diferencia entre ellos es una cifra que significa
 * algo: cuántos puntos se está comiendo el trabajo mientras se hace.
 *
 * La atribución de los costos no se hace en esta pantalla a propósito: se
 * hace donde se anota el gasto —en Finanzas, al anotar la compra o el
 * movimiento—, que es el único momento en que alguien se acuerda de para qué
 * era.
 */

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

/** «45 % → 28 %», y los puntos de diferencia con su signo. */
function Desvio({ resumen }: { resumen: Pick<ResumenDeServicio, 'margenCotizado' | 'margenReal' | 'desvio'> }) {
  const { margenCotizado, margenReal, desvio } = resumen;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {margenCotizado === null ? '—' : formatoTasa(margenCotizado)}
      <span className="mx-1 text-subtle">→</span>
      <span className={desvio !== null && desvio < 0 ? 'text-warning' : 'text-positive'}>
        {margenReal === null ? '—' : formatoTasa(margenReal)}
      </span>
      {desvio !== null && Math.abs(desvio) >= 0.005 && (
        <span className="ml-2 text-xs text-muted">
          {desvio > 0 ? '+' : '−'}
          {formatoTasa(Math.abs(desvio)).replace(' %', '')} pts
        </span>
      )}
    </span>
  );
}

function Ajenos({ costos }: { costos: readonly { moneda: string; costo: Money }[] }) {
  if (costos.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-warning">
      Además hay costos en otra moneda, sin convertir:{' '}
      {costos.map((c) => format(c.costo, { showCode: true })).join(' · ')}. No entran en el margen
      de arriba: convertirlos en silencio daría un margen que cambia con el tipo de cambio del
      día.
    </p>
  );
}

export default function Trabajos() {
  const { organizacion, entidad } = useOrgElegida();
  const { elegirEntidad } = useOrg();
  const conDinero = puedeEscribirDinero(organizacion.rol);
  const recargar = useRecargar(['trabajos', 'compras', 'movimientos']);

  const [verCerrados, setVerCerrados] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [estado, setEstado] = useState('open');

  const datos = useQuery({
    queryKey: ['trabajos', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      const cliente = requireSupabase();

      let q = cliente
        .from('jobs')
        .select(
          'id, name, client_id, service_id, quote_id, currency_code, price_net, quote_net, expected_cost, status, notes, created_at',
        )
        .eq('organization_id', organizacion.id)
        .order('created_at', { ascending: false });
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data: trabajos, error } = await q;
      if (error) throw error;

      let m = cliente
        .from('job_margins')
        .select('job_id, currency_code, ingreso_neto, costo_neto, documentos, costos')
        .eq('organization_id', organizacion.id);
      if (entidad) m = m.eq('legal_entity_id', entidad.id);
      const { data: cifras, error: e2 } = await m;
      if (e2) throw e2;

      const { data: clientes, error: e3 } = await cliente
        .from('clients')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e3) throw e3;

      const { data: servicios, error: e4 } = await cliente
        .from('services')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e4) throw e4;

      return {
        trabajos: (trabajos ?? []) as unknown as TrabajoEnBase[],
        cifras: (cifras ?? []) as unknown as MargenEnBase[],
        clientes: new Map((clientes ?? []).map((c) => [c.id, c.name])),
        servicios: new Map((servicios ?? []).map((s) => [s.id, s.name])),
      };
    },
  });

  const guardar = useMutation({
    mutationFn: async (job: string) => {
      const { error } = await requireSupabase().rpc('actualizar_trabajo', {
        p_job: job,
        p_status: estado,
        ...(nombre.trim() ? { p_name: nombre.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEditando(null);
      setNombre('');
      recargar();
    },
  });

  // El lente cuelga de `jobs` y de las tablas del dinero, así que al rol
  // comercial la base no le devuelve ni una fila. Se lo explica en vez de
  // dejar ceros, que parecerían un negocio sin margen.
  if (!conDinero) {
    return (
      <Seccion
        titulo="Trabajos"
        regla="Un trabajo es una línea de una cotización aprobada, con el precio y el costo estimado congelados el día que el cliente aceptó."
      >
        <Vacio
          titulo="Esta sección es de finanzas"
          explicacion="Tu rol en esta organización es comercial. El margen real de un trabajo se calcula sobre las compras y los gastos, y esas tablas no te las enseña la base de datos."
          siguiente="El margen que prometía cada propuesta sí es tuyo: está en Comercial, al abrir la cotización."
        />
      </Seccion>
    );
  }

  const todos = conMargen(datos.data?.trabajos ?? [], datos.data?.cifras ?? []);
  const visibles = verCerrados ? todos : todos.filter((t) => t.estado === 'open');
  const porServicio = resumenPorServicio(todos);
  const conjunto = resumenPorMoneda(todos);
  const comiendo = seComenElMargen(todos);
  const sinFacturar = conCostoYSinFacturar(todos);
  const nombreServicio = (id: string | null) =>
    id === null ? 'Sin servicio del catálogo' : (datos.data?.servicios.get(id) ?? 'Servicio quitado');

  return (
    <Seccion
      titulo="Trabajos"
      regla="Un trabajo es una línea de una cotización aprobada. Guarda el precio acordado y el costo que estaba estimado ese día, y ninguno de los dos se edita después: es lo que permite decir «cotizaste 45 % y te está dejando 28 %» y que la frase signifique algo."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      {datos.isLoading && <Cargando que="los trabajos" />}
      {datos.error && <Aviso tipo="error">{mensajeDeError(datos.error)}</Aviso>}
      {guardar.error && <Aviso tipo="error">{mensajeDeError(guardar.error)}</Aviso>}

      {!datos.isLoading && todos.length === 0 && (
        <Vacio
          titulo="Todavía no hay ningún trabajo"
          explicacion="Los trabajos no se crean a mano: cada línea de una cotización se vuelve un trabajo el día que el cliente la acepta. Así el margen tiene un precio acordado con el que compararse, y no uno que alguien pudo teclear después."
          siguiente="Aprueba una cotización en Pipeline y sus líneas aparecerán aquí."
        />
      )}

      {conjunto.map((r) => (
        <Tarjeta key={`todo-${r.moneda}`} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">El conjunto · {r.moneda}</h2>
            <Etiqueta>{r.cuantos === 1 ? '1 trabajo' : `${r.cuantos} trabajos`}</Etiqueta>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-4">
            <Cifra rotulo="Acordado" valor={format(r.acordado)} nota="Neto, sin impuesto" />
            <Cifra rotulo="Costo estimado" valor={format(r.estimado)} nota="Lo que decía la cotización" />
            <Cifra
              rotulo="Costo real"
              valor={format(r.costo)}
              nota="Compras y gastos atribuidos"
              {...(r.costo.minor > r.estimado.minor ? { tono: 'atencion' as const } : {})}
            />
            <Cifra
              rotulo="Deja"
              valor={format(r.utilidad)}
              nota={
                r.margenReal === null
                  ? 'Sin precio acordado, no hay porcentaje'
                  : `${formatoTasa(r.margenReal)} sobre lo acordado`
              }
              {...(r.utilidad.minor > 0n ? { tono: 'positivo' as const } : {})}
            />
          </div>
          <p className="mt-4 text-sm text-muted">
            Cotizado <Desvio resumen={r} />
          </p>
          <Ajenos costos={r.costosAjenos} />
          <p className="mt-3 max-w-prose text-xs text-subtle">
            Los cancelados no entran: su precio acordado no se va a facturar, y meterlos aquí
            hundiría el margen con dinero que nadie perdió.
          </p>
        </Tarjeta>
      ))}

      {comiendo.length > 0 && (
        <Tarjeta className="p-5">
          <h2 className="font-medium">Se están comiendo el margen</h2>
          <p className="mb-4 mt-2 max-w-prose text-sm text-muted">
            No son los de margen bajo: un trabajo cotizado al 15 % que cuesta lo previsto está
            bien. Estos cuestan más de lo que se estimó, y el peor va primero.
          </p>
          <Lista>
            {comiendo.slice(0, 5).map((t) => (
              <Fila
                key={t.id}
                principal={
                  <>
                    <span className="font-medium">{t.nombre}</span>
                    <Etiqueta tono="atencion">
                      {t.desvio === null ? '—' : `${formatoTasa(t.desvio)} pts`}
                    </Etiqueta>
                  </>
                }
                secundario={
                  <>
                    Estimaste {format(t.estimado)} y va por {format(t.costo)} sobre{' '}
                    {format(t.acordado)} acordados.
                  </>
                }
                extremo={<Desvio resumen={t} />}
              />
            ))}
          </Lista>
          {comiendo.length > 5 && (
            <p className="mt-3 text-xs text-muted">Y {comiendo.length - 5} más en la lista de abajo.</p>
          )}
        </Tarjeta>
      )}

      {sinFacturar.length > 0 && (
        <Aviso tipo="atencion">
          {sinFacturar.length === 1
            ? `«${sinFacturar[0]!.nombre}» ya cuesta ${format(sinFacturar[0]!.costo)} y no tiene ni una factura emitida.`
            : `Hay ${sinFacturar.length} trabajos que ya cuestan dinero y no tienen ni una factura emitida.`}{' '}
          El costo es de hoy y el cobro no está ni empezado: es el orden que vacía la caja de un
          negocio rentable. La factura se emite en Finanzas → Caja, desde la cuota prevista.
        </Aviso>
      )}

      {porServicio.length > 0 && (
        <Tarjeta className="p-5">
          <h2 className="font-medium">Cuánto deja cada servicio</h2>
          <p className="mb-4 mt-2 max-w-prose text-sm text-muted">
            El margen de un grupo es Σ utilidad ÷ Σ acordado, nunca el promedio de los
            porcentajes: dos trabajos al 10 % y al 50 % no dejan 30 % si el primero es diez veces
            mayor.
          </p>
          <Lista>
            {porServicio.map((r) => (
              <Fila
                key={`${r.servicioId ?? 'sin'}-${r.moneda}`}
                principal={
                  <>
                    <span className="font-medium">{nombreServicio(r.servicioId)}</span>
                    <Etiqueta>{r.moneda}</Etiqueta>
                    <Etiqueta>{r.cuantos === 1 ? '1 trabajo' : `${r.cuantos} trabajos`}</Etiqueta>
                  </>
                }
                secundario={
                  <>
                    {format(r.acordado)} acordados, {format(r.costo)} de costo real, deja{' '}
                    {format(r.utilidad)}.
                    <Ajenos costos={r.costosAjenos} />
                  </>
                }
                extremo={<Desvio resumen={r} />}
              />
            ))}
          </Lista>
        </Tarjeta>
      )}

      {todos.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              {verCerrados ? 'Todos los trabajos' : 'Los trabajos en curso'}
            </h2>
            <Boton variante="sutil" onClick={() => setVerCerrados((v) => !v)}>
              {verCerrados ? 'Ver solo los que están en curso' : 'Ver también los cerrados'}
            </Boton>
          </div>

          {visibles.length === 0 ? (
            <p className="text-sm text-muted">
              Ningún trabajo en curso. Los terminados y los cancelados siguen ahí.
            </p>
          ) : (
            <Lista>
              {visibles.map((t) => (
                <Fila
                  key={t.id}
                  principal={
                    <>
                      <span className="font-medium">{t.nombre}</span>
                      <Etiqueta tono={t.estado === 'done' ? 'positivo' : 'neutro'}>
                        {nombreEstadoDeTrabajo(t.estado)}
                      </Etiqueta>
                      {t.servicioId && <Etiqueta>{nombreServicio(t.servicioId)}</Etiqueta>}
                    </>
                  }
                  secundario={
                    <>
                      {datos.data?.clientes.get(t.clienteId) ?? 'Cliente quitado'} ·{' '}
                      {format(t.acordado)} acordados · {format(t.costo)} de costo
                      {t.cuantosCostos > 0 &&
                        ` en ${t.cuantosCostos === 1 ? '1 apunte' : `${t.cuantosCostos} apuntes`}`}
                      <br />
                      Facturado {format(t.facturado)}
                      {t.porFacturar.minor > 0n && `, quedan ${format(t.porFacturar)} por facturar`}
                      .{' '}
                      {t.estado === 'cancelled' && (
                        <span className="text-muted">
                          Cancelado: no se le calcula margen, porque su precio acordado ya no se va
                          a facturar.
                        </span>
                      )}
                      <Ajenos costos={t.costosAjenos} />
                    </>
                  }
                  extremo={
                    <>
                      <Desvio resumen={t} />
                      <Boton
                        variante="sutil"
                        onClick={() => {
                          setEditando(editando === t.id ? null : t.id);
                          setNombre(t.nombre);
                          setEstado(t.estado);
                        }}
                      >
                        {editando === t.id ? 'Dejarlo' : 'Cambiar'}
                      </Boton>
                    </>
                  }
                />
              ))}
            </Lista>
          )}

          {editando && (
            <Alta
              titulo={`Cambiar «${todos.find((t) => t.id === editando)?.nombre ?? ''}»`}
              onSubmit={() => guardar.mutate(editando)}
            >
              <Campo
                etiqueta="Nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                ayuda="El que viene de la línea de la cotización. Cambiarlo aquí no toca la cotización."
              />
              <Selector
                etiqueta="Estado"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                ayuda="Terminado deja de pedir atención sin dejar de contar: una factura que llegue tarde seguirá sumando a su costo. Cancelado lo saca del margen por servicio."
              >
                <option value="open">En curso</option>
                <option value="done">Terminado</option>
                <option value="cancelled">Cancelado</option>
              </Selector>
              <p className="max-w-prose text-xs text-subtle">
                El precio acordado y el costo estimado no se pueden cambiar desde ninguna
                pantalla. Son la foto del día que se aprobó, y editarlos convertiría «cotizaste
                45 %» en una cifra que se acomoda al resultado.
              </p>
              <div>
                <Boton variante="primario" type="submit" disabled={guardar.isPending}>
                  {guardar.isPending ? 'Guardando…' : 'Guardar'}
                </Boton>
              </div>
            </Alta>
          )}
        </div>
      )}

      {todos.length > 0 && (
        <p className="max-w-prose text-xs text-subtle">
          Lo facturado se reparte entre las líneas de la cotización tal como se aprobaron, así que
          los céntimos de los trabajos de una misma cotización pueden no sumar exactamente su
          factura. El resultado del periodo no se calcula desde aquí: sale de los hechos
          económicos, donde los céntimos cuadran. Y falta una pieza: un trabajo todavía no sabe
          cuántas horas se le fueron, solo cuánto dinero.
        </p>
      )}
    </Seccion>
  );
}
