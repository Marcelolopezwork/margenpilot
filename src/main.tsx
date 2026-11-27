import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import Pantalla from './components/Pantalla';
import { aplicarTemaGuardado } from './app/theme';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

// Antes del primer render, para que el tema oscuro no empiece en claro.
aplicarTemaGuardado();

const root = document.getElementById('root');
if (!root) throw new Error('No existe #root en index.html');

/*
  Dos redes y no una. La de dentro del armazón recoge el fallo de una pantalla
  y deja el menú en pie; esta recoge el que ocurra por encima —la sesión, la
  organización, el armazón mismo—, donde ya no hay menú al que volver. Sin
  ella, ese fallo seguiría siendo una página blanca.
*/
createRoot(root).render(
  <StrictMode>
    <Pantalla donde="el arranque">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </Pantalla>
  </StrictMode>,
);
