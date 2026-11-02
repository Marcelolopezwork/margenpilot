import { useOrg } from '../app/org-context';

/**
 * Organización → entidad, en dos niveles, porque la entidad filtra casi todo
 * el producto: son dos contabilidades distintas (ADR-16).
 *
 * «Todas las entidades» es un estado legítimo para configurar y para mirar,
 * pero las pantallas que registren dinero tendrán que exigir una concreta. El
 * texto de la opción lo dice en vez de dejarlo implícito.
 */
export default function OrgEntityPicker() {
  const { organizaciones, organizacion, elegirOrganizacion, entidades, entidad, elegirEntidad } =
    useOrg();

  if (!organizacion) return null;

  const base =
    'min-h-9 max-w-[10rem] truncate rounded-control border border-border bg-surface px-2 text-sm text-text';

  return (
    <div className="flex items-center gap-2">
      {organizaciones.length > 1 ? (
        <>
          <label htmlFor="sel-org" className="sr-only">
            Organización
          </label>
          <select
            id="sel-org"
            value={organizacion.id}
            onChange={(e) => elegirOrganizacion(e.target.value)}
            className={base}
          >
            {organizaciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        // Con una sola organización, un desplegable de un elemento es ruido.
        <span className="max-w-[10rem] truncate text-sm font-medium" title={organizacion.name}>
          {organizacion.name}
        </span>
      )}

      <span aria-hidden="true" className="text-subtle">
        ·
      </span>

      <label htmlFor="sel-entidad" className="sr-only">
        Entidad legal
      </label>
      <select
        id="sel-entidad"
        value={entidad?.id ?? ''}
        onChange={(e) => elegirEntidad(e.target.value || null)}
        className={base}
      >
        <option value="">Todas las entidades</option>
        {entidades.map((e) => (
          <option key={e.id} value={e.id}>
            {e.legal_name}
          </option>
        ))}
      </select>
    </div>
  );
}
