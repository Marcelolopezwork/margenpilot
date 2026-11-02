/**
 * Iconos propios en SVG, sin librería. Son doce: traer una dependencia de
 * miles para esto engordaría el bundle que viaja por el hosting compartido.
 *
 * Todos son decorativos (`aria-hidden`): el texto que va al lado es el que
 * nombra la acción. Un icono que lleva significado propio tiene que llevar su
 * propia etiqueta, y en esta app no hay ninguno así.
 */
type Props = { className?: string | undefined };

function Svg({ children, className }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'h-5 w-5'}
    >
      {children}
    </svg>
  );
}

export const IconoInicio = (p: Props) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Svg>
);

export const IconoComercial = (p: Props) => (
  <Svg {...p}>
    <path d="M3 17l5-5 4 3 5-7 4 4" />
    <path d="M3 21h18" />
  </Svg>
);

export const IconoCatalogos = (p: Props) => (
  <Svg {...p}>
    <path d="M4 5h16v14H4z" />
    <path d="M8 5v14M4 10h4M4 14h4" />
  </Svg>
);

export const IconoFinanzas = (p: Props) => (
  <Svg {...p}>
    <path d="M3 7h18v10H3z" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);

export const IconoPipeline = (p: Props) => (
  <Svg {...p}>
    <path d="M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v6h-4z" />
  </Svg>
);

export const IconoAnalisis = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);

export const IconoConfiguracion = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </Svg>
);

export const IconoMas = (p: Props) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </Svg>
);

export const IconoCerrar = (p: Props) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconoSol = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
  </Svg>
);

export const IconoLuna = (p: Props) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Svg>
);

export const IconoSistema = (p: Props) => (
  <Svg {...p}>
    <path d="M3 5h18v11H3z" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);
