import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/shared/inline-error';
import { Spinner } from '@/components/shared/spinner';
import { RecordNotFoundError, type DataErrorContext } from '@/lib/data-errors';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { cn } from '@/lib/utils';

interface ConfirmDeleteProps {
  /** Hace el borrado y TIRA el error si falla (con TanStack: `() => eliminar.mutateAsync(id)`). */
  onConfirm: () => Promise<unknown>;
  /** Texto del botón inicial. Por defecto "Eliminar"; p.ej. "Eliminar gasto" cuando es la acción de una pantalla de edición. */
  label?: string;
  /** Qué se borra, para el lector de pantalla cuando hay varios botones en una lista: "gasto del 30 sep". */
  itemLabel?: string;
  /** Mensajes propios de error, p.ej. `{ foreignKey: 'No se puede eliminar porque tiene gastos asociados.' }`.
   *  Definirlo como constante de módulo. */
  context?: DataErrorContext;
  disabled?: boolean;
  className?: string;
  /** Pregunta del segundo paso. Por defecto "¿Seguro? Esto no se puede deshacer."; se cambia cuando el borrado tiene
   *  consecuencias que conviene decir ("Este viaje tiene 3 gastos. Se conservan, pero quedan sin viaje."). */
  prompt?: ReactNode;
  /** Texto del botón que confirma. Por defecto "Sí, eliminar". Puede ser largo: el botón se parte en líneas. */
  confirmLabel?: string;
  /** Deshabilita el botón que confirma (p.ej. mientras se averigua qué se va a borrar). "Cancelar" sigue disponible. */
  confirmDisabled?: boolean;
  /** Avisa cuando se pide o se cancela la confirmación: el llamador puede averiguar lo que necesita para el `prompt`. */
  onConfirmingChange?: (confirming: boolean) => void;
}

/**
 * Confirmación INLINE en dos pasos, sin modal (un modal en el celular tapa la
 * pantalla y es fácil de cerrar sin querer):
 *
 *   [Eliminar]  →  ¿Seguro?  [Sí, eliminar] [Cancelar]
 *
 * Mientras borra, los dos botones quedan deshabilitados ("Eliminando…"). Si
 * falla, muestra el error (ícono + texto) y "Reintentar" cuando reintentar
 * tiene sentido; si no (p.ej. tiene gastos asociados), solo queda "Cancelar".
 *
 * Tras borrar con éxito queda "Eliminado." y el componente sigue bloqueado
 * (mismo guard que `SubmitBar`: el registro ya no existe, no hay nada más que
 * hacer hasta que la lista se refresque y lo desmonte).
 *
 * `RecordNotFoundError` (el UPDATE/DELETE afectó 0 filas) se trata como ÉXITO:
 * el objetivo de borrar es que el registro no esté, y si ya no está (lo
 * borró otra pestaña, u otro dispositivo) no hay nada que reprochar ni
 * reintentar. En una EDICIÓN, en cambio, sí es un error a mostrar.
 *
 * Foco: al pedir confirmación pasa a "Cancelar" (la opción segura) y al
 * cancelar vuelve a "Eliminar". Al confirmar, los botones se deshabilitan y
 * el navegador pierde el foco; por eso el foco se deja en el propio
 * contenedor (estable: no se reemplaza mientras borra, falla o termina) y el
 * lector de pantalla sigue anunciando su etiqueta y los avisos.
 */
export function ConfirmDelete({
  onConfirm,
  label = 'Eliminar',
  itemLabel,
  context,
  disabled = false,
  className,
  prompt = '¿Seguro? Esto no se puede deshacer.',
  confirmLabel = 'Sí, eliminar',
  confirmDisabled = false,
  onConfirmingChange,
}: ConfirmDeleteProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const { run, pending, error, retryable, clearError } = useSubmitFeedback({ context });

  const promptId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) cancelButtonRef.current?.focus();
    else if (wasConfirming.current) deleteButtonRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function handleConfirm() {
    groupRef.current?.focus(); // antes de que el botón se deshabilite
    const result = await run(async () => {
      try {
        await onConfirm();
      } catch (error) {
        if (!(error instanceof RecordNotFoundError)) throw error;
      }
    });
    if (result.ok) setDeleted(true);
  }

  function handleCancel() {
    clearError();
    setConfirming(false);
    onConfirmingChange?.(false);
  }

  function handleAskConfirmation() {
    setConfirming(true);
    onConfirmingChange?.(true);
  }

  if (!confirming) {
    return (
      <Button
        ref={deleteButtonRef}
        type="button"
        variant="outline"
        className={cn('border-destructive/50 text-destructive-text', className)}
        aria-label={itemLabel ? `Eliminar ${itemLabel}` : undefined}
        disabled={disabled}
        onClick={handleAskConfirmation}
      >
        <Trash2 aria-hidden="true" /> {label}
      </Button>
    );
  }

  return (
    <div
      ref={groupRef}
      tabIndex={-1}
      role="group"
      aria-label={itemLabel ? `Confirmar eliminar ${itemLabel}` : 'Confirmar eliminar'}
      className={cn(
        'space-y-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 focus-visible:outline-none',
        className,
      )}
    >
      {deleted ? (
        <p role="status" className="text-base font-medium">
          Eliminado.
        </p>
      ) : (
        <>
          {/* `aria-live`: si el texto cambia con la confirmación ya abierta (p.ej. llega la cantidad de gastos del viaje), se anuncia. */}
          <p id={promptId} aria-live="polite" className="text-base font-medium">
            {prompt}
          </p>

          {error ? <InlineError message={error} /> : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            {!error || retryable ? (
              <Button
                type="button"
                variant="destructive"
                // Con un texto largo el botón crece en alto (mínimo 48 px) en vez de cortarlo en un celular angosto.
                className="h-auto min-h-12 whitespace-normal py-2 text-center"
                disabled={pending || confirmDisabled}
                onClick={() => void handleConfirm()}
              >
                {pending ? (
                  <>
                    <Spinner className="size-4" /> Eliminando…
                  </>
                ) : error ? (
                  'Reintentar'
                ) : (
                  confirmLabel
                )}
              </Button>
            ) : null}
            <Button
              ref={cancelButtonRef}
              type="button"
              variant="outline"
              disabled={pending}
              aria-describedby={promptId}
              onClick={handleCancel}
            >
              Cancelar
            </Button>
          </div>

          <span role="status" aria-live="polite" className="sr-only">
            {pending ? 'Eliminando…' : ''}
          </span>
        </>
      )}
    </div>
  );
}
