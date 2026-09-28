import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ErrorRetryProps {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** Pantalla completa de error con reintento, para cuando algo no cargó por
 *  motivos que no son "no existe" (p.ej. sin conexión). Nunca asumimos que
 *  un error de red significa "el usuario no tiene datos": eso llevaría a
 *  mandarlo por el camino equivocado (onboarding de nuevo, etc). */
export function ErrorRetry({ message, onRetry, retrying = false }: ErrorRetryProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
      <p className="max-w-sm text-base">{message}</p>
      <Button onClick={onRetry} disabled={retrying} size="lg">
        {retrying ? 'Reintentando…' : 'Reintentar'}
      </Button>
    </div>
  );
}
