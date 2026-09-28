import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // import.meta.dirname (Node >=20.11) en vez de __dirname: Vite 8
      // avisa que __dirname no será soportado por el config loader nativo.
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // Puerto fijo: el Site URL de Supabase es http://localhost:3000 y las
  // Redirect URLs tienen http://localhost:3000/** (los links de confirmación
  // y de recuperación de contraseña vuelven ahí). strictPort: si el 3000
  // está ocupado, falla en vez de saltar a otro puerto que Supabase no conoce.
  server: {
    port: 3000,
    strictPort: true,
  },
  preview: {
    port: 3000,
    strictPort: true,
  },
  build: {
    // El chunk principal (react + react-dom + react-router + el cliente de
    // Supabase) pasa el piso por defecto de 500 kB. No es "código de más":
    // @supabase/supabase-js trae junto con el cliente de auth/DB al cliente
    // de Realtime (websockets), que es el grueso de ese peso, y hace falta
    // ANTES de poder mostrar cualquier pantalla (hay que saber si hay
    // sesión antes de decidir a dónde mandar al usuario), así que no se
    // puede diferir con code-splitting por ruta (eso sí se hizo: ver
    // src/app/router.tsx, cada pantalla es su propio chunk chico). Lo que
    // importa para la señal del camionero es el tamaño transferido
    // (gzip), no el crudo: ronda 150 kB gzip, razonable incluso con mala
    // señal, y de entrada queda cacheado por el navegador entre visitas.
    chunkSizeWarningLimit: 600,
  },
});
