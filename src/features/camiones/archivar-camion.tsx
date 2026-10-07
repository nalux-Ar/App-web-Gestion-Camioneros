import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/shared/inline-error';
import { Spinner } from '@/components/shared/spinner';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { UNICO_ACTIVO_MESSAGE } from './camion-alta';
import { ARCHIVAR_CAMION_CONTEXT } from './constants';

interface ArchivarCamionProps {
  activa: boolean;
  /** Según la lista cargada: es el único camión activo (no se ofrece archivarlo). La mutación lo vuelve a contar fresco. */
  esUnicoActivo: boolean;
  /** Archiva (false) o reactiva (true) y navega. TIRA el error si falla. */
  onCambiar: (activa: boolean) => Promise<unknown>;
}

/**
 * Archivar o reactivar un camión, al pie de su edición. Archivar no borra nada (el camión conserva sus viajes y gastos y se
 * puede reactivar), pero deja de poder elegirse: por eso pide un segundo toque con la explicación. Reactivar es un toque.
 *
 * El único camión activo NO se archiva (regla del front): sin otro camión activo no se podría cargar combustible con litros.
 * Se explica en vez de mostrar el botón; igual, la mutación vuelve a contar los activos justo antes de archivar.
 */
export function ArchivarCamion({ activa, esUnicoActivo, onCambiar }: ArchivarCamionProps) {
  const [confirmando, setConfirmando] = useState(false);
  const { run, pending, error, retryable, clearError } = useSubmitFeedback({ context: ARCHIVAR_CAMION_CONTEXT });
  const cancelarRef = useRef<HTMLButtonElement>(null);

  // Al pedir la confirmación, el foco va a "Cancelar" (la opción segura).
  useEffect(() => {
    if (confirmando) cancelarRef.current?.focus();
  }, [confirmando]);

  async function cambiar(nuevaActiva: boolean) {
    await run(() => onCambiar(nuevaActiva));
  }

  if (!activa) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Este camión está archivado: no se puede elegir en viajes ni cargas nuevas.</p>
        {error ? <InlineError message={error} onRetry={retryable ? () => void cambiar(true) : undefined} retrying={pending} /> : null}
        <Button type="button" variant="outline" disabled={pending} aria-busy={pending} onClick={() => void cambiar(true)}>
          {pending ? <Spinner className="size-4" /> : <ArchiveRestore aria-hidden="true" />} Reactivar camión
        </Button>
      </div>
    );
  }

  if (esUnicoActivo) {
    return <p className="text-sm text-muted-foreground">{UNICO_ACTIVO_MESSAGE}</p>;
  }

  if (!confirmando) {
    return (
      <Button type="button" variant="outline" onClick={() => setConfirmando(true)}>
        <Archive aria-hidden="true" /> Archivar camión
      </Button>
    );
  }

  return (
    <div role="group" aria-label="Confirmar archivar" className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-base font-medium">
        Un camión archivado ya no se puede elegir en viajes ni cargas nuevas. Lo que ya tiene cargado se conserva y lo puedes
        reactivar cuando quieras.
      </p>
      {error ? <InlineError message={error} /> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        {!error || retryable ? (
          <Button type="button" disabled={pending} aria-busy={pending} onClick={() => void cambiar(false)}>
            {pending ? (
              <>
                <Spinner className="size-4" /> Archivando…
              </>
            ) : error ? (
              'Reintentar'
            ) : (
              'Sí, archivar'
            )}
          </Button>
        ) : null}
        <Button
          ref={cancelarRef}
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            clearError();
            setConfirmando(false);
          }}
        >
          Cancelar
        </Button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? 'Archivando…' : ''}
      </span>
    </div>
  );
}
