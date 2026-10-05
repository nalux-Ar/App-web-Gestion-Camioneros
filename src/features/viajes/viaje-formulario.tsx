import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceGroup } from '@/components/shared/choice-group';
import { DateField } from '@/components/shared/date-field';
import { NumberField } from '@/components/shared/number-field';
import { SubmitBar } from '@/components/shared/submit-bar';
import { TextareaField } from '@/components/shared/textarea-field';
import { Input } from '@/components/ui/input';
import { FieldShell } from '@/components/shared/field-shell';
import { estadoDesdeCliente, type DesdeCliente } from '@/features/clientes/cliente-navegacion';
import { combinarClientes, type ClienteOpcion } from '@/features/clientes/cliente-nombre';
import { useClientes } from '@/features/clientes/use-clientes';
import { useTenantId } from '@/features/member/use-tenant-id';
import { mapDataError, RecordNotFoundError } from '@/lib/data-errors';
import { MIN_FECHA, todayLocal } from '@/lib/dates';
import { charLength } from '@/lib/text';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { generateClientRef } from './client-ref';
import {
  GUARDAR_VIAJE_CONTEXT,
  MAX_OBSERVACIONES,
  TEXTO_COUNTER_FROM,
  type ViajeAviso,
} from './constants';
import { EliminarViaje } from './eliminar-viaje';
import type { CargaClientes } from './entrega-fila';
import { CAMPO_DOM_IDS, domIdOf, type FocusRequest } from './viaje-dom-ids';
import { ViajeEntregas } from './viaje-entregas';
import { rutaDelViaje, type DetalleAviso } from './viaje-navegacion';
import {
  CLIENTES_SIN_CARGAR_MESSAGE,
  KM_MODO_OPTIONS,
  SIN_ERRORES,
  emptyViajeValues,
  newEntregaRow,
  validateViajeForm,
  valuesFromViaje,
  type EntregaField,
  type EntregaFormRow,
  type KmModo,
  type ViajeFormErrors,
  type ViajeFormField,
  type ViajeFormValues,
} from './viaje-form';
import type { ViajeDetalle } from './viajes-api';
import { searchDelMesDeFecha } from './viajes-filters';
import { useActualizarViaje, useCrearViaje, useEliminarViaje } from './use-viaje-mutations';

interface ViajeFormularioProps {
  /** Si viene, se EDITA ese viaje; si no, se crea uno nuevo. */
  viaje?: ViajeDetalle;
  /** `search` de la lista a la que volver ('' o '?mes=...'), ya validado. */
  volver: string;
  /**
   * La edición se abrió desde el detalle de ESTE viaje (ya validado en la pantalla: el `desdeViaje` del estado de
   * navegación coincide con el id de la URL). Guardar vuelve al detalle; borrar el viaje va a la lista, porque el
   * detalle ya no existiría.
   */
  desdeDetalle?: boolean;
  /** Si ese detalle se había abierto desde el detalle de un cliente (ya validado): vuelve con él, para que el detalle siga
   *  ofreciendo "volver al cliente". */
  desdeCliente?: DesdeCliente | null;
}

/**
 * Formulario de viaje (alta y edición, el mismo componente).
 *
 * Resiliencia (patrón de src/lib/use-submit-feedback.ts):
 *  - El estado de los campos vive acá, en memoria, y NO se limpia si el guardado falla.
 *  - "Reintentar" reenvía el formulario con los mismos valores. En el ALTA es idempotente: un `client_ref`
 *    generado al abrir el formulario, igual en cada reintento (ver `crearViaje`), así que un reintento
 *    tras una respuesta perdida no duplica el viaje.
 *  - Tras guardar, la pantalla queda bloqueada ("Guardando…") hasta que se navega a la lista.
 *
 * Edición: "último guardado gana" entre pestañas. Se guarda un REEMPLAZO COMPLETO del viaje y de su lista
 * de entregas (las que no se mandan, se borran): si otra pestaña cambió algo mientras esta estaba abierta,
 * este guardado lo pisa. El `camion_id` que el viaje ya tenía se pasa tal cual (si no, se borraría).
 */
export function ViajeFormulario({ viaje, volver, desdeDetalle = false, desdeCliente = null }: ViajeFormularioProps) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const editando = viaje !== undefined;

  const [values, setValues] = useState<ViajeFormValues>(() =>
    viaje ? valuesFromViaje(viaje) : emptyViajeValues(todayLocal()),
  );
  const [errors, setErrors] = useState<ViajeFormErrors>(SIN_ERRORES);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusRequest; n: number } | null>(null);

  // Clave de idempotencia del ALTA: una vez al abrir, igual en cada reintento, nueva tras guardar.
  const [clientRef, setClientRef] = useState(() => (editando ? '' : generateClientRef()));
  // Huellas de todo lo ya mandado con ese `clientRef` (ver `crearViaje`).
  const sentRef = useRef(new Set<string>());

  // ¿Sigue montada la pantalla? Si el usuario se va (o se cierra la sesión) mientras la escritura está en vuelo,
  // al llegar la respuesta NO se navega: lo arrastraría a Viajes desde donde esté. La invalidación de las queries
  // sí se hace igual (en `onSettled`, con el tenantId capturado al empezar). Se pone en true en el setup del efecto
  // (no solo en el valor inicial) porque StrictMode monta, desmonta y vuelve a montar.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const crear = useCrearViaje();
  const actualizar = useActualizarViaje();
  const eliminar = useEliminarViaje();
  const { run, pending, error, retryable } = useSubmitFeedback({ context: GUARDAR_VIAJE_CONTEXT });

  // Clientes: la lista cargada + los creados en esta pantalla que la lista todavía no trae. La carga NO bloquea el
  // formulario: si falla, el error va dentro de la sección de entregas y lo tipeado se conserva.
  const clientesQuery = useClientes();
  const [creados, setCreados] = useState<ClienteOpcion[]>([]);
  const cargados = clientesQuery.data?.items;
  const clientes = useMemo(() => (cargados ? combinarClientes(cargados, creados) : null), [cargados, creados]);
  const carga: CargaClientes = cargados ? 'listo' : clientesQuery.isError ? 'error' : 'cargando';

  const registrarCliente = useCallback((cliente: ClienteOpcion) => {
    setCreados((previos) => (previos.some((previo) => previo.id === cliente.id) ? previos : [...previos, cliente]));
  }, []);

  // Foco al primer campo con error (o al lugar que se pide), después de que se pinte. Es un efecto que solo toca el DOM.
  useEffect(() => {
    if (!focusRequest) return;
    const element = document.getElementById(domIdOf(focusRequest.target));
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' }); // centrado: no queda bajo el header fijo
  }, [focusRequest]);

  function pedirFoco(target: FocusRequest) {
    setFocusRequest((previous) => ({ target, n: (previous?.n ?? 0) + 1 }));
  }

  /** Todos los campos sueltos son texto (lo que tipeó la persona). Tocar un campo descarta su error. */
  function setField(field: ViajeFormField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) =>
      previous.campos[field] === undefined ? previous : { ...previous, campos: { ...previous.campos, [field]: undefined } },
    );
  }

  function handleKmModoChange(modo: string) {
    setValues((previous) => ({ ...previous, kmModo: modo as KmModo }));
    // Los errores de km eran del modo que se acaba de ocultar (se conservan los textos, pero no se envían ni se validan).
    setErrors((previous) => ({
      ...previous,
      campos: { ...previous.campos, kmInicial: undefined, kmFinal: undefined, kmRecorridos: undefined },
    }));
  }

  const setEntrega = useCallback(
    (key: string, cambios: Partial<Pick<EntregaFormRow, 'clienteId' | 'incidencias'>>) => {
      setValues((previous) => ({
        ...previous,
        entregas: previous.entregas.map((fila) => (fila.key === key ? { ...fila, ...cambios } : fila)),
      }));
      setErrors((previous) => {
        const actuales = previous.entregas[key];
        if (!actuales) return previous;
        const siguientes = { ...actuales };
        let hubo = false;
        for (const campo of Object.keys(cambios) as EntregaField[]) {
          if (siguientes[campo] !== undefined) {
            siguientes[campo] = undefined;
            hubo = true;
          }
        }
        return hubo ? { ...previous, entregas: { ...previous.entregas, [key]: siguientes } } : previous;
      });
    },
    [],
  );

  function agregarEntrega() {
    const fila = newEntregaRow();
    setValues((previous) => ({ ...previous, entregas: [...previous.entregas, fila] }));
    setErrors((previous) => (previous.entregasGeneral === undefined ? previous : { ...previous, entregasGeneral: undefined }));
    // La fila nueva se lleva el foco (en el celular abre la lista de clientes al tocarla).
    pedirFoco({ tipo: 'entrega', key: fila.key, field: 'clienteId' });
  }

  const quitarEntrega = useCallback((key: string) => {
    setValues((previous) => ({ ...previous, entregas: previous.entregas.filter((fila) => fila.key !== key) }));
    setErrors((previous) => {
      if (previous.entregas[key] === undefined && previous.entregasGeneral === undefined) return previous;
      const resto = { ...previous.entregas };
      delete resto[key];
      return { ...previous, entregas: resto, entregasGeneral: undefined };
    });
    // La fila con foco desaparece: el foco vuelve al botón de agregar (si no, se pierde y el teclado empieza de cero).
    setFocusRequest((previous) => ({ target: { tipo: 'agregar' }, n: (previous?.n ?? 0) + 1 }));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateViajeForm(values, { today: todayLocal(), clientes });
    if (!validation.ok) {
      setErrors(validation.errors);
      pedirFoco(validation.focus);
      return;
    }
    setErrors(SIN_ERRORES);
    const { datos } = validation;

    const result = await run<void>(async () => {
      if (viaje) {
        // Reemplazo completo. `camionId` es el que el viaje YA tenía (leído del detalle): pasar `null` siempre lo borraría.
        await actualizar.mutateAsync({ tenantId, viajeId: viaje.id, camionId: viaje.camion_id, datos });
        return;
      }
      // `crearViaje` trata "ya estaba guardado" (creado = false) como éxito.
      await crear.mutateAsync({ tenantId, datos, clientRef, sent: sentRef.current });
    });

    if (!result.ok) return; // el error ya se muestra en la SubmitBar, sin tocar los campos
    if (!mountedRef.current) return; // se fue de la pantalla mientras guardaba: no arrastrarlo a la lista

    if (!editando) {
      sentRef.current.clear();
      setClientRef(generateClientRef());
    }
    if (viaje && desdeDetalle) {
      // Se abrió desde el detalle: se vuelve a ESE viaje (`viaje.id` es el que devolvió la base). Ruta armada acá.
      navigate(rutaDelViaje(viaje.id), {
        replace: true,
        state: { aviso: 'viaje-guardado' satisfies DetalleAviso, volver, ...estadoDesdeCliente(desdeCliente) },
      });
      return;
    }
    // A la lista del mes del viaje (si es de otro mes, así se ve que quedó guardado).
    navigate(`/viajes${searchDelMesDeFecha(datos.columns.fecha)}`, {
      replace: true,
      state: { aviso: 'guardado' satisfies ViajeAviso },
    });
  }

  const today = todayLocal();
  const observacionesLength = charLength(values.observaciones, MAX_OBSERVACIONES);

  // El aviso de "falta cargar la lista de clientes" deja de valer apenas la lista carga.
  const entregasGeneral =
    errors.entregasGeneral === CLIENTES_SIN_CARGAR_MESSAGE && clientes !== null ? undefined : errors.entregasGeneral;

  return (
    <div className="space-y-8">
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-6">
        <DateField
          id={CAMPO_DOM_IDS.fecha}
          label="Fecha"
          min={MIN_FECHA}
          max={today}
          value={values.fecha}
          onChange={(value) => setField('fecha', value)}
          error={errors.campos.fecha}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextoViaje
            id={CAMPO_DOM_IDS.origen}
            label="Origen"
            value={values.origen}
            onChange={(value) => setField('origen', value)}
            error={errors.campos.origen}
          />
          <TextoViaje
            id={CAMPO_DOM_IDS.destino}
            label="Destino"
            value={values.destino}
            onChange={(value) => setField('destino', value)}
            error={errors.campos.destino}
          />
        </div>

        <div className="space-y-5">
          <ChoiceGroup
            id="viaje-km-modo"
            legend="Kilometraje"
            value={values.kmModo}
            onChange={handleKmModoChange}
            options={KM_MODO_OPTIONS}
            hint={
              values.kmModo === 'recorridos'
                ? 'Los km que hiciste en el viaje, en total.'
                : 'El odómetro al salir y al llegar. Si el viaje sigue en curso, carga solo el inicial.'
            }
          />
          {values.kmModo === 'inicial-final' ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <NumberField
                id={CAMPO_DOM_IDS.kmInicial}
                label="Km inicial"
                kind="km"
                allowZero
                optional
                unit="km"
                value={values.kmInicial}
                onChange={(value) => setField('kmInicial', value)}
                error={errors.campos.kmInicial}
              />
              <NumberField
                id={CAMPO_DOM_IDS.kmFinal}
                label="Km final"
                kind="km"
                allowZero
                optional
                unit="km"
                value={values.kmFinal}
                onChange={(value) => setField('kmFinal', value)}
                error={errors.campos.kmFinal}
              />
            </div>
          ) : (
            <NumberField
              id={CAMPO_DOM_IDS.kmRecorridos}
              label="Km recorridos"
              kind="km"
              allowZero
              optional
              unit="km"
              value={values.kmRecorridos}
              onChange={(value) => setField('kmRecorridos', value)}
              error={errors.campos.kmRecorridos}
            />
          )}
        </div>

        <NumberField
          id={CAMPO_DOM_IDS.ingreso}
          label="Ingreso"
          kind="dinero"
          allowZero
          optional
          value={values.ingreso}
          onChange={(value) => setField('ingreso', value)}
          error={errors.campos.ingreso}
        />

        <TextareaField
          id={CAMPO_DOM_IDS.observaciones}
          label="Observaciones"
          optional
          value={values.observaciones}
          onChange={(value) => setField('observaciones', value)}
          hint={
            observacionesLength > MAX_OBSERVACIONES
              ? `Más de ${MAX_OBSERVACIONES} caracteres: acórtalas.`
              : observacionesLength >= TEXTO_COUNTER_FROM
                ? `${observacionesLength} de ${MAX_OBSERVACIONES} caracteres`
                : undefined
          }
          error={errors.campos.observaciones}
        />

        <ViajeEntregas
          entregas={values.entregas}
          errors={errors}
          entregasGeneral={entregasGeneral}
          clientes={clientes}
          clientesTruncado={clientesQuery.data?.truncado ?? false}
          carga={carga}
          errorClientes={
            carga === 'error'
              ? {
                  message: `No pudimos cargar los clientes. ${mapDataError(clientesQuery.error)}`,
                  reintentando: clientesQuery.isFetching,
                  onReintentar: () => void clientesQuery.refetch(),
                }
              : null
          }
          onAgregar={agregarEntrega}
          onQuitar={quitarEntrega}
          onChange={setEntrega}
          onClienteCreado={registrarCliente}
        />

        <SubmitBar pending={pending} error={error} retryable={retryable} label="Guardar viaje" />
      </form>

      {viaje ? (
        <div className="border-t border-border pt-6">
          <EliminarViaje
            viajeId={viaje.id}
            onConfirm={async (conteosMostrados) => {
              try {
                await eliminar.mutateAsync({ tenantId, id: viaje.id, conteosMostrados });
              } catch (failure) {
                // 0 filas: el viaje ya no estaba. Para un borrado es lo mismo que éxito: se sigue a la lista.
                if (!(failure instanceof RecordNotFoundError)) throw failure;
              }
              if (!mountedRef.current) return; // se fue de la pantalla mientras borraba
              navigate(`/viajes${volver}`, { replace: true, state: { aviso: 'eliminado' satisfies ViajeAviso } });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

interface TextoViajeProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}

/** Texto de una línea obligatorio de hasta `MAX_TEXTO` caracteres (origen, destino). Sin `maxLength`: cortar en
 *  silencio lo que se pega es peor que avisar (el límite se valida al guardar, con mensaje). */
function TextoViaje({ id, label, value, onChange, error }: TextoViajeProps) {
  return (
    <FieldShell id={id} label={label} error={error}>
      {(control) => (
        <Input
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          enterKeyHint="next"
        />
      )}
    </FieldShell>
  );
}
