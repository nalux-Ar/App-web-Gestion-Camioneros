import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/shared/inline-error';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';

interface SubmitBarProps {
  /** `pending` de `useSubmitFeedback`. */
  pending: boolean;
  /** `error` de `useSubmitFeedback` (ya en español), o null. */
  error: string | null;
  /** `retryable` de `useSubmitFeedback`. Si es false no se ofrece "Reintentar". */
  retryable?: boolean;
  /** Por defecto "Reintentar" es un botón submit (reenvía el formulario con
   *  los mismos valores). Pasar `onRetry` solo si hace falta otra cosa. */
  onRetry?: () => void;
  /** Texto del botón principal. */
  label?: string;
  pendingLabel?: string;
  /** Deshabilita el botón por otras razones (p.ej. sin categorías cargadas). */
  disabled?: boolean;
}

/**
 * Pie de formulario: aviso sin conexión, error con "Reintentar" y botón
 * principal de 56 px como mínimo (crece si el rótulo se parte en líneas). Va
 * DENTRO del `<form>` (el botón es `type="submit"`).
 * El patrón completo (qué no se limpia nunca, por qué) está documentado en
 * `src/lib/use-submit-feedback.ts`.
 *
 *  - Mientras envía: botón deshabilitado con spinner y "Guardando…", también
 *    anunciado a lectores de pantalla (región `role="status"`).
 *  - El error se muestra con ícono + texto y NO borra nada del formulario.
 */
export function SubmitBar({
  pending,
  error,
  retryable = true,
  onRetry,
  label = 'Guardar',
  pendingLabel = 'Guardando…',
  disabled = false,
}: SubmitBarProps) {
  return (
    <div className="space-y-3">
      <OfflineBanner />

      {error ? (
        <InlineError
          message={error}
          retryAsSubmit={retryable && onRetry === undefined}
          onRetry={retryable ? onRetry : undefined}
        />
      ) : null}

      {/* `h-auto min-h-14 whitespace-normal`: 56 px como mínimo, pero un rótulo largo ("Guardar y pasar 12 gastos al camión
          AB 123 CD", 380 px a 18 px) se parte en líneas en vez de salirse del botón a 360 px. */}
      <Button
        type="submit"
        size="lg"
        className="h-auto min-h-14 w-full whitespace-normal py-2 text-center"
        disabled={pending || disabled}
        aria-busy={pending}
      >
        {pending ? (
          <>
            <Spinner /> {pendingLabel}
          </>
        ) : (
          label
        )}
      </Button>

      <span role="status" aria-live="polite" className="sr-only">
        {pending ? pendingLabel : ''}
      </span>
    </div>
  );
}
