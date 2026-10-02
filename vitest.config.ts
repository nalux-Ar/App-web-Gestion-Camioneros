import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Config de pruebas APARTE de vite.config.ts: ese archivo valida variables de
// entorno del build (Supabase, Turnstile) y las pruebas no las necesitan: el
// cliente de Supabase se reemplaza con vi.mock en cada archivo de prueba.
//
// Las pruebas viven al lado del código que prueban (`algo.test.ts(x)`) y
// corren en jsdom. `npm test` las ejecuta una vez; `npm run test:watch` queda
// escuchando cambios.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
  },
});
