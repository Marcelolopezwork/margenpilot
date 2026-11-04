/**
 * Las láminas de la propuesta, en HTML.
 *
 * Esto antes se dibujaba con jsPDF: rectángulos y Helvetica. Marcelo lo vio y
 * dijo que estaba feo, y tenía razón; vende diseño y mandar eso le restaba.
 * En HTML hay tipografías de verdad, fotos que se recortan solas y rejillas,
 * y el PDF sale de imprimir la página, que es como salen las cosas bonitas.
 *
 * Todo lo que se ve aquí llega ya formateado. Ni un cálculo, ni un costo: el
 * tipo `DatosPropuesta` ni siquiera tiene dónde meterlos.
 */

import { PAREJAS } from './tipos';
import type { DatosPropuesta, Diseño, LineaPropuesta } from './tipos';
import './propuesta.css';

/** Cuántos entregables entran en una lámina antes de abrir otra. */
const POR_LAMINA = 16;

/** A partir de aquí la lista va a dos columnas en vez de una muy larga. */
const A_DOS_COLUMNAS = 7;

type Props = {
  datos: DatosPropuesta;
  diseño: Diseño;
  /** Convierte una ruta de Storage en una URL que el navegador pueda cargar. */
  urlDe: (ruta: string | null) => string | null;
  colorPrimario: string;
  colorSecundario: string;
};

function trocear<T>(items: T[], tamaño: number): T[][] {
  if (items.length <= tamaño) return [items];
  const trozos: T[][] = [];
  for (let i = 0; i < items.length; i += tamaño) trozos.push(items.slice(i, i + tamaño));
  return trozos;
}

function Fondo({ url }: { url: string | null }) {
  return <div className="fondo" style={url ? { backgroundImage: `url("${url}")` } : undefined} />;
}

function Pie({ izquierda, derecha }: { izquierda: string; derecha?: string }) {
  return (
    <div className="pie-lamina">
      <span>{izquierda}</span>
      <span>{derecha ?? ''}</span>
    </div>
  );
}

// ------------------------------------------------------------------ portada

function Portada({ datos, diseño, urlDe }: Omit<Props, 'colorPrimario' | 'colorSecundario'>) {
  const foto = urlDe(diseño.fotoPortada);
  const logo = datos.marca?.logoUrl ?? null;
  const nombre = datos.marca?.nombre ?? datos.emisor.nombre;

  const meta = (
    <div className="meta">
      <span>
        Para <strong>{datos.cliente.nombre}</strong>
      </span>
      <span>{datos.periodo}</span>
    </div>
  );

  if (diseño.portada === 'dividida') {
    return (
      <section className="lamina portada-dividida">
        <div className="columna">
          {logo && <img className="logo-lamina" src={logo} alt="" />}
          <div className="contenido">
            <p className="cejilla" style={{ color: 'rgba(255,255,255,.78)' }}>
              Propuesta de servicios
            </p>
            <h1 className="display nombre">{nombre}</h1>
            <div className="regla-corta" />
            {meta}
          </div>
        </div>
        <div className="foto">
          <Fondo url={foto} />
        </div>
      </section>
    );
  }

  if (diseño.portada === 'banda') {
    return (
      <section className="lamina portada-banda">
        <div className="banda">
          <Fondo url={foto} />
        </div>
        <div className="contenido">
          <div>
            {logo && <img className="logo-lamina" src={logo} alt="" />}
            <p className="cejilla" style={{ color: 'var(--secundario)', marginTop: '4mm' }}>
              Propuesta de servicios
            </p>
            <h1 className="display nombre">{nombre}</h1>
          </div>
          <div className="derecha">
            <strong>{datos.cliente.nombre}</strong>
            {datos.periodo}
            <br />
            {datos.numero}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="lamina portada-completa">
      <Fondo url={foto} />
      <div className="velo" />
      <div className="sobre-foto">
        {logo && <img className="logo-lamina" src={logo} alt="" />}
        <div className="contenido">
          <p className="cejilla" style={{ color: 'var(--secundario)' }}>
            Propuesta de servicios
          </p>
          <h1 className="display nombre">{nombre}</h1>
          <div className="regla-corta" />
          {meta}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- índice

function Indice({
  datos,
  diseño,
  urlDe,
  entradas,
}: Omit<Props, 'colorPrimario' | 'colorSecundario'> & {
  entradas: { titulo: string; nota: string }[];
}) {
  return (
    <section className="lamina indice">
      <div className="cuerpo">
        <h2 className="display">Índice</h2>
        <div className="lista">
          {entradas.map((e, i) => (
            <div className="fila" key={`${e.titulo}-${i}`}>
              <span className="numero">{String(i + 1).padStart(2, '0')}</span>
              <span className="titulo">{e.titulo}</span>
              <span className="nota">{e.nota}</span>
            </div>
          ))}
        </div>
        <Pie izquierda={datos.numero} derecha={datos.periodo} />
      </div>
      <div className="lateral">
        <Fondo url={urlDe(diseño.fotoIndice ?? diseño.fotoPortada)} />
        <div className="velo-plano" />
        <div className="marca">
          <div className="nombre">{datos.marca?.nombre ?? datos.emisor.nombre}</div>
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------- portadilla

function Portadilla({
  numero,
  titulo,
  foto,
}: {
  numero: number;
  titulo: string;
  foto: string | null;
}) {
  return (
    <section className="lamina portadilla">
      <Fondo url={foto} />
      <div className="velo" />
      <div className="numero">{String(numero).padStart(2, '0')}</div>
      <div className="sobre-foto">
        <div className="contenido">
          <p className="cejilla" style={{ color: 'var(--secundario)' }}>
            Servicio {String(numero).padStart(2, '0')}
          </p>
          <h2 className="display nombre">{titulo}</h2>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- servicio

function Servicio({
  datos,
  linea,
  numero,
  foto,
  incluye,
  noIncluye,
  ultima,
  continuacion,
}: {
  datos: DatosPropuesta;
  linea: LineaPropuesta;
  numero: number;
  foto: string | null;
  incluye: string[];
  noIncluye: string[];
  ultima: boolean;
  continuacion: boolean;
}) {
  const doble = incluye.length + noIncluye.length > A_DOS_COLUMNAS;

  return (
    <section className="lamina servicio">
      <div className="cuerpo">
        <p className="cejilla" style={{ color: 'var(--secundario)' }}>
          Servicio {String(numero).padStart(2, '0')}
        </p>
        <h2 className="display nombre">
          {linea.nombre}
          {continuacion && <span style={{ opacity: 0.45 }}> · continúa</span>}
        </h2>

        {!continuacion && linea.resumen && <p className="resumen">{linea.resumen}</p>}
        {!continuacion && linea.detalle && <p className="detalle">{linea.detalle}</p>}

        {incluye.length > 0 && (
          <>
            <p className="rotulo">Incluye</p>
            <ul className={`entregables${doble ? ' doble' : ''}`}>
              {incluye.map((t, i) => (
                <li key={`i-${i}`}>{t}</li>
              ))}
            </ul>
          </>
        )}

        {noIncluye.length > 0 && (
          <>
            <p className="rotulo" style={{ color: 'var(--apagado)' }}>
              No incluye
            </p>
            <ul className={`entregables sobran${doble ? ' doble' : ''}`}>
              {noIncluye.map((t, i) => (
                <li key={`e-${i}`}>{t}</li>
              ))}
            </ul>
          </>
        )}

        {ultima && (
          <div className="precio">
            <div>
              <p className="cejilla" style={{ color: 'var(--apagado)' }}>
                Inversión
              </p>
              <div className="importe">{linea.importe}</div>
            </div>
            <div className="nota">
              {linea.cantidad !== '1' && (
                <>
                  {linea.cantidad} × {linea.precioUnitario}
                  <br />
                </>
              )}
              {datos.notaImpuesto}
            </div>
          </div>
        )}
      </div>

      <div className="lateral">
        <Fondo url={foto} />
        {!foto && <div className="ghost">{String(numero).padStart(2, '0')}</div>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- inversión

function Inversion({ datos }: { datos: DatosPropuesta }) {
  return (
    <section className="lamina inversion">
      <div className="cuerpo">
        <p className="cejilla" style={{ color: 'var(--secundario)' }}>
          Resumen
        </p>
        <h2 className="display">Inversión</h2>

        <table className="tabla">
          <tbody>
            {datos.lineas.map((l, i) => (
              <tr key={l.id}>
                <td className="orden">{String(i + 1).padStart(2, '0')}</td>
                <td>{l.nombre}</td>
                <td className="cifra">{l.importe}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sumas">
          <div>
            <span>Subtotal</span>
            <span>{datos.neto}</span>
          </div>
          {datos.impuesto && (
            <div>
              <span>{datos.impuesto.etiqueta}</span>
              <span>{datos.impuesto.importe}</span>
            </div>
          )}
          {datos.validaHasta && (
            <div style={{ marginTop: '3mm' }}>
              <span>Válida hasta</span>
              <span>{datos.validaHasta}</span>
            </div>
          )}
        </div>
        <Pie izquierda={datos.numero} />
      </div>

      <div className="lateral">
        <p className="cejilla" style={{ color: 'rgba(255,255,255,.72)' }}>
          Total
        </p>
        <div className="total">{datos.total}</div>
        <p className="nota">{datos.notaImpuesto}</p>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- condiciones

function Condiciones({ datos, condiciones }: { datos: DatosPropuesta; condiciones: string[] }) {
  return (
    <section className="lamina condiciones">
      <div className="barra" />
      <div className="cuerpo">
        <p className="cejilla" style={{ color: 'var(--secundario)' }}>
          Para que no haya sorpresas
        </p>
        <h2 className="display">Condiciones</h2>
        <ul className="lista">
          {condiciones.map((c, i) => (
            <li key={i}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              {c}
            </li>
          ))}
        </ul>
        <Pie izquierda={datos.numero} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- cierre

function Cierre({ datos, foto }: { datos: DatosPropuesta; foto: string | null }) {
  const contacto = [datos.emisor.email, datos.emisor.telefono, datos.emisor.web].filter(Boolean);
  return (
    <section className="lamina cierre">
      <Fondo url={foto} />
      <div className="velo" />
      <div className="sobre-foto">
        <div className="contenido">
          <h2 className="display gracias">¡Gracias!</h2>
          <div className="regla-corta" />
          <div className="contacto">
            {contacto.map((c, i) => (
              <span key={c}>
                {i > 0 && <span className="separador">·</span>}
                {c}
              </span>
            ))}
          </div>
          <div className="emisor">
            {datos.emisor.nombre}
            {datos.emisor.taxId ? ` · ${datos.emisor.taxId}` : ''}
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ montaje

export default function Propuesta({
  datos,
  diseño,
  urlDe,
  colorPrimario,
  colorSecundario,
}: Props) {
  const pareja = PAREJAS[diseño.tipografia];

  const entradas = datos.lineas.map((l) => ({ titulo: l.nombre, nota: 'Propuesta' }));
  if (diseño.mostrarInversion) entradas.push({ titulo: 'Inversión', nota: 'Resumen y total' });
  if (diseño.mostrarCondiciones && datos.condiciones.length) {
    entradas.push({ titulo: 'Condiciones', nota: 'Alcance y pagos' });
  }

  return (
    <div
      className="propuesta lienzo"
      data-mayusculas={pareja.mayusculas ? 'si' : 'no'}
      data-tema={diseño.tema}
      style={
        {
          '--primario': colorPrimario,
          '--secundario': colorSecundario,
          '--titulo': pareja.titulo,
          '--texto': pareja.texto,
          '--escala': pareja.escala,
        } as React.CSSProperties
      }
    >
      <Portada datos={datos} diseño={diseño} urlDe={urlDe} />

      {diseño.mostrarIndice && entradas.length > 1 && (
        <Indice datos={datos} diseño={diseño} urlDe={urlDe} entradas={entradas} />
      )}

      {datos.lineas.map((linea, i) => {
        const foto = urlDe(diseño.fotosServicio[linea.id] ?? null);
        const trozos = trocear(linea.incluye, POR_LAMINA);
        return (
          <div key={linea.id} style={{ display: 'contents' }}>
            {diseño.mostrarPortadillas && (
              <Portadilla
                numero={i + 1}
                titulo={linea.nombre}
                foto={foto ?? urlDe(diseño.fotoPortada)}
              />
            )}
            {trozos.map((trozo, t) => (
              <Servicio
                key={`${linea.id}-${t}`}
                datos={datos}
                linea={linea}
                numero={i + 1}
                foto={foto}
                incluye={trozo}
                noIncluye={t === trozos.length - 1 ? linea.noIncluye : []}
                ultima={t === trozos.length - 1}
                continuacion={t > 0}
              />
            ))}
          </div>
        );
      })}

      {diseño.mostrarInversion && <Inversion datos={datos} />}

      {diseño.mostrarCondiciones && datos.condiciones.length > 0 && (
        <Condiciones datos={datos} condiciones={datos.condiciones} />
      )}

      {diseño.mostrarCierre && (
        <Cierre datos={datos} foto={urlDe(diseño.fotoCierre ?? diseño.fotoPortada)} />
      )}
    </div>
  );
}
