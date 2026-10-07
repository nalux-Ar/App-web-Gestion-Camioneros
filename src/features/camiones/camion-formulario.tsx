import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldShell } from '@/components/shared/field-shell';
import { SubmitBar } from '@/components/shared/submit-bar';
import { useTenantId } from '@/features/member/use-tenant-id';
import { RecordNotFoundError } from '@/lib/data-errors';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import type { CamionDeLista } from './camion';
import { estadoInicialAltaCamion, type AltaCamionEstado } from './camion-alta';
import {
  avisoFormatoPatente,
  emptyCamionValues,
  maxAnio,
  validateCamionForm,
  valuesFromCamion,
  type CamionFormErrors,
  type CamionFormField,
  type CamionFormValues,
} from './camion-form';
import { RUTA_CAMIONES, estadoAvisoCamiones, rutaEditarCamion } from './camion-navegacion';
import { CamionNoEncontrado } from './camion-no-encontrado';
import { ArchivarCamion } from './archivar-camion';
import { GUARDAR_CAMION_CONTEXT, MIN_ANIO } from './constants';
import { PATENTE_FORMATO_AVISO, formatearPatente } from './patente';
import { PrimerCamionAviso } from './primer-camion-aviso';
import { useActualizarCamion, useCambiarActivaCamion, useCrearCamion } from './use-camion-mutations';

/** ids de los campos en el DOM: a dónde va el foco cuando falla la validación. */
const FIELD_DOM_IDS: Record<CamionFormField, string> = {
  patente: 'camion-patente',
  marca: 'camion-marca',
  modelo: 'camion-modelo',
  anio: 'camion-anio',
};

/** Una patente que ya existía en el tenant (la respuesta de `crear_camion` con `creado = false`, sin duda de reintento). */
type Repetida = { camionId: string; patente: string; activa: boolean };

type ResultadoGuardado =
  | { tipo: 'creado'; viajes: number; gastos: number }
  | { tipo: 'repetida'; repetida: Repetida }
  | { tipo: 'no-encontrado' };

interface CamionFormularioProps {
  /** Si viene, se EDITA ese camión; si no, se da de alta uno nuevo. */
  camion?: CamionDeLista;
  /** Todos los camiones del tenant (la lista cargada): dice si este es el primero y si es el único activo. */
  camiones: readonly CamionDeLista[];
}

/**
 * Formulario de camión (alta y edición): patente (obligatoria), marca, modelo y año (opcionales). Solo lo ve el
 * administrador (la pantalla se lo muestra solo a él; la base lo exige igual).
 *
 * Alta: por `crear_camion` (idempotente por patente, ver `altaCamion`). Si es el PRIMER camión del tenant, antes de guardar
 * se avisa cuántos viajes y cargas sin camión se le van a asignar, y al volver a la lista se dice cuántos se asignaron.
 * Una patente que ya existía NO crea nada: se avisa ("Ya tienes un camión con esa patente") y, si ese camión está archivado,
 * se ofrece reactivarlo.
 *
 * Edición: UPDATE con la patente normalizada. Al pie, archivar o reactivar (el único activo no se archiva).
 *
 * Resiliencia (patrón de src/lib/use-submit-feedback.ts): lo tipeado no se borra si el guardado falla; "Reintentar" reenvía
 * lo mismo y, en el alta, es seguro (la base no duplica una patente).
 */
export function CamionFormulario({ camion, camiones }: CamionFormularioProps) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const editando = camion !== undefined;
  const esElPrimero = !editando && camiones.length === 0;
  const activos = camiones.filter((otro) => otro.activa);
  const esUnicoActivo = camion !== undefined && camion.activa && activos.length <= 1;

  const [values, setValues] = useState<CamionFormValues>(() => (camion ? valuesFromCamion(camion) : emptyCamionValues()));
  const [errors, setErrors] = useState<CamionFormErrors>({});
  const [focusRequest, setFocusRequest] = useState<{ field: CamionFormField; n: number } | null>(null);
  const [repetida, setRepetida] = useState<Repetida | null>(null);
  const [gone, setGone] = useState(false);

  // Lo que hay que recordar entre intentos del ALTA (la patente que quedó en duda tras un error de red, ver `altaCamion`).
  const estadoRef = useRef<AltaCamionEstado>(estadoInicialAltaCamion());

  // ¿Sigue montada la pantalla? Si el usuario se va mientras la escritura está en vuelo, al llegar la respuesta NO se navega.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const crear = useCrearCamion();
  const actualizar = useActualizarCamion();
  const cambiarActiva = useCambiarActivaCamion();
  const { run, pending, release, error, retryable, clearError } = useSubmitFeedback({ context: GUARDAR_CAMION_CONTEXT });
  const reactivar = useSubmitFeedback({ context: GUARDAR_CAMION_CONTEXT });

  useEffect(() => {
    if (!focusRequest) return;
    const element = document.getElementById(FIELD_DOM_IDS[focusRequest.field]);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' }); // centrado: no queda bajo el header fijo
  }, [focusRequest]);

  function setField(field: CamionFormField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] === undefined ? previous : { ...previous, [field]: undefined }));
    if (field === 'patente') {
      // El aviso de "ya tienes un camión con esa patente" era de OTRA patente.
      setRepetida(null);
      clearError();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateCamionForm(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      setFocusRequest((previous) => ({ field: validation.firstField, n: (previous?.n ?? 0) + 1 }));
      return;
    }
    setErrors({});
    setRepetida(null);
    const { columns } = validation;

    const result = await run<ResultadoGuardado>(async () => {
      if (camion) {
        try {
          await actualizar.mutateAsync({ tenantId, id: camion.id, columns });
        } catch (failure) {
          // 0 filas: el camión ya no existe (o quien edita no es administrador). No se arregla reintentando.
          if (failure instanceof RecordNotFoundError) return { tipo: 'no-encontrado' };
          throw failure;
        }
        return { tipo: 'creado', viajes: 0, gastos: 0 };
      }
      const alta = await crear.mutateAsync({ tenantId, columns, estado: estadoRef.current, eraElPrimero: esElPrimero });
      if (alta.tipo === 'duplicado') {
        return { tipo: 'repetida', repetida: { camionId: alta.camionId, patente: columns.patente, activa: alta.activa } };
      }
      return alta.tipo === 'creado'
        ? { tipo: 'creado', viajes: alta.viajesAsignados, gastos: alta.gastosAsignados }
        : { tipo: 'creado', viajes: 0, gastos: 0 };
    });

    if (!result.ok) return; // el error ya se muestra en la SubmitBar, sin tocar los campos
    if (result.data.tipo === 'repetida') {
      // No se creó nada: el formulario sigue abierto (se libera el bloqueo) y se avisa.
      release();
      setRepetida(result.data.repetida);
      setFocusRequest((previous) => ({ field: 'patente', n: (previous?.n ?? 0) + 1 }));
      return;
    }
    if (!mountedRef.current) return;
    if (result.data.tipo === 'no-encontrado') {
      setGone(true);
      return;
    }
    estadoRef.current = estadoInicialAltaCamion();
    navigate(RUTA_CAMIONES, {
      replace: true,
      state: estadoAvisoCamiones('camion-guardado', { viajes: result.data.viajes, gastos: result.data.gastos }),
    });
  }

  async function reactivarRepetida(id: string) {
    const result = await reactivar.run(() => cambiarActiva.mutateAsync({ tenantId, id, activa: true }));
    if (!result.ok || !mountedRef.current) return;
    navigate(RUTA_CAMIONES, { replace: true, state: estadoAvisoCamiones('camion-reactivado') });
  }

  if (gone) return <CamionNoEncontrado />;

  const formato = avisoFormatoPatente(values.patente);

  return (
    <div className="space-y-8">
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
        <PrimerCamionAviso activo={esElPrimero} />

        <div className="space-y-3">
          <CampoCamion
            id={FIELD_DOM_IDS.patente}
            label="Patente"
            value={values.patente}
            onChange={(value) => setField('patente', value)}
            error={errors.patente}
            autoCapitalize="characters"
            hint={formato ? PATENTE_FORMATO_AVISO : 'Se guarda sin espacios ni guiones, por ejemplo AB 123 CD.'}
          />

          {repetida ? (
            <Alert>
              <Info aria-hidden="true" />
              <div className="space-y-3">
                <AlertDescription className="font-medium">
                  {repetida.activa
                    ? `Ya tienes un camión con esa patente (${formatearPatente(repetida.patente)}).`
                    : `Ya tienes un camión con esa patente (${formatearPatente(repetida.patente)}), pero está archivado.`}
                </AlertDescription>
                {reactivar.error ? <AlertDescription className="text-destructive-text">{reactivar.error}</AlertDescription> : null}
                {repetida.activa ? (
                  <Button asChild variant="outline">
                    <Link to={rutaEditarCamion(repetida.camionId)}>Ver ese camión</Link>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reactivar.pending}
                    aria-busy={reactivar.pending}
                    onClick={() => void reactivarRepetida(repetida.camionId)}
                  >
                    {reactivar.pending ? 'Reactivando…' : 'Reactivarlo'}
                  </Button>
                )}
              </div>
            </Alert>
          ) : null}
        </div>

        <CampoCamion
          id={FIELD_DOM_IDS.marca}
          label="Marca"
          optional
          value={values.marca}
          onChange={(value) => setField('marca', value)}
          error={errors.marca}
        />
        <CampoCamion
          id={FIELD_DOM_IDS.modelo}
          label="Modelo"
          optional
          value={values.modelo}
          onChange={(value) => setField('modelo', value)}
          error={errors.modelo}
        />
        <CampoCamion
          id={FIELD_DOM_IDS.anio}
          label="Año"
          optional
          inputMode="numeric"
          hint={`Entre ${MIN_ANIO} y ${maxAnio()}.`}
          value={values.anio}
          onChange={(value) => setField('anio', value)}
          error={errors.anio}
        />

        <SubmitBar pending={pending} error={error} retryable={retryable} label="Guardar camión" />
      </form>

      {camion ? (
        <div className="border-t border-border pt-6">
          <ArchivarCamion
            activa={camion.activa}
            esUnicoActivo={esUnicoActivo}
            onCambiar={async (activa) => {
              await cambiarActiva.mutateAsync({ tenantId, id: camion.id, activa });
              if (!mountedRef.current) return; // se fue de la pantalla mientras guardaba
              navigate(RUTA_CAMIONES, {
                replace: true,
                state: estadoAvisoCamiones(activa ? 'camion-reactivado' : 'camion-archivado'),
              });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

interface CampoCamionProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  optional?: boolean;
  hint?: string;
  inputMode?: ComponentProps<'input'>['inputMode'];
  autoCapitalize?: string;
}

/** Texto de una línea. Sin `maxLength`: cortar en silencio lo que se pega es peor que avisar (se valida al guardar). */
function CampoCamion({ id, label, value, onChange, error, optional = false, hint, inputMode, autoCapitalize }: CampoCamionProps) {
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      {(control) => (
        <Input
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode={inputMode}
          autoCapitalize={autoCapitalize}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
        />
      )}
    </FieldShell>
  );
}
