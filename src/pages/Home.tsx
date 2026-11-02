import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useOrgElegida } from '../app/org-context';
import { mensajeDeError } from '../lib/errors';
import { requireSupabase } from '../lib/supabase';
import { Aviso, Boton, Cargando, Etiqueta, Tarjeta } from '../components/ui';

type Recuento = { entidades: number; monedas: number; cuentas: number; marcas: number };

/**
 * Inicio en F1 no finge ser el panel de caja: todavía no hay un solo
 * movimiento que mostrar. Lo que sí hay es el estado de la puesta en marcha,
 * y eso sí es útil, porque dice exactamente qué falta para poder operar.
 *
 * Cuando F3 traiga los movimientos, este contenido baja y arriba sube la caja
 * por moneda del wireframe.
 */
export default function Home() {
  const { organizacion } = useOrgElegida();

  const { data, isPending, error } = useQuery({
    queryKey: ['puesta-en-marcha', organizacion.id],
    queryFn: async (): Promise<Recuento> => {
      const supabase = requireSupabase();
      const org = organizacion.id;
      // `head: true` con `count` no trae filas: solo el número. Es una
      // consulta de estado, no de datos.
      const [entidades, monedas, cuentas, marcas] = await Promise.all([
        supabase
          .from('legal_entities')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org)
          .eq('is_active', true),
        supabase
          .from('organization_currencies')
          .select('currency_code', { count: 'exact', head: true })
          .eq('organization_id', org)
          .eq('is_enabled', true),
        supabase
          .from('cash_accounts')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org)
          .eq('is_active', true),
        supabase
          .from('brands')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org)
          .eq('is_active', true),
      ]);

      const fallo = entidades.error ?? monedas.error ?? cuentas.error ?? marcas.error;
      if (fallo) throw fallo;

      return {
        entidades: entidades.count ?? 0,
        monedas: monedas.count ?? 0,
        cuentas: cuentas.count ?? 0,
        marcas: marcas.count ?? 0,
      };
    },
  });

  const pasos = data
    ? [
        {
          nombre: 'Entidades legales',
          cuantas: data.entidades,
          ruta: '/configuracion/entidades',
          porque: 'Cada entidad es un libro contable aparte, con su moneda y su impuesto.',
        },
        {
          nombre: 'Monedas habilitadas',
          cuantas: data.monedas,
          ruta: '/configuracion/monedas',
          porque: 'Una cuenta solo puede existir en una moneda habilitada en la organización.',
        },
        {
          nombre: 'Marcas',
          cuantas: data.marcas,
          ruta: '/configuracion/marcas',
          porque: 'La marca es el nombre con el que sale la cotización. Una marca no tiene caja.',
        },
        {
          nombre: 'Cuentas de caja',
          cuantas: data.cuentas,
          ruta: '/configuracion/cuentas',
          porque: 'Sin cuentas no hay dónde registrar un cobro ni un pago.',
        },
      ]
    : [];

  const faltan = pasos.filter((p) => p.cuantas === 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-subtle">Puesta en marcha</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{organizacion.name}</h1>
        <p className="mt-2 max-w-prose text-sm text-muted">
          Todavía no hay movimientos que mostrar: la caja y los márgenes llegan con F3. Lo que
          puedes cerrar hoy es la configuración, que es sobre lo que se apoya todo lo demás.
        </p>
      </header>

      {error && <Aviso tipo="error">{mensajeDeError(error)}</Aviso>}
      {isPending && <Cargando que="el estado de la organización" />}

      {data && (
        <>
          <ul className="flex flex-col gap-3">
            {pasos.map((paso) => (
              <li key={paso.ruta}>
                <Tarjeta className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-medium">{paso.nombre}</h2>
                      {paso.cuantas > 0 ? (
                        <Etiqueta tono="positivo">
                          {paso.cuantas} {paso.cuantas === 1 ? 'configurada' : 'configuradas'}
                        </Etiqueta>
                      ) : (
                        <Etiqueta tono="atencion">Sin configurar</Etiqueta>
                      )}
                    </div>
                    <p className="mt-1 max-w-prose text-sm text-muted">{paso.porque}</p>
                  </div>
                  <Link to={paso.ruta}>
                    <Boton variante={paso.cuantas === 0 ? 'primario' : 'secundario'}>
                      {paso.cuantas === 0 ? 'Configurar' : 'Revisar'}
                    </Boton>
                  </Link>
                </Tarjeta>
              </li>
            ))}
          </ul>

          {faltan.length === 0 && (
            <Aviso tipo="exito">
              La configuración está completa. Lo siguiente es el cotizador, que llega con F2.
            </Aviso>
          )}
        </>
      )}
    </div>
  );
}
