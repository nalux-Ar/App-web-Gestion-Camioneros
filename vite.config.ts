import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { TURNSTILE_ENABLED } from './src/lib/turnstile-config.ts';

// Variables que la app necesita para arrancar (src/lib/supabase.ts y
// src/lib/turnstile.ts las validan en runtime). En producción el build falla
// si falta alguna: sin esto, un deploy de Vercel sin la variable cargada
// pasaría "verde" y dejaría las pantallas de ingreso en blanco. loadEnv
// incluye las variables de entorno del proceso (las que carga Vercel).
//
// VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY se exigen siempre.
// VITE_TURNSTILE_SITE_KEY solo se exige si Turnstile está encendido
// (TURNSTILE_ENABLED en src/lib/turnstile-config.ts); mientras esté pausado
// el front no la usa y el build no la pide.
const VARIABLES_REQUERIDAS: readonly string[] = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  ...(TURNSTILE_ENABLED ? ['VITE_TURNSTILE_SITE_KEY'] : []),
];

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const faltan = VARIABLES_REQUERIDAS.filter((clave) => !env[clave]?.trim());
    if (faltan.length > 0) {
      throw new Error(`Faltan variables de entorno para el build: ${faltan.join(', ')}`);
    }
  }

  return {
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
  };
});
