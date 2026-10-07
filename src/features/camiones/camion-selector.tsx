import { AlertCircle, Lock } from 'lucide-react';

import { ChoiceGroup } from '@/components/shared/choice-group';
import { InlineError } from '@/components/shared/inline-error';
import { SelectField } from '@/components/shared/select-field';
import { mapDataError } from '@/lib/data-errors';
import { etiquetaCamion, type CamionDeLista } from './camion';
import type { DecisionCamion } from './camion-seleccion';
import { NuevoCamionInline } from './nuevo-camion-inline';

interface CamionSelectorProps {
  /** Prefijo de los ids del DOM (el foco de un error va a `domIdDelCamion(id, decision)`). */
  id: string;
  /** null mientras la lista de camiones no cargó (o falló). */
  decision: DecisionCamion | null;
  /** Lo elegido ('' = nada). Solo cuenta con la decisión `elegir`. */
  value: string;
  onChange: (camionId: string) => void;
  error?: string;
  /** Estado de la lista de camiones: si falló, el error con "Reintentar" va acá y el guardado se bloquea. */
  carga: { estado: 'cargando' | 'error' | 'listo'; error?: unknown; reintentando?: boolean; onReintentar?: () => void };
  /** Solo el administrador puede cargar un camión (la decisión `crear`). */
  esAdmin: boolean;
  /** La cuenta no tiene NINGÚN camión (contando archivados): el alta en línea avisa lo que se le asigna. */
  esElPrimero: boolean;
  /** Se cargó o se reactivó un camión desde el bloque: hay que usarlo. */
  onCamionListo: (camion: CamionDeLista, mensaje: string) => void;
}

/**
 * El camión de un viaje o de una carga de combustible, según `decidirCamion`:
 *  - `ninguno` y `auto`: no se muestra nada (sin camiones activos el viaje va sin camión; con uno solo, se asigna solo).
 *  - `elegir`: botones de un toque (hasta 4) o una lista desplegable (desde 5), sin preselección. Un camión archivado que
 *    el registro ya tenía aparece "(archivado)".
 *  - `del-viaje`: el camión del viaje, bloqueado y visible (con un error si está archivado y la carga es nueva).
 *  - `crear`: "+ Nuevo camión" en línea (solo el administrador; a otro miembro se le explica).
 * Mientras la lista no cargó no se puede decidir: se muestra "Cargando…" o el error con "Reintentar".
 */
export function CamionSelector({ id, decision, value, onChange, error, carga, esAdmin, esElPrimero, onCamionListo }: CamionSelectorProps) {
  const bloqueId = `${id}-bloque`;

  if (decision === null) {
    if (carga.estado === 'error') {
      return (
        <div id={bloqueId} tabIndex={-1} className="space-y-2 focus-visible:outline-none">
          <p className="text-sm font-medium leading-none">Camión</p>
          <InlineError
            message={`No pudimos cargar tus camiones. ${mapDataError(carga.error)}`}
            onRetry={carga.onReintentar}
            retrying={carga.reintentando}
          />
          <ErrorDelCamion id={id} error={error} />
        </div>
      );
    }
    return (
      <div id={bloqueId} tabIndex={-1} className="space-y-1.5 focus-visible:outline-none">
        <p className="text-sm font-medium leading-none">Camión</p>
        <p className="text-sm text-muted-foreground">Cargando camiones…</p>
        <ErrorDelCamion id={id} error={error} />
      </div>
    );
  }

  switch (decision.tipo) {
    case 'ninguno':
    case 'auto':
      return null;

    case 'elegir': {
      const opciones = decision.opciones.map((camion) => ({
        value: camion.id,
        label: etiquetaCamion(camion, { conDescripcion: decision.control === 'lista' }),
      }));
      return decision.control === 'botones' ? (
        <ChoiceGroup
          id={id}
          legend="Camión"
          value={value}
          onChange={onChange}
          options={opciones}
          columns={opciones.length === 1 ? 1 : 2}
          error={error}
        />
      ) : (
        <SelectField id={id} label="Camión" placeholder="Elige el camión" options={opciones} value={value} onChange={onChange} error={error} />
      );
    }

    case 'del-viaje':
      return (
        <div id={bloqueId} tabIndex={-1} className="space-y-1.5 focus-visible:outline-none">
          <p className="text-sm font-medium leading-none">Camión</p>
          <p className="flex items-center gap-2 text-base">
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              Camión del viaje: <span className="font-semibold">{etiquetaCamion(decision.camion)}</span>
            </span>
          </p>
          <p className="text-sm text-muted-foreground">Va el mismo camión que el viaje. Para usar otro, cambia el camión del viaje.</p>
          <ErrorDelCamion id={id} error={error} />
        </div>
      );

    case 'crear':
      return (
        <div id={bloqueId} tabIndex={-1} className="space-y-2 focus-visible:outline-none">
          <p className="text-sm font-medium leading-none">Camión</p>
          {esAdmin ? (
            <NuevoCamionInline idPrefix={`${id}-nuevo`} esElPrimero={esElPrimero} onListo={onCamionListo} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Para guardar los litros hace falta un camión, y solo el administrador de la cuenta puede cargarlo.
            </p>
          )}
          <ErrorDelCamion id={id} error={error} />
        </div>
      );
  }
}

/** El error del camión en una región `aria-live` siempre presente (como `FieldShell`), con ícono + texto. */
function ErrorDelCamion({ id, error }: { id: string; error?: string }) {
  return (
    <div id={`${id}-error`} aria-live="polite">
      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive-text">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
