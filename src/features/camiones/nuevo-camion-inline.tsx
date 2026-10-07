import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InlineError } from '@/components/shared/inline-error';
import { Spinner } from '@/components/shared/spinner';
import { useTenantId } from '@/features/member/use-tenant-id';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import type { CamionDeLista } from './camion';
import { estadoInicialAltaCamion, type AltaCamionEstado } from './camion-alta';
import { avisoFormatoPatente } from './camion-form';
import { textoAsignados } from './camion-navegacion';
import { GUARDAR_CAMION_CONTEXT } from './constants';
import { PATENTE_FORMATO_AVISO, formatearPatente, validarPatente } from './patente';
import { PrimerCamionAviso } from './primer-camion-aviso';
import { useCambiarActivaCamion, useCrearCamion } from './use-camion-mutations';

interface NuevoCamionInlineProps {
  /** Prefijo de los ids del DOM. */
  idPrefix: string;
  /** Si la cuenta no tiene NINGÚN camión (contando archivados): avisa lo que se le va a asignar y refresca de más al crear. */
  esElPrimero: boolean;
  /**
   * Se cargó (o se reactivó) el camión: hay que usarlo. `mensaje` es lo que se le dice a la persona (p. ej. cuántos registros
   * sin camión se le asignaron).
   */
  onListo: (camion: CamionDeLista, mensaje: string) => void;
}

/**
 * "+ Nuevo camión" EN LÍNEA, dentro del bloque Combustible de un gasto, cuando la cuenta no tiene camiones activos: con
 * litros hace falta camión, y mandar a la pantalla de Camiones perdería lo tipeado. Solo la patente (la marca, el modelo y
 * el año se completan después en Camiones). No es un `<form>` (iría anidado dentro del formulario del gasto): el Enter del
 * campo se intercepta y los botones son `type="button"`.
 *
 * Alta por `crear_camion` (`altaCamion`): un "Reintentar" tras un error de red es seguro (la base no duplica una patente) y,
 * si el primer intento había llegado, se usa ese camión. Una patente que ya existía:
 *  - activa (la lista de la pantalla estaba vieja): se usa ese camión;
 *  - archivada: se ofrece reactivarla.
 * Solo el administrador puede cargar camiones: quien lo muestre tiene que ofrecerlo solo a él.
 */
export function NuevoCamionInline({ idPrefix, esElPrimero, onListo }: NuevoCamionInlineProps) {
  const tenantId = useTenantId();
  const crear = useCrearCamion();
  const cambiarActiva = useCambiarActivaCamion();
  const { run, pending, error, retryable, clearError } = useSubmitFeedback({ context: GUARDAR_CAMION_CONTEXT });

  const [patente, setPatente] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [archivado, setArchivado] = useState<{ camionId: string; patente: string } | null>(null);
  const estadoRef = useRef<AltaCamionEstado>(estadoInicialAltaCamion());
  const reactivarRef = useRef<HTMLButtonElement>(null);

  const inputId = `${idPrefix}-patente`;
  const errorId = `${idPrefix}-patente-error`;
  const hintId = `${idPrefix}-patente-hint`;

  useEffect(() => {
    if (archivado) reactivarRef.current?.focus();
  }, [archivado]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setPatente(event.target.value);
    setValidationError(null);
    setArchivado(null);
    clearError();
  }

  async function crearCamion() {
    if (pending) return;
    const validation = validarPatente(patente);
    if (!validation.ok) {
      setValidationError(validation.message);
      document.getElementById(inputId)?.focus();
      return;
    }
    setValidationError(null);
    setArchivado(null);
    const columns = { patente: validation.value, marca: null, modelo: null, anio: null };

    // `keepLocked: false`: el bloque sigue montado tras un aviso o un error.
    const result = await run(
      () => crear.mutateAsync({ tenantId, columns, estado: estadoRef.current, eraElPrimero: esElPrimero }),
      { keepLocked: false },
    );
    if (!result.ok) return;
    const alta = result.data;
    const camion: CamionDeLista = { id: alta.camionId, patente: columns.patente, marca: null, modelo: null, anio: null, activa: true };
    if (alta.tipo === 'duplicado' && !alta.activa) {
      setArchivado({ camionId: alta.camionId, patente: columns.patente });
      return;
    }
    const nombre = formatearPatente(columns.patente);
    if (alta.tipo === 'creado') {
      const asignados = textoAsignados(alta.viajesAsignados, alta.gastosAsignados);
      onListo(camion, asignados ? `Camión ${nombre} cargado. Se le asignaron ${asignados} que estaban sin camión.` : `Camión ${nombre} cargado.`);
    } else if (alta.tipo === 'ya-guardado') {
      onListo(camion, `Camión ${nombre} cargado.`);
    } else {
      // Ya existía y está activo (la lista de la pantalla estaba vieja): es el camión de la persona, se usa ese.
      onListo(camion, `Ya tenías el camión ${nombre}: se usa ese.`);
    }
  }

  async function reactivar() {
    if (!archivado || pending) return;
    const { camionId, patente: normalizada } = archivado;
    const result = await run(() => cambiarActiva.mutateAsync({ tenantId, id: camionId, activa: true }), { keepLocked: false });
    if (!result.ok) return;
    onListo(
      { id: camionId, patente: normalizada, marca: null, modelo: null, anio: null, activa: true },
      `Camión ${formatearPatente(normalizada)} reactivado.`,
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // El Enter de un campo suelto enviaría el formulario del gasto entero: acá carga el camión.
    if (event.key === 'Enter') {
      event.preventDefault();
      void crearCamion();
    }
  }

  const formato = avisoFormatoPatente(patente);
  const describedBy = [hintId, validationError ? errorId : null].filter(Boolean).join(' ');

  return (
    <div role="group" aria-label="Nuevo camión" className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
      <PrimerCamionAviso activo={esElPrimero} />
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>Patente del camión</Label>
        <Input
          id={inputId}
          value={patente}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          readOnly={pending}
          aria-required="true"
          aria-invalid={validationError !== null ? true : undefined}
          aria-describedby={describedBy}
        />
        <p id={hintId} className="text-sm text-muted-foreground">
          {formato ? PATENTE_FORMATO_AVISO : 'La marca, el modelo y el año los puedes completar después en Camiones.'}
        </p>
        {validationError ? (
          <p id={errorId} role="alert" className="text-sm text-destructive-text">
            {validationError}
          </p>
        ) : null}
      </div>

      {archivado ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm font-medium">
            Ya tienes un camión con esa patente ({formatearPatente(archivado.patente)}), pero está archivado.
          </p>
          <Button ref={reactivarRef} type="button" variant="outline" disabled={pending} aria-busy={pending} onClick={() => void reactivar()}>
            {pending ? 'Reactivando…' : 'Reactivarlo y usarlo'}
          </Button>
        </div>
      ) : null}

      {error ? <InlineError message={error} onRetry={retryable ? () => void crearCamion() : undefined} retrying={pending} /> : null}

      {!archivado ? (
        <Button type="button" disabled={pending} aria-busy={pending} onClick={() => void crearCamion()}>
          {pending ? (
            <>
              <Spinner /> Cargando…
            </>
          ) : (
            'Cargar camión'
          )}
        </Button>
      ) : null}

      <span role="status" aria-live="polite" className="sr-only">
        {pending ? 'Cargando camión…' : ''}
      </span>
    </div>
  );
}
