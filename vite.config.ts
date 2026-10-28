import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // SiteGround es hosting compartido: nombres con hash para poder cachear
    // los assets un año y servir el index.html sin caché. Ver public/.htaccess.
    assetsDir: 'assets',
    sourcemap: true,
  },
});
