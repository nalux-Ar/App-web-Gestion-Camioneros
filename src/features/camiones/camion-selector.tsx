import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { AlertCircle, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/shared/choice-group';
import { InlineError } from '@/components/shared/inline-error';
import { SelectField } from '@/components/shared/select-field';
import { mapDataError } from '@/lib/data-errors';
import { etiquetaCamion, type CamionDeLista } from './camion';
import {
  AYUDA_ES_EL_ACTIVO,
  AYUDA_SUGERIR_ACTIVO,
  camionElegido,
  type DecisionCamion,
  type DecisionElegir,
} from './camion-seleccion';
import { NuevoCamionInline } from './nuevo-camion-inline';

interface CamionSelectorProps {
  /** Prefijo de los ids del DOM (el foco de un error va a `domIdDelCamion(id, decision)`). */
  id: string;
  /** null mientras la lista de camiones no cargó (o falló). */
  decision: DecisionCamion | null;
  /** Lo elegido ('' = nada: vale el precompletado, si hay). Solo cuenta con la decisión `elegir`. */
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
 *  - `ninguno`: no se muestra nada (sin camiones activos el viaje va sin camión).
 *  - `auto`: un solo camión activo, que se asigna solo: la línea "Camión: AB 123 CD", sin control.
 *  - `elegir` CON precompletado (el camión del registro editado, o el camión activo en uno nuevo): la línea
 *    "Camión: AB 123 CD" y "Cambiar", que despliega las opciones con el actual marcado (solo para ESTE registro). Sin
 *    precompletado: las opciones directo (botones hasta 4, lista desplegable desde 5), sin preselección. Un camión
 *    archivado que el registro ya tenía aparece "(archivado)".
 *  - `del-viaje`: el camión del viaje, bloqueado y visible (con un error si está archivado y la carga es nueva).
 *  - `crear`: "+ Nuevo camión" en línea (solo el administrador; a otro miembro se le explica).
 * Mientras la lista no cargó no se puede decidir: se muestra "Cargando…" o el error con "Reintentar".
 *
 * Foco ante un error (`domIdDelCamion`): el primer botón `${id}-0` o la lista `${id}` en `elegir` (con un error nunca se
 * muestra la línea: las opciones están a la vista); el bloque `${id}-bloque` (enfocable, `tabIndex={-1}`) en los demás casos.
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
      return null;

    case 'auto':
      return (
        <div id={bloqueId} tabIndex={-1} className="focus-visible:outline-none">
          <LineaCamion id={id} camion={decision.camion} />
        </div>
      );

    case 'elegir':
      return <ElegirCamion id={id} decision={decision} value={value} onChange={onChange} error={error} />;

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

/** La línea visible del camión ("Camión: AB 123 CD"): la patente siempre a la vista. */
function LineaCamion({ id, camion }: { id: string; camion: CamionDeLista }) {
  return (
    <p id={`${id}-linea`} className="text-base">
      Camión: <span className="font-semibold tabular-nums">{etiquetaCamion(camion)}</span>
    </p>
  );
}

const TECLAS_DE_FLECHA = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

interface ElegirCamionProps {
  id: string;
  decision: DecisionElegir;
  value: string;
  onChange: (camionId: string) => void;
  error?: string;
}

/**
 * `elegir`. Con un camión elegido válido Y un precompletado, la línea "Camión: …" con "Cambiar" (botón de despliegue,
 * `aria-expanded`); si no, las opciones a la vista.
 *
 * Al elegir con el dedo o el mouse, las opciones se pliegan solas y el foco vuelve a "Cambiar" (la opción enfocada
 * desaparece). Con el teclado NO se pliegan al moverse con las flechas (en un grupo de radios o en una lista nativa, cada
 * flecha ya cambia la elección y plegar en la primera impediría llegar a las demás): se pliegan al salir del bloque con Tab,
 * con Escape o con "Cambiar" de nuevo.
 */
function ElegirCamion({ id, decision, value, onChange, error }: ElegirCamionProps) {
  const [abierto, setAbierto] = useState(false);
  // Pedidos de foco a "Cambiar" (un contador: cada pedido es un cambio, aunque se repita).
  const [enfocarCambiar, setEnfocarCambiar] = useState(0);
  const cambiarRef = useRef<HTMLButtonElement>(null);
  // ¿La última tecla fue una flecha? (entonces el cambio vino de recorrer las opciones, no de elegir una).
  const flechaRef = useRef(false);

  useEffect(() => {
    if (enfocarCambiar > 0) cambiarRef.current?.focus();
  }, [enfocarCambiar]);

  const elegido = camionElegido(decision, value);
  // Con precompletado se trabaja "en línea"; la línea se ve mientras haya un camión elegido válido. Si no lo hay (p. ej. un
  // valor que dejó de ser una opción), se muestran las opciones aunque estén "plegadas": siempre hay algo para elegir.
  const conLinea = decision.preseleccionado !== null;
  const enLinea = conLinea && elegido !== null;
  const puedeCambiar = decision.opciones.length > 1;
  const mostrarOpciones = !enLinea || abierto;
  const opcionesId = `${id}-opciones`;
  const ayudaId = `${id}-ayuda`;

  // La ayuda "es tu camión activo" solo mientras vale ese; "puedes dejar uno en Inicio" solo sin precompletado.
  const ayuda =
    decision.ayuda === 'es-el-activo' && elegido !== null && elegido.id === decision.preseleccionado?.id
      ? AYUDA_ES_EL_ACTIVO
      : decision.ayuda === 'sugerir-activo'
        ? AYUDA_SUGERIR_ACTIVO
        : null;

  function plegar(enfocar: boolean) {
    setAbierto(false);
    if (enfocar) setEnfocarCambiar((n) => n + 1);
  }

  function elegir(camionId: string) {
    onChange(camionId);
    if (!conLinea) return; // sin precompletado, las opciones quedan a la vista (como antes de la 5c)
    // Recorriendo con las flechas: se queda abierto. Eligiendo (dedo, mouse, espacio, Enter en la lista): se pliega.
    if (flechaRef.current) setAbierto(true);
    else plegar(true);
  }

  function handleKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    flechaRef.current = TECLAS_DE_FLECHA.has(event.key);
    if (event.key === 'Escape' && enLinea && abierto) {
      event.preventDefault();
      plegar(true);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    // El foco se fue a OTRO control fuera del bloque (Tab, o tocar otro campo): con un camión elegido, se pliega sin mover
    // el foco. Sin `relatedTarget` (el foco va al documento) NO se pliega: es lo que pasa en el `mousedown` sobre la
    // etiqueta de una opción (no es enfocable) y plegar ahí se comería el clic que elige.
    const destino = event.relatedTarget;
    if (enLinea && abierto && destino instanceof Node && !event.currentTarget.contains(destino)) plegar(false);
  }

  const opciones = decision.opciones.map((camion) => ({
    value: camion.id,
    label: etiquetaCamion(camion, { conDescripcion: decision.control === 'lista' }),
  }));
  const legend = enLinea ? 'Elige el camión' : 'Camión';
  const hintOpciones = enLinea ? undefined : (ayuda ?? undefined);

  return (
    <div
      className="space-y-3"
      onKeyDownCapture={handleKeyDownCapture}
      onMouseDownCapture={() => {
        flechaRef.current = false;
      }}
      onBlur={handleBlur}
    >
      {enLinea && elegido !== null ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <LineaCamion id={id} camion={elegido} />
            {puedeCambiar ? (
              <Button
                ref={cambiarRef}
                type="button"
                variant="outline"
                aria-label="Cambiar el camión"
                aria-expanded={abierto}
                aria-controls={abierto ? opcionesId : undefined}
                aria-describedby={ayuda ? ayudaId : undefined}
                onClick={() => setAbierto((previo) => !previo)}
              >
                Cambiar
              </Button>
            ) : null}
          </div>
          {ayuda ? (
            <p id={ayudaId} className="text-sm text-muted-foreground">
              {ayuda}
            </p>
          ) : null}
        </div>
      ) : null}

      {mostrarOpciones ? (
        <div id={opcionesId}>
          {decision.control === 'botones' ? (
            <ChoiceGroup
              id={id}
              legend={legend}
              value={elegido?.id ?? ''}
              onChange={elegir}
              options={opciones}
              columns={opciones.length === 1 ? 1 : 2}
              hint={hintOpciones}
              error={error}
            />
          ) : (
            <SelectField
              id={id}
              label={legend}
              placeholder="Elige el camión"
              options={opciones}
              value={elegido?.id ?? ''}
              onChange={elegir}
              hint={hintOpciones}
              error={error}
            />
          )}
        </div>
      ) : null}
    </div>
  );
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
