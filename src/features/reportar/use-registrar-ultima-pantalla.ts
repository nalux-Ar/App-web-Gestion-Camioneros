import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { registrarPantalla } from './ultima-pantalla';

/**
 * Anota la "última pantalla de trabajo" (ver `ultima-pantalla.ts`) en cada cambio de ubicación. Va montado en el `AppShell`
 * (solo la app logueada). Es un efecto que solo escribe una variable de módulo: no provoca renders.
 */
export function useRegistrarUltimaPantalla(): void {
  const { pathname, search } = useLocation();
  useEffect(() => {
    registrarPantalla(pathname, search);
  }, [pathname, search]);
}
