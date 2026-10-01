import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/shared/spinner';

interface InlineErrorProps {
  message: string;
  /** Muestra "Reintentar" y lo ejecuta (p.ej. `refetch` de una lista que no cargó). */
  onRetry?: () => void;
  /** Muestra "Reintentar" como botón de envío: reenvía el formulario que lo contiene. */
  retryAsSubmit?: boolean;
  /** Reintento en curso: deshabilita el botón y cambia el texto. */
  retrying?: boolean;
}

/**
 * Error dentro de la pantalla (no de pantalla completa como `ErrorRetry`):
 * ícono + texto, nunca solo color. Es un `Alert` (`role="alert"`), así que
 * los lectores de pantalla lo anuncian apenas aparece.
 */
export function InlineError({ message, onRetry, retryAsSubmit = false, retrying = false }: InlineErrorProps) {
  const showRetry = retryAsSubmit || onRetry !== undefined;

  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <div className="space-y-3">
        <AlertDescription>{message}</AlertDescription>
        {showRetry ? (
          <Button
            type={retryAsSubmit ? 'submit' : 'button'}
            variant="outline"
            onClick={retryAsSubmit ? undefined : onRetry}
            disabled={retrying}
          >
            {retrying ? (
              <>
                <Spinner className="size-4" /> Reintentando…
              </>
            ) : (
              'Reintentar'
            )}
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}
