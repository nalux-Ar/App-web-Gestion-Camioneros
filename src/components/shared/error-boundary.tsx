import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Red de seguridad de toda la app: sin esto, un error inesperado al renderizar
 * (un bug, un dato con forma rara) desmonta React entero y deja la pantalla
 * EN BLANCO, sin salida, en el celular de alguien que está en ruta.
 *
 * Mensaje genérico a propósito (nada del error ni de su stack: puede traer
 * datos internos) y un botón que recarga la página: es la salida más segura,
 * porque deja todo el estado de React en limpio (los datos guardados están en
 * la base y la sesión en el storage de Supabase, no se pierden).
 *
 * Solo atrapa errores de RENDER y de ciclo de vida. Los errores de eventos y
 * de promesas (un guardado que falla) los maneja cada pantalla con
 * `useSubmitFeedback` / `mapDataError`.
 *
 * Usa solo tokens del tema: el fallback se ve bien en claro y en oscuro.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground"
      >
        <AlertTriangle className="size-10 text-destructive-text" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-lg font-semibold">Algo salió mal</p>
          <p className="max-w-sm text-muted-foreground">
            Ocurrió un problema inesperado. Recarga la página para continuar.
          </p>
        </div>
        <Button size="lg" onClick={() => window.location.reload()}>
          Recargar
        </Button>
      </div>
    );
  }
}
