import { Navigate, Route, Routes } from 'react-router-dom';
import OrgProvider from './app/OrgProvider';
import SessionProvider from './app/SessionProvider';
import { useOrg } from './app/org-context';
import { useSesion } from './app/session-context';
import AppShell from './components/AppShell';
import { Aviso } from './components/ui';
import { isConfigured } from './lib/supabase';
import Home from './pages/Home';
import Onboarding from './pages/Onboarding';
import Pendiente from './pages/Pendiente';
import Setup from './pages/Setup';
import SignIn from './pages/SignIn';
import Catalogo from './pages/catalogo/Catalogo';
import Clientes from './pages/comercial/Clientes';
import Comercial from './pages/comercial/Comercial';
import Cotizacion from './pages/comercial/Cotizacion';
import Cotizaciones from './pages/comercial/Cotizaciones';
import Finanzas from './pages/finanzas/Finanzas';
import Propuesta from './pages/comercial/Propuesta';
import PropuestaEmitida from './pages/comercial/PropuestaEmitida';
import CategoriasServicio from './pages/catalogo/CategoriasServicio';
import Costos from './pages/catalogo/Costos';
import Servicios from './pages/catalogo/Servicios';
import Categorias from './pages/settings/Categorias';
import Cuentas from './pages/settings/Cuentas';
import Entidades from './pages/settings/Entidades';
import Impuestos from './pages/settings/Impuestos';
import Marcas from './pages/settings/Marcas';
import Monedas from './pages/settings/Monedas';
import Settings from './pages/settings/Settings';
import TiposDeCambio from './pages/settings/TiposDeCambio';

/** Pantalla de espera sobria: ni logotipo animado ni barra falsa de progreso. */
function Esperando({ que }: { que: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <p role="status" className="text-sm text-muted">
        Cargando {que}…
      </p>
    </main>
  );
}

export default function App() {
  // Sin .env no hay nada que hacer: la app lo explica en vez de romperse
  // con un error de consola que nadie va a leer.
  if (!isConfigured) return <Setup />;

  return (
    <SessionProvider>
      <ConSesion />
    </SessionProvider>
  );
}

/**
 * Mientras no sabemos si hay sesión no se decide nada. Si se tratara
 * «todavía no sé» como «no hay sesión», a quien vuelve con sesión válida se le
 * mandaría a la pantalla de acceso durante un parpadeo.
 */
function ConSesion() {
  const { cargando, usuario } = useSesion();

  if (cargando) return <Esperando que="tu sesión" />;

  if (!usuario) {
    return (
      <Routes>
        <Route path="/entrar" element={<SignIn />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }

  return (
    <OrgProvider>
      <ConOrganizacion />
    </OrgProvider>
  );
}

function ConOrganizacion() {
  const { cargando, error, organizaciones } = useOrg();

  if (cargando) return <Esperando que="tu organización" />;

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
        <Aviso tipo="error">{error}</Aviso>
      </main>
    );
  }

  // Una cuenta sin organización no es un error: es alguien que acaba de entrar
  // por primera vez.
  if (organizaciones.length === 0) return <Onboarding />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="comercial" element={<Comercial />}>
          <Route index element={<Navigate to="cotizaciones" replace />} />
          <Route path="cotizaciones" element={<Cotizaciones />} />
          <Route path="cotizaciones/:id" element={<Cotizacion />} />
          <Route path="clientes" element={<Clientes />} />
        </Route>
        <Route path="catalogos" element={<Catalogo />}>
          <Route index element={<Navigate to="servicios" replace />} />
          <Route path="servicios" element={<Servicios />} />
          <Route path="costos" element={<Costos />} />
          <Route path="categorias" element={<CategoriasServicio />} />
        </Route>
        <Route path="finanzas" element={<Finanzas />} />
        <Route path="pipeline" element={<Pendiente ruta="/pipeline" fase="F4" />} />
        <Route path="analisis" element={<Pendiente ruta="/analisis" fase="F3" />} />
        <Route path="configuracion" element={<Settings />}>
          <Route index element={<Navigate to="entidades" replace />} />
          <Route path="entidades" element={<Entidades />} />
          <Route path="marcas" element={<Marcas />} />
          <Route path="monedas" element={<Monedas />} />
          <Route path="impuestos" element={<Impuestos />} />
          <Route path="cuentas" element={<Cuentas />} />
          <Route path="categorias" element={<Categorias />} />
          <Route path="tipos-de-cambio" element={<TiposDeCambio />} />
        </Route>
      </Route>
      {/*
        La propuesta va fuera del armazón: ocupa la pantalla entera y se
        imprime tal cual, sin menú lateral ni cabecera que estorben en el PDF.
      */}
      <Route path="comercial/cotizaciones/:id/propuesta" element={<Propuesta />} />
      <Route
        path="comercial/cotizaciones/:id/propuesta/v/:version"
        element={<PropuestaEmitida />}
      />
      {/* Con sesión, /entrar no tiene sentido. */}
      <Route path="/entrar" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
