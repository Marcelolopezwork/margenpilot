import { Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import Setup from './pages/Setup';
import SignIn from './pages/SignIn';

export default function App() {
  // Sin .env no hay nada que hacer: la app lo explica en vez de romperse
  // con un error de consola que nadie va a leer.
  if (!isConfigured) return <Setup />;

  return (
    <Routes>
      <Route path="/entrar" element={<SignIn />} />
      <Route path="/" element={<Navigate to="/entrar" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
