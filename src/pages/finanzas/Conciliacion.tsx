import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeEscribirDinero, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { currencyOf, format, fromRow } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import type { Json } from '../../types/database';
import {
  aLineas,
  adivinarMapeo,
  proponer,
  separarCsv,
  valoresDe,
  type LineaDelBanco,
  type Mapeo,
  type MovimientoDelLibro,
} from './extracto';

/**
 * Conciliar: cruzar lo que tú anotaste con lo que el banco dice que pasó.
 *
 * La regla que gobierna la pantalla entera es INV-8: **conciliar no crea
 * dinero.** Aquí no se puede anotar un movimiento, ni corregirlo, ni
 * borrarlo. Lo único que se escribe es «esta línea del banco es este
 * movimiento mío». Si desde aquí se pudiera arreglar el libro, el libro
 * siempre cuadraría con el banco y la comprobación no comprobaría nada.
 *
 * De ahí sale la forma de la pantalla: tres montones. Lo que cuadra, lo que
 * sobra del banco y lo que sobra del libro. El tercero es el que casi nunca
 * se mira y el que más dice: un cobro que diste por hecho y no llegó.
 */

type Paso = 'elegir' | 'mapear';

export default function Conciliacion() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const conDinero = puedeEscribirDinero(organizacion.rol);
  const recargar = useRecargar(['conciliacion', 'movimientos', 'saldos']);

  const [cuentaId, setCuentaId] = useState('');
  const [paso, setPaso] = useState<Paso>('elegir');
  const [texto, setTexto] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [mapeo, setMapeo] = useState<Mapeo | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [apartando, setApartando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [aMano, setAMano] = useState<{ linea: string; movimiento: string } | null>(null);
  const [anotando, setAnotando] = useState<string | null>(null);
  const [concepto, setConcepto] = useState('');
  const [categoria, setCategoria] = useState('');
  const [cerrarHasta, setCerrarHasta] = useState('');
  // Las dos categorías con las que entran las líneas que se traen en tanda.
  // Son opcionales: una categoría que se elige a desgana es peor que ninguna,
  // y sin ella el movimiento existe igual y se puede categorizar en Caja.
  const [categoriaGasto, setCategoriaGasto] = useState('');
  const [categoriaIngreso, setCategoriaIngreso] = useState('');
  const [verUnaPorUna, setVerUnaPorUna] = useState(false);
  // Aparte del de importar: cada mensaje se queda donde está el botón que
  // lo provocó, y los dos botones están en sitios distintos de la pantalla.
  const [exitoTanda, setExitoTanda] = useState<string | null>(null);

  const cuentas = useQuery({
    queryKey: ['cuentas', organizacion.id, 'para-conciliar'],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('cash_accounts')
        .select('id, name, currency_code, legal_entity_id, bank_name')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        // Las tarjetas también traen extracto, y el ciclo de una tarjeta es
        // justo donde más falta hace conciliar. Lo que no tiene extracto es
        // la caja chica y el monedero, y por eso quedan fuera.
        .in('kind', ['bank', 'card'])
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  const datos = useQuery({
    queryKey: ['conciliacion', organizacion.id, cuentaId],
    enabled: conDinero && cuentaId !== '',
    queryFn: async () => {
      const cliente = requireSupabase();

      const { data: extractos, error } = await cliente
        .from('bank_statements')
        .select('id, label, desde, hasta, lineas, imported_at')
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId)
        .order('hasta', { ascending: false });
      if (error) throw error;

      const { data: lineas, error: e2 } = await cliente
        .from('bank_statement_lines')
        .select(
          'id, statement_id, fila, value_date, direction, amount, description, external_ref, currency_code, ignored_reason',
        )
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId)
        .order('value_date');
      if (e2) throw e2;

      const { data: estados, error: e3 } = await cliente
        .from('bank_line_status')
        .select('line_id, emparejados, conciliado, cuadra')
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId);
      if (e3) throw e3;

      const { data: cierre, error: e0 } = await cliente
        .from('bank_reconciliations')
        .select('hasta, closed_at')
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId)
        .maybeSingle();
      if (e0) throw e0;

      const { data: categorias, error: e6 } = await cliente
        .from('financial_categories')
        .select('id, name, direction')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('sort');
      if (e6) throw e6;

      const { data: emparejados, error: e4 } = await cliente
        .from('bank_line_matches')
        .select('id, statement_line_id, cash_movement_id')
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId);
      if (e4) throw e4;

      // Los movimientos del rango que cubren los extractos, que son los
      // únicos que pueden corresponder a una línea.
      const desde = (extractos ?? []).reduce<string | null>(
        (a, e) => (a === null || e.desde < a ? e.desde : a),
        null,
      );
      const hasta = (extractos ?? []).reduce<string | null>(
        (a, e) => (a === null || e.hasta > a ? e.hasta : a),
        null,
      );

      let movimientos: MovimientoDelLibro[] = [];
      if (desde && hasta) {
        const { data: movs, error: e5 } = await cliente
          .from('cash_movements')
          .select('id, value_date, direction, amount, description, external_ref, currency_code, kind')
          .eq('organization_id', organizacion.id)
          .eq('cash_account_id', cuentaId)
          .eq('is_void', false)
          // Una semana de margen a cada lado: un cobro del 30 puede aparecer
          // en el extracto del 2.
          .gte('value_date', desplazar(desde, -7))
          .lte('value_date', desplazar(hasta, 7))
          .order('value_date');
        if (e5) throw e5;
        movimientos = (movs ?? []) as unknown as MovimientoDelLibro[];
      }

      return {
        cierre: cierre ?? null,
        categorias: categorias ?? [],
        extractos: extractos ?? [],
        lineas: (lineas ?? []) as unknown as (LineaDelBanco & {
          statement_id: string;
          fila: number;
          ignored_reason: string | null;
        })[],
        estados: new Map(
          (estados ?? []).map((e) => [e.line_id ?? '', { cuadra: e.cuadra ?? false, emparejados: e.emparejados ?? 0 }]),
        ),
        emparejados: emparejados ?? [],
        movimientos,
      };
    },
  });

  const importar = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      if (!mapeo) throw new Error('sin_mapeo: falta decir qué columna es cuál');
      const { lineas } = aLineas(separarCsv(texto), mapeo);
      const { error } = await requireSupabase().rpc('importar_extracto', {
        p_account: cuentaId,
        // Escribirlo es opcional; que exista, no. La base lo exige y tiene
        // razón —un extracto sin nombre no se reconoce dentro de seis meses—
        // pero el nombre se puede deducir del propio archivo, y una pregunta
        // que el programa sabe contestar no se le hace a nadie.
        p_label: etiqueta.trim() || nombreDelExtracto(lineas, cuenta?.name),
        // `LineaImportable` es JSON por construcción —texto, texto y un
        // objeto de textos— pero TypeScript no lo sabe sin una firma de
        // índice, y añadírsela haría que cualquier campo colara.
        p_lines: lineas as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(
        `Extracto importado. No se movió ni un céntimo del saldo: lo único que hay ahora es la lista del banco al lado de la tuya.`,
      );
      setTexto('');
      setEtiqueta('');
      setMapeo(null);
      setPaso('elegir');
      recargar();
    },
  });

  const emparejar = useMutation({
    mutationFn: async ({ linea, movimiento }: { linea: string; movimiento: string }) => {
      const { error } = await requireSupabase().rpc('emparejar_linea', {
        p_line: linea,
        p_movement: movimiento,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAMano(null);
      recargar();
    },
  });

  const desemparejar = useMutation({
    mutationFn: async (match: string) => {
      const { error } = await requireSupabase().rpc('desemparejar_linea', { p_match: match });
      if (error) throw error;
    },
    onSuccess: () => recargar(),
  });

  const anotarlo = useMutation({
    mutationFn: async (linea: string) => {
      const { error } = await requireSupabase().rpc('crear_movimiento_desde_linea', {
        p_line: linea,
        ...(concepto.trim() ? { p_description: concepto.trim() } : {}),
        ...(categoria ? { p_category: categoria } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAnotando(null);
      setConcepto('');
      setCategoria('');
      recargar();
    },
  });

  /*
    Las dos acciones en tanda.

    El extracto de un mes trae decenas de líneas, y la primera versión de esta
    pantalla pedía una decisión por cada una: la misma decisión, repetida
    veinticinco veces. Eso no es revisar, es teclear. Aquí se piden las dos
    preguntas que de verdad hay —«¿son los mismos?» y «¿los anoto?»— una sola
    vez para todas, y se deja la revisión de una en una para las dudosas, que
    son las únicas que la merecen.

    Van en bucle y no en una función de la base a propósito: cada línea se
    anota o se empareja en su propia transacción, así que un fallo a la mitad
    deja hechas las de antes y ninguna a medias. Lo que no puede pasar es que
    el fallo se calle, y por eso el mensaje dice cuántas iban.
  */
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);

  const confirmarTodas = useMutation({
    onMutate: () => setExitoTanda(null),
    mutationFn: async (pares: readonly { linea: string; movimiento: string }[]) => {
      const cliente = requireSupabase();
      let hechas = 0;
      setProgreso({ hechas, total: pares.length });
      for (const par of pares) {
        const { error } = await cliente.rpc('emparejar_linea', {
          p_line: par.linea,
          p_movement: par.movimiento,
        });
        if (error) throw new Error(cuantasIban(hechas, pares.length, mensajeDeError(error)));
        hechas += 1;
        setProgreso({ hechas, total: pares.length });
      }
      return hechas;
    },
    onSettled: () => setProgreso(null),
    onSuccess: (hechas) => {
      setExitoTanda(
        `${hechas === 1 ? 'Queda confirmada 1 línea' : `Quedan confirmadas ${hechas} líneas`}. No se movió ni un céntimo: emparejar solo deja escrito que esa línea del banco es ese movimiento tuyo.`,
      );
      recargar();
    },
  });

  const traerTodas = useMutation({
    onMutate: () => setExitoTanda(null),
    mutationFn: async (lineas: readonly { id: string; direction: string }[]) => {
      const cliente = requireSupabase();
      let hechas = 0;
      setProgreso({ hechas, total: lineas.length });
      for (const linea of lineas) {
        const cat = linea.direction === 'out' ? categoriaGasto : categoriaIngreso;
        const { error } = await cliente.rpc('crear_movimiento_desde_linea', {
          p_line: linea.id,
          ...(cat ? { p_category: cat } : {}),
        });
        if (error) throw new Error(cuantasIban(hechas, lineas.length, mensajeDeError(error)));
        hechas += 1;
        setProgreso({ hechas, total: lineas.length });
      }
      return hechas;
    },
    onSettled: () => setProgreso(null),
    onSuccess: (hechas) => {
      setExitoTanda(
        `${hechas === 1 ? 'Queda anotado 1 movimiento' : `Quedan anotados ${hechas} movimientos`}, con la fecha, el importe y el concepto que trae el banco. Eso sí cambia tu saldo: era dinero que se movió de verdad y no estaba apuntado. Revisa las categorías en Caja cuando puedas.`,
      );
      recargar();
    },
  });

  const cerrar = useMutation({
    mutationFn: async (hasta: string | null) => {
      const { error } = await requireSupabase().rpc('cerrar_conciliacion', {
        p_account: cuentaId,
        ...(hasta ? { p_hasta: hasta } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCerrarHasta('');
      recargar();
    },
  });

  const apartar = useMutation({
    mutationFn: async ({ linea, texto: razon }: { linea: string; texto: string | null }) => {
      const { error } = await requireSupabase().rpc('ignorar_linea', {
        p_line: linea,
        ...(razon ? { p_motivo: razon } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setApartando(null);
      setMotivo('');
      recargar();
    },
  });

  const cierre = datos.data?.cierre ?? null;
  const lineas = datos.data?.lineas ?? [];
  const estados = datos.data?.estados ?? new Map();
  // Memorizadas porque de ellas cuelga la propuesta, y recalcularla en cada
  // tecla del textarea de importar no tendría ningún sentido.
  const movimientos = useMemo(() => datos.data?.movimientos ?? [], [datos.data]);
  const matches = useMemo(() => datos.data?.emparejados ?? [], [datos.data]);

  const yaConciliados = useMemo(
    () => new Set(matches.map((m) => m.cash_movement_id)),
    [matches],
  );

  const cuadradas = lineas.filter((l) => estados.get(l.id)?.cuadra);
  const apartadas = lineas.filter((l) => l.ignored_reason !== null);
  const pendientes = lineas.filter(
    (l) => !estados.get(l.id)?.cuadra && l.ignored_reason === null,
  );
  const sueltos = movimientos.filter((m) => !yaConciliados.has(m.id));
  // Lo anterior al cierre ya no pide atención; lo que sobra del libro sí
  // sigue a la vista, porque sigue sin explicación (INV-8.8.8).
  const pendientesVivas = cierre ? pendientes.filter((l) => l.value_date > cierre.hasta) : pendientes;
  const sueltosViejos = cierre ? sueltos.filter((m) => m.value_date <= cierre.hasta) : [];

  const propuestas = useMemo(
    () => proponer(pendientes, movimientos, yaConciliados),
    [pendientes, movimientos, yaConciliados],
  );
  const propuestaDe = (linea: string) => propuestas.find((p) => p.lineaId === linea);
  const movimientoDe = (id: string) => movimientos.find((m) => m.id === id);

  /*
    Los tres grupos de las que faltan, y la frontera entre ellos es lo único
    delicado de esta pantalla.

    · `aConfirmar`: el banco dice lo mismo que tú ya tenías apuntado —mismo
      importe, mismo día o la misma referencia—. Eso no se anota: se empareja,
      porque el movimiento ya existe. Anotarlo lo duplicaría, y un duplicado
      en el libro de caja es peor que una línea sin explicar.
    · `aTraer`: el banco lo tiene y tú no tienes nada que se le parezca. Son
      las que se anotan, y son las que de verdad faltaban.
    · `dudosas`: se parecen a un movimiento tuyo, pero con otra fecha. Esas no
      entran en ninguna tanda. Son las que hay que mirar una por una, y por eso
      la lista de abajo sigue existiendo.
  */
  const aConfirmar = pendientesVivas.flatMap((l) => {
    const p = propuestaDe(l.id);
    return p && p.confianza === 'exacta' ? [{ linea: l.id, movimiento: p.movimientoId }] : [];
  });
  const dudosas = pendientesVivas.filter((l) => propuestaDe(l.id)?.confianza === 'probable');
  const aTraer = pendientesVivas.filter((l) => !propuestaDe(l.id));

  if (!conDinero) {
    return (
      <Seccion
        titulo="Conciliación"
        regla="Cruzar lo que anotaste con lo que el banco dice que pasó."
      >
        <Vacio
          titulo="Esta sección es de finanzas"
          explicacion="Tu rol en esta organización es comercial. El libro de caja y los extractos no te los enseña la base de datos."
          siguiente="Las cotizaciones sí son tuyas: están en Comercial."
        />
      </Seccion>
    );
  }

  const cuenta = (cuentas.data ?? []).find((c) => c.id === cuentaId);
  const moneda = cuenta ? currencyOf(cuenta.currency_code) : null;
  const importe = (valor: string | number) =>
    moneda ? format(fromRow(valor, moneda)) : String(valor);

  return (
    <Seccion
      titulo="Conciliación"
      regla="El banco sabe lo que pasó; tú sabes lo que anotaste. Esto cruza las dos listas y te dice qué falta en cada una."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      <Selector
        etiqueta="Qué cuenta"
        ayuda="Las cuentas de banco y las tarjetas, que son las que traen extracto. La caja chica no."
        value={cuentaId}
        onChange={(e) => {
          setCuentaId(e.target.value);
          setPaso('elegir');
          setTexto('');
          setMapeo(null);
        }}
      >
        <option value="">Elige una cuenta</option>
        {(cuentas.data ?? [])
          .filter((c) => !entidad || c.legal_entity_id === entidad.id)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.currency_code}
              {entidades.length > 1
                ? ` · ${entidades.find((x) => x.id === c.legal_entity_id)?.legal_name ?? ''}`
                : ''}
            </option>
          ))}
      </Selector>

      {cuentaId === '' && (
        <Vacio
          titulo="Elige una cuenta para empezar"
          explicacion="Cada cuenta tiene su propio extracto y su propia conciliación. Cruzar el extracto del BCP con los movimientos de Mercury no significaría nada, y la base lo impide."
          siguiente="Arriba, elige la cuenta cuyo extracto vas a importar."
        />
      )}

      {datos.isPending && cuentaId !== '' && <Cargando que="la conciliación" />}
      {datos.error && <Aviso tipo="error">{mensajeDeError(datos.error)}</Aviso>}
      {emparejar.error && <Aviso tipo="error">{mensajeDeError(emparejar.error)}</Aviso>}
      {desemparejar.error && <Aviso tipo="error">{mensajeDeError(desemparejar.error)}</Aviso>}
      {apartar.error && <Aviso tipo="error">{mensajeDeError(apartar.error)}</Aviso>}
      {anotarlo.error && <Aviso tipo="error">{mensajeDeError(anotarlo.error)}</Aviso>}
      {cerrar.error && <Aviso tipo="error">{mensajeDeError(cerrar.error)}</Aviso>}
      {confirmarTodas.error && <Aviso tipo="error">{mensajeDeError(confirmarTodas.error)}</Aviso>}
      {traerTodas.error && <Aviso tipo="error">{mensajeDeError(traerTodas.error)}</Aviso>}

      {/* --------------------------------------------------- qué falta hacer */}
      {cuentaId !== '' && lineas.length > 0 && (
        <Tarjeta className="p-5">
          <h2 className="font-medium">
            {pendientesVivas.length === 0
              ? 'El banco y tu libro dicen lo mismo'
              : `Faltan ${pendientesVivas.length} ${pendientesVivas.length === 1 ? 'línea' : 'líneas'} por explicar`}
          </h2>

          {pendientesVivas.length === 0 ? (
            <p className="mt-2 max-w-prose text-sm text-muted">
              Cada línea del extracto tiene su movimiento, o está apartada con su motivo. Eso es
              estar cuadrado: ya se puede cerrar hasta la fecha del extracto.
            </p>
          ) : (
            <p className="mt-2 max-w-prose text-sm text-muted">
              De las {lineas.length} del extracto, {cuadradas.length}{' '}
              {cuadradas.length === 1 ? 'ya cuadra' : 'ya cuadran'}. Lo que queda se resuelve de
              dos formas, y la diferencia importa: lo que ya tenías apuntado se confirma, y lo que
              no tenías se anota.
            </p>
          )}

          {exitoTanda && (
            <div className="mt-4">
              <Aviso tipo="exito">{exitoTanda}</Aviso>
            </div>
          )}

          {progreso && (
            <p role="status" className="mt-4 text-sm text-muted">
              Van {progreso.hechas} de {progreso.total}…
            </p>
          )}

          {aConfirmar.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-sm font-medium">
                {aConfirmar.length === 1
                  ? '1 línea es un movimiento que ya tenías'
                  : `${aConfirmar.length} líneas son movimientos que ya tenías`}
              </h3>
              <p className="mt-1 max-w-prose text-sm text-muted">
                Mismo importe y el mismo día, o la misma referencia del banco. Confirmarlas no
                mueve dinero ni crea nada: deja escrito que esa línea es ese movimiento. Anotarlas
                en vez de confirmarlas sería duplicar tu propio gasto.
              </p>
              <Boton
                variante="primario"
                className="mt-3"
                disabled={confirmarTodas.isPending || traerTodas.isPending}
                onClick={() => confirmarTodas.mutate(aConfirmar)}
              >
                {confirmarTodas.isPending
                  ? 'Confirmando…'
                  : `Confirmar ${aConfirmar.length === 1 ? 'la línea' : `las ${aConfirmar.length}`}`}
              </Boton>
            </div>
          )}

          {aTraer.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-sm font-medium">
                {aTraer.length === 1
                  ? '1 línea no es ningún movimiento tuyo'
                  : `${aTraer.length} líneas no son ningún movimiento tuyo`}
              </h3>
              <p className="mt-1 max-w-prose text-sm text-muted">
                El dinero se movió de verdad y no está en tu libro: comisiones, cargos de la
                tarjeta, un cobro que entró sin que lo apuntaras. Traerlas las anota con la fecha,
                el importe y el concepto del banco. <strong>Esto sí cambia tu saldo</strong>, y es
                la única cosa de esta pantalla que lo cambia.
              </p>
              {/*
                El aviso que hace falta en Mercury y en cualquier banco con
                varias cuentas propias. Un traspaso entre dos cuentas tuyas
                aparece en el extracto como un gasto, y traído así sería un
                gasto de la empresa: el resultado del mes saldría peor de lo
                que fue y el dinero seguiría estando. Un traspaso se anota
                entero, con sus dos lados, y eso se hace en Caja (INV-5).
              */}
              <p className="mt-2 max-w-prose text-sm text-warning">
                Antes de darle: si entre esas líneas hay traspasos entre tus propias cuentas,
                apártalas primero en el detalle. Traídas desde aquí entrarían como gasto o
                ingreso de la empresa, y un traspaso no es ni una cosa ni la otra. Esos se anotan
                enteros, con sus dos lados, en Caja → Transferencia.
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {aTraer.some((l) => l.direction === 'out') && (
                  <Selector
                    etiqueta="Categoría para los gastos"
                    ayuda="Opcional. Si la dejas vacía entran sin categoría y la pones luego en Caja."
                    value={categoriaGasto}
                    onChange={(e) => setCategoriaGasto(e.target.value)}
                  >
                    <option value="">Sin categoría</option>
                    {(datos.data?.categorias ?? [])
                      .filter((c) => c.direction === 'out' || c.direction === 'both')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Selector>
                )}
                {aTraer.some((l) => l.direction === 'in') && (
                  <Selector
                    etiqueta="Categoría para los ingresos"
                    ayuda="Opcional, igual que la de gastos."
                    value={categoriaIngreso}
                    onChange={(e) => setCategoriaIngreso(e.target.value)}
                  >
                    <option value="">Sin categoría</option>
                    {(datos.data?.categorias ?? [])
                      .filter((c) => c.direction === 'in' || c.direction === 'both')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Selector>
                )}
              </div>

              <Boton
                variante="primario"
                className="mt-3"
                disabled={confirmarTodas.isPending || traerTodas.isPending}
                onClick={() => traerTodas.mutate(aTraer)}
              >
                {traerTodas.isPending
                  ? 'Anotando…'
                  : `Traer ${aTraer.length === 1 ? 'la línea' : `las ${aTraer.length}`} al libro`}
              </Boton>
            </div>
          )}

          {dudosas.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-sm font-medium">
                {dudosas.length === 1
                  ? '1 línea se parece a un movimiento tuyo, pero no es seguro'
                  : `${dudosas.length} líneas se parecen a movimientos tuyos, pero no es seguro`}
              </h3>
              <p className="mt-1 max-w-prose text-sm text-muted">
                Mismo importe, otra fecha. Puede ser el mismo pago contado con unos días de
                diferencia, o pueden ser dos cosas distintas que valen lo mismo. Eso no lo decide
                un programa: míralas una por una.
              </p>
              <Boton className="mt-3" onClick={() => setVerUnaPorUna(true)}>
                Verlas una por una
              </Boton>
            </div>
          )}

          {/*
            El tercer montón, el del otro lado. Antes era una cifra en una
            tarjeta aparte que no decía qué hacer con ella; está aquí porque
            es el que más dice y el que nadie mira.
          */}
          {sueltos.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-sm font-medium">
                {sueltos.length === 1
                  ? '1 movimiento tuyo no está en el extracto'
                  : `${sueltos.length} movimientos tuyos no están en el extracto`}
              </h3>
              <p className="mt-1 max-w-prose text-sm text-muted">
                Los anotaste y el banco no los tiene. Es el montón que nadie mira y el que más
                dice: un cobro que diste por hecho y no llegó, un cheque que no se depositó, algo
                anotado dos veces. Esto no se arregla desde aquí —el libro se corrige en Caja—
                pero sabes dónde mirar.
              </p>
            </div>
          )}

          <details className="mt-5 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm text-muted">
              Por qué esta pantalla no arregla el libro
            </summary>
            <p className="mt-2 max-w-prose text-sm text-muted">
              Desde aquí no se puede corregir ni borrar un movimiento que ya existía. Si se
              pudiera, el libro siempre cuadraría con el banco y la comprobación no comprobaría
              nada: lo que descuadra es precisamente lo que hay que ir a mirar. Lo único que crea
              un movimiento es traer una línea al libro, y lo pides tú.
            </p>
          </details>
        </Tarjeta>
      )}

      {/* ------------------------------------------------------- el detalle */}
      {/*
        La lista entera, línea por línea, con todo lo que se puede hacer con
        una: emparejarla con otro movimiento, apartarla con su motivo,
        anotarla sola. Está cerrada por defecto desde que las dos tandas de
        arriba resuelven el caso normal: abierta de entrada, lo primero que se
        veía al importar un mes eran treinta filas pidiendo una decisión cada
        una, y eso no se lee, se abandona.
      */}
      {cuentaId !== '' && lineas.length > 0 && !verUnaPorUna && (
        <div>
          <Boton onClick={() => setVerUnaPorUna(true)}>Ver el detalle, línea por línea</Boton>
        </div>
      )}

      {verUnaPorUna && (
        <>
      {/* ------------------------------------------------ sobra del banco */}
      {pendientesVivas.length > 0 && (
        <Tarjeta className="p-5">
          <h2 className="font-medium">Las que faltan en tu libro</h2>
          <p className="mb-4 mt-2 max-w-prose text-sm text-muted">
            Líneas del extracto que todavía no son ningún movimiento tuyo. Casi siempre son gastos
            que no anotaste: comisiones, cargos, una domiciliación. Cuando una no es tuya —o la
            dejas para después— se aparta con el motivo escrito y sale de aquí sin borrarse.
          </p>
          <Lista>
            {pendientesVivas.map((l) => {
              const p = propuestaDe(l.id);
              const sugerido = p ? movimientoDe(p.movimientoId) : undefined;
              return (
                <Fila
                  key={l.id}
                  principal={
                    <>
                      <span className="font-medium">{l.description}</span>
                      <Etiqueta tono={l.direction === 'in' ? 'positivo' : 'neutro'}>
                        {l.direction === 'in' ? 'entró' : 'salió'}
                      </Etiqueta>
                      {estados.get(l.id)?.emparejados ? (
                        <Etiqueta tono="atencion">emparejada a medias</Etiqueta>
                      ) : null}
                    </>
                  }
                  secundario={
                    <>
                      {formatoFecha(l.value_date)} · {importe(l.amount)}
                      {l.external_ref ? ` · ${l.external_ref}` : ''}
                      {sugerido && p && (
                        <>
                          <br />
                          <span className="text-text">
                            Parece «{sugerido.description}» del {formatoFecha(sugerido.value_date)}
                          </span>
                          <span className="text-muted"> · {p.porque}</span>
                        </>
                      )}
                    </>
                  }
                  extremo={
                    <>
                      {sugerido && p && (
                        <Boton
                          variante="primario"
                          disabled={emparejar.isPending}
                          onClick={() =>
                            emparejar.mutate({ linea: l.id, movimiento: p.movimientoId })
                          }
                        >
                          {p.confianza === 'exacta' ? 'Es ese' : 'Sí, es ese'}
                        </Boton>
                      )}
                      <Boton onClick={() => setAMano({ linea: l.id, movimiento: '' })}>
                        Elegir yo
                      </Boton>
                      <Boton
                        onClick={() => {
                          setAnotando(l.id);
                          setConcepto(l.description);
                          setCategoria('');
                        }}
                      >
                        Anotarlo
                      </Boton>
                      <Boton
                        variante="sutil"
                        onClick={() => {
                          setApartando(l.id);
                          setMotivo('');
                        }}
                      >
                        Apartar
                      </Boton>
                    </>
                  }
                />
              );
            })}
          </Lista>
        </Tarjeta>
      )}

      {/* ------------------------------------- elegir el movimiento a mano */}
      {aMano &&
        (() => {
          const linea = lineas.find((l) => l.id === aMano.linea);
          if (!linea) return null;
          const posibles = movimientos.filter(
            (m) => !yaConciliados.has(m.id) && m.direction === linea.direction,
          );
          return (
            <Alta
              titulo={`Qué movimiento es «${linea.description}»`}
              onSubmit={() =>
                emparejar.mutate({ linea: aMano.linea, movimiento: aMano.movimiento })
              }
            >
              {posibles.length === 0 ? (
                <Aviso tipo="info">
                  No hay ningún movimiento sin conciliar en ese sentido dentro de las fechas del
                  extracto. Si el gasto existe pero no está anotado, anótalo en Caja y vuelve:
                  desde aquí no se puede, porque conciliar no crea dinero.
                </Aviso>
              ) : (
                <>
                  <Selector
                    etiqueta="Movimiento"
                    ayuda="Solo los del mismo sentido y sin conciliar. Lo demás la base lo rechazaría."
                    value={aMano.movimiento}
                    onChange={(e) => setAMano({ ...aMano, movimiento: e.target.value })}
                    required
                  >
                    <option value="">Elige uno</option>
                    {posibles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {formatoFecha(m.value_date)} · {importe(m.amount)} · {m.description}
                      </option>
                    ))}
                  </Selector>
                  <div className="flex gap-2">
                    <Boton variante="primario" type="submit" disabled={emparejar.isPending}>
                      Emparejar
                    </Boton>
                    <Boton onClick={() => setAMano(null)}>Cancelar</Boton>
                  </div>
                </>
              )}
            </Alta>
          );
        })()}

      {anotando &&
        (() => {
          const linea = lineas.find((l) => l.id === anotando);
          if (!linea) return null;
          const suyas = (datos.data?.categorias ?? []).filter(
            (c) => c.direction === 'both' || c.direction === linea.direction,
          );
          return (
            <Alta
              titulo={`Anotar «${linea.description}» como movimiento`}
              onSubmit={() => anotarlo.mutate(anotando)}
            >
              <Aviso tipo="info">
                Esto es lo único que crea dinero desde aquí, y lo pides tú línea por línea: el
                gasto que el banco te cobró y nunca apuntaste. Se anota con la fecha, el importe
                y el sentido de la línea, queda marcado como venido del extracto, y se empareja
                en el mismo acto. No toca ningún movimiento que ya existiera.
              </Aviso>
              <Campo
                etiqueta="Concepto"
                ayuda="Por defecto, el del banco. Cámbialo por el que vas a reconocer tú."
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                required
              />
              <Selector
                etiqueta="Categoría"
                ayuda="Opcional, pero sin ella el lente Resultado no sabrá en qué se fue."
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
              >
                <option value="">Sin categoría</option>
                {suyas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Selector>
              <p className="text-sm text-muted">
                Se anotará {linea.direction === 'in' ? 'una entrada' : 'una salida'} de{' '}
                {importe(linea.amount)} con fecha {formatoFecha(linea.value_date)}.
              </p>
              <div className="flex gap-2">
                <Boton variante="primario" type="submit" disabled={anotarlo.isPending}>
                  {anotarlo.isPending ? 'Anotando…' : 'Anotarlo y emparejar'}
                </Boton>
                <Boton onClick={() => setAnotando(null)}>Cancelar</Boton>
              </div>
            </Alta>
          );
        })()}

      {apartando && (
        <Alta
          titulo="Apartar esta línea"
          onSubmit={() => apartar.mutate({ linea: apartando, texto: motivo.trim() })}
        >
          <Aviso tipo="info">
            No se borra: se queda con el motivo escrito y sale de la lista de pendientes. Dentro
            de tres meses, «por qué esta línea no está conciliada» tiene respuesta.
          </Aviso>
          <Campo
            etiqueta="Por qué se aparta"
            ayuda="Por ejemplo: «es la comisión de diciembre, la anoto el mes que viene»."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <Boton variante="primario" type="submit" disabled={apartar.isPending}>
              Apartarla
            </Boton>
            <Boton onClick={() => setApartando(null)}>Cancelar</Boton>
          </div>
        </Alta>
      )}

      {/* ------------------------------------------------- sobra del libro */}
      {sueltos.length > 0 && (
        <Tarjeta className="p-5">
          <h2 className="font-medium">Los que faltan en el banco</h2>
          <p className="mb-4 mt-2 max-w-prose text-sm text-muted">
            Movimientos tuyos que el banco no tiene en el periodo del extracto. Este es el montón
            que casi nadie mira y el que más dice: un cobro que diste por hecho y no llegó, un
            pago que anotaste dos veces, un cheque que nadie depositó.
          </p>
          <Lista>
            {sueltos.slice(0, 20).map((m) => (
              <Fila
                key={m.id}
                principal={
                  <>
                    <span className="font-medium">{m.description}</span>
                    <Etiqueta tono={m.direction === 'in' ? 'positivo' : 'neutro'}>
                      {m.direction === 'in' ? 'entró' : 'salió'}
                    </Etiqueta>
                  </>
                }
                secundario={
                  <>
                    {formatoFecha(m.value_date)} · {importe(m.amount)}
                    {m.external_ref ? ` · ${m.external_ref}` : ''}
                  </>
                }
              />
            ))}
          </Lista>
          {sueltos.length > 20 && (
            <p className="mt-3 text-xs text-muted">Y {sueltos.length - 20} más.</p>
          )}
        </Tarjeta>
      )}

      {/* -------------------------------------------------- lo que cuadra */}
      {cuadradas.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-muted">
            Ver las {cuadradas.length} líneas que cuadran
          </summary>
          <Lista>
            {cuadradas.map((l) => {
              const suyos = matches.filter((m) => m.statement_line_id === l.id);
              return (
                <Fila
                  key={l.id}
                  principal={
                    <>
                      <span className="font-medium">{l.description}</span>
                      <Etiqueta tono="positivo">cuadra</Etiqueta>
                    </>
                  }
                  secundario={
                    <>
                      {formatoFecha(l.value_date)} · {importe(l.amount)} ·{' '}
                      {suyos.length === 1
                        ? movimientoDe(suyos[0]?.cash_movement_id ?? '')?.description ??
                          'un movimiento'
                        : `${suyos.length} movimientos`}
                    </>
                  }
                  extremo={
                    <Boton
                      variante="sutil"
                      disabled={desemparejar.isPending}
                      onClick={() => suyos.forEach((m) => desemparejar.mutate(m.id))}
                    >
                      Deshacer
                    </Boton>
                  }
                />
              );
            })}
          </Lista>
        </details>
      )}

      {apartadas.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-muted">
            Ver las {apartadas.length} apartadas
          </summary>
          <Lista>
            {apartadas.map((l) => (
              <Fila
                key={l.id}
                principal={<span className="font-medium">{l.description}</span>}
                secundario={
                  <>
                    {formatoFecha(l.value_date)} · {importe(l.amount)} · {l.ignored_reason}
                  </>
                }
                extremo={
                  <Boton
                    variante="sutil"
                    onClick={() => apartar.mutate({ linea: l.id, texto: null })}
                  >
                    Devolver
                  </Boton>
                }
              />
            ))}
          </Lista>
        </details>
      )}
          <div>
            <Boton onClick={() => setVerUnaPorUna(false)}>Ocultar el detalle</Boton>
          </div>
        </>
      )}

      {/* ---------------------------------------------------------- el cierre */}
      {cuentaId !== '' && lineas.length > 0 && (
        <Tarjeta className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">
              {cierre ? `Cuadrado hasta el ${formatoFecha(cierre.hasta)}` : 'Sin cerrar'}
            </h2>
            {cierre && <Etiqueta tono="positivo">cerrado</Etiqueta>}
          </div>
          <p className="mb-4 mt-2 max-w-prose text-sm text-muted">
            {cierre
              ? 'Lo anterior a esa fecha deja de pedir atención, y tampoco se puede tocar: emparejar, apartar o importar por debajo se rechaza. Si encuentras un error, reabre primero.'
              : 'Cerrar es afirmar que hasta una fecha todo lo del banco está explicado. Solo entra si cada línea hasta ese día está emparejada o apartada con su motivo: un cierre que admite líneas sueltas no afirma nada, solo las esconde.'}
          </p>
          {cierre ? (
            <Boton onClick={() => cerrar.mutate(null)} disabled={cerrar.isPending}>
              Reabrir
            </Boton>
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                cerrar.mutate(cerrarHasta);
              }}
            >
              <div className="w-[12rem]">
                <Campo
                  etiqueta="Cuadrado hasta"
                  type="date"
                  value={cerrarHasta}
                  onChange={(e) => setCerrarHasta(e.target.value)}
                  required
                />
              </div>
              <Boton variante="primario" type="submit" disabled={cerrar.isPending || !cerrarHasta}>
                {cerrar.isPending ? 'Cerrando…' : 'Cerrar el periodo'}
              </Boton>
            </form>
          )}
          {sueltosViejos.length > 0 && (
            <p className="mt-3 max-w-prose text-xs text-warning">
              Quedan {sueltosViejos.length}{' '}
              {sueltosViejos.length === 1 ? 'movimiento tuyo' : 'movimientos tuyos'} anteriores al
              cierre sin línea del banco. No impiden cerrar —el extracto es la autoridad sobre lo
              que pasó en el banco, y ese lado está explicado— pero siguen a la vista abajo,
              porque siguen sin explicación.
            </p>
          )}
        </Tarjeta>
      )}

      {/* ------------------------------------------------------- importar */}
      {cuentaId !== '' && (
        <Alta
          titulo="Importar un extracto"
          exito={exito}
          onSubmit={() => (paso === 'elegir' ? leer() : importar.mutate())}
        >
          {paso === 'elegir' ? (
            <>
              <p className="max-w-prose text-sm text-muted">
                Descarga el movimiento de tu banco en CSV y elígelo aquí. No hace falta que lo
                limpies ni que le quites columnas: esto lo lee y te enseña lo que entendió antes
                de guardar nada.
              </p>
              <div>
                <label
                  htmlFor="archivo-extracto"
                  className="mb-1 block text-xs text-subtle"
                >
                  El archivo
                </label>
                <input
                  id="archivo-extracto"
                  type="file"
                  accept=".csv,.txt,.tsv,text/csv,text/plain"
                  className="min-h-11 w-full text-sm"
                  onChange={(e) => {
                    const archivo = e.target.files?.[0];
                    if (!archivo) return;
                    void archivo.text().then(setTexto);
                  }}
                />
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-muted">
                  O pegarlo a mano
                </summary>
                <label htmlFor="pegado" className="mb-1 mt-3 block text-xs text-subtle">
                  El contenido del archivo
                </label>
                <textarea
                  id="pegado"
                  rows={6}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  className="w-full rounded-control border border-border bg-surface p-3 font-mono text-xs text-text"
                  placeholder={'Fecha;Descripción;Cargo;Abono\n03/11/2026;COMISION;118,00;'}
                />
              </details>
              <div>
                <Boton variante="primario" type="submit" disabled={texto.trim() === ''}>
                  Leer el archivo
                </Boton>
              </div>
            </>
          ) : (
            /*
              Se llama como función y no como `<Mapear />` a propósito.
              Declarada dentro del componente, su identidad cambia en cada
              render, así que React la desmontaría y volvería a montarla
              entera: el campo que estuvieras escribiendo perdería el foco
              después de cada letra. Llamada, es JSX del mismo árbol.
            */
            mapeo && mapear()
          )}

          {importar.error && <Aviso tipo="error">{mensajeDeError(importar.error)}</Aviso>}
        </Alta>
      )}

      <p className="max-w-prose text-xs text-subtle">
        Lo que todavía no hace esta pantalla: emparejar una línea con un movimiento de otra fecha
        lejana sin que lo elijas tú, y recordar de un mes para otro qué columna era cuál en tu
        banco. Lo adivina igual de bien cada vez, pero no lo guarda.
      </p>
    </Seccion>
  );

  function leer() {
    const filas = separarCsv(texto);
    setMapeo(adivinarMapeo(filas));
    setPaso('mapear');
  }

  /** El paso de confirmar el mapeo. Va aquí dentro por el estado compartido. */
  function mapear() {
    if (!mapeo) return null;
    const filas = separarCsv(texto);
    const columnas = Math.max(0, ...filas.map((f) => f.length));
    const cabecera = mapeo.conCabecera ? (filas[0] ?? []) : [];
    const nombre = (i: number) => (cabecera[i] ?? '').trim() || `Columna ${i + 1}`;
    const { lineas: leidas, descartadas, fuera } = aLineas(filas, mapeo);
    const opciones = Array.from({ length: columnas }, (_, i) => i);

    return (
      <>
        <p className="max-w-prose text-sm text-muted">
          Esto es lo que entendí del archivo. Mira las líneas de ejemplo: si la fecha y el importe
          son los que ves en tu banco, impórtalo. Un importador que se equivoca en silencio no da
          un error, da una contabilidad que cuadra con un extracto que no es el tuyo.
        </p>

        {mapeo.cuenta !== null && (() => {
          const suyas = valoresDe(filas, mapeo.cuenta, mapeo.conCabecera);
          if (suyas.length < 2) return null;
          return (
            <>
              <Aviso tipo="atencion">
                Este archivo trae {suyas.length} cuentas distintas en la columna «
                {nombre(mapeo.cuenta)}». Mercury exporta así: todas tus cuentas en el mismo CSV.
                Importarlo entero en una sola cuenta no daría un extracto, daría nueve mezclados,
                y además cada traspaso entre tus cuentas aparece dos veces, una por cada lado.
                Elige de cuál son las líneas que vas a importar y repite el archivo para cada una.
              </Aviso>
              <Selector
                etiqueta="De qué cuenta son estas líneas"
                value={mapeo.cuentaValor ?? ''}
                onChange={(e) => setMapeo({ ...mapeo, cuentaValor: e.target.value || null })}
                required
              >
                <option value="">Elige una</option>
                {suyas.map((v) => (
                  <option key={v.valor} value={v.valor}>
                    {v.valor || '(en blanco)'} · {v.cuantas}{' '}
                    {v.cuantas === 1 ? 'línea' : 'líneas'}
                  </option>
                ))}
              </Selector>
            </>
          );
        })()}

        {fuera.length > 0 && (
          <Aviso tipo="info">
            De las {filas.length - (mapeo.conCabecera ? 1 : 0)} filas del archivo,{' '}
            {fuera.map((f) => `${f.cuantas} ${f.por}`).join(', ')}. Las rechazadas no se importan
            porque nunca ocurrieron: meterlas sería inventar un movimiento que el banco no hizo.
          </Aviso>
        )}

        <div>
          <p className="mb-2 text-xs text-subtle">
            Así quedan las {leidas.length === 1 ? 'línea' : `${leidas.length} líneas`}
            {leidas.length > 3 ? ' (las tres primeras)' : ''}:
          </p>
          <Lista>
            {leidas.slice(0, 3).map((l, i) => (
              <Fila
                key={`${l.fecha}-${i}`}
                principal={<span className="font-medium">{l.descripcion}</span>}
                secundario={
                  <>
                    {formatoFecha(l.fecha)} ·{' '}
                    {Number(l.importe) < 0 ? 'sale ' : 'entra '}
                    {l.importe.replace('-', '')}
                    {l.referencia ? ` · ${l.referencia}` : ''}
                  </>
                }
              />
            ))}
          </Lista>
        </div>

        {descartadas.length > 0 && (
          <Aviso tipo="atencion">
            {descartadas.length === 1
              ? `La fila ${descartadas[0]?.fila} no se va a importar: ${descartadas[0]?.por}.`
              : `${descartadas.length} filas no se van a importar. La primera es la ${descartadas[0]?.fila}: ${descartadas[0]?.por}.`}{' '}
            Si son las de los totales del pie, está bien. Si no, revisa qué columna mapeaste como
            fecha y cuál como importe.
          </Aviso>
        )}

        {/*
          La maquinaria, cerrada cuando la adivinanza funcionó.

          Abierta de entrada —que es como estaba— lo primero que veía alguien
          con su archivo del banco eran seis desplegables de columnas y un
          nombre obligatorio: cinco preguntas antes de la única que importa,
          que es si las líneas de arriba son las de su extracto. Si no se leyó
          ninguna línea se abre sola, porque entonces sí hay algo que decidir.
        */}
        <details className="rounded-card border border-border p-4" open={leidas.length === 0}>
          <summary className="cursor-pointer text-sm text-muted">
            Si algo no cuadra: cambiar las columnas o el nombre
          </summary>
          <div className="mt-4 flex flex-col gap-4">
        <Campo
          etiqueta="Cómo se llama este extracto"
          ayuda="Lo que vas a reconocer dentro de seis meses. Por ejemplo: «BCP soles · noviembre»."
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          required
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Selector
            etiqueta="La fecha"
            value={String(mapeo.fecha)}
            onChange={(e) => setMapeo({ ...mapeo, fecha: Number(e.target.value) })}
          >
            {opciones.map((i) => (
              <option key={i} value={i}>
                {nombre(i)}
              </option>
            ))}
          </Selector>

          <Selector
            etiqueta="El concepto"
            value={String(mapeo.descripcion)}
            onChange={(e) => setMapeo({ ...mapeo, descripcion: Number(e.target.value) })}
          >
            {opciones.map((i) => (
              <option key={i} value={i}>
                {nombre(i)}
              </option>
            ))}
          </Selector>

          <Selector
            etiqueta="El importe"
            ayuda="Una columna con signo, o dos: lo que sale y lo que entra."
            value={mapeo.importe === null ? 'dos' : String(mapeo.importe)}
            onChange={(e) =>
              setMapeo(
                e.target.value === 'dos'
                  ? { ...mapeo, importe: null, cargo: mapeo.cargo ?? 0, abono: mapeo.abono ?? 0 }
                  : { ...mapeo, importe: Number(e.target.value), cargo: null, abono: null },
              )
            }
          >
            {opciones.map((i) => (
              <option key={i} value={i}>
                {nombre(i)}
              </option>
            ))}
            <option value="dos">Son dos columnas</option>
          </Selector>

          <Selector
            etiqueta="El orden de la fecha"
            ayuda="03/11/2026 es 3 de noviembre o 11 de marzo, y solo tú lo sabes con seguridad."
            value={mapeo.orden}
            onChange={(e) =>
              setMapeo({ ...mapeo, orden: e.target.value as Mapeo['orden'] })
            }
          >
            <option value="dmy">Día / mes / año</option>
            <option value="mdy">Mes / día / año</option>
            <option value="ymd">Año / mes / día</option>
          </Selector>

          {mapeo.importe === null && (
            <>
              <Selector
                etiqueta="Lo que sale (cargo)"
                value={String(mapeo.cargo ?? 0)}
                onChange={(e) => setMapeo({ ...mapeo, cargo: Number(e.target.value) })}
              >
                {opciones.map((i) => (
                  <option key={i} value={i}>
                    {nombre(i)}
                  </option>
                ))}
              </Selector>
              <Selector
                etiqueta="Lo que entra (abono)"
                value={String(mapeo.abono ?? 0)}
                onChange={(e) => setMapeo({ ...mapeo, abono: Number(e.target.value) })}
              >
                {opciones.map((i) => (
                  <option key={i} value={i}>
                    {nombre(i)}
                  </option>
                ))}
              </Selector>
            </>
          )}
        </div>
          </div>
        </details>

        <div className="flex gap-2">
          <Boton
            variante="primario"
            type="submit"
            disabled={
              importar.isPending ||
              leidas.length === 0 ||
              (mapeo.cuenta !== null &&
                mapeo.cuentaValor === null &&
                valoresDe(filas, mapeo.cuenta, mapeo.conCabecera).length > 1)
            }
          >
            {importar.isPending ? 'Importando…' : `Importar ${leidas.length} líneas`}
          </Boton>
          <Boton onClick={() => setPaso('elegir')}>Volver</Boton>
        </div>
      </>
    );
  }
}

/**
 * Cómo se llama un extracto al que nadie le puso nombre: la cuenta y el tramo
 * de fechas que de verdad trae el archivo. No las que pidas: las que tiene.
 */
function nombreDelExtracto(
  lineas: readonly { fecha: string }[],
  cuenta: string | undefined,
): string {
  const fechas = [...lineas.map((l) => l.fecha)].sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];
  const quien = cuenta ? `${cuenta} · ` : '';
  if (!desde || !hasta) return `${quien}extracto`;
  if (desde === hasta) return `${quien}${formatoFecha(desde)}`;
  return `${quien}del ${formatoFecha(desde)} al ${formatoFecha(hasta)}`;
}

/**
 * El mensaje de un fallo a la mitad de una tanda. Lo que importa no es solo
 * qué falló: es cuántas quedaron hechas, porque de eso depende si hay que
 * volver a intentarlo todo o solo lo que falta.
 */
function cuantasIban(hechas: number, total: number, porque: string): string {
  if (hechas === 0) return `No se pudo con la primera de las ${total}: ${porque}`;
  return `Se hicieron ${hechas} de ${total} y la siguiente falló: ${porque} Las ${hechas} primeras quedaron guardadas; vuelve a darle y seguirá por donde iba.`;
}

/** Suma días a una fecha ISO sin pasar por la zona horaria local. */
function desplazar(iso: string, dias: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + dias * 86_400_000).toISOString().slice(0, 10);
}
