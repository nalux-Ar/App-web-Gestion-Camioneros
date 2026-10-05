import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceGroup } from '@/components/shared/choice-group';
import { ConfirmDelete } from '@/components/shared/confirm-delete';
import { SelectField, type SelectGroup } from '@/components/shared/select-field';
import { SubmitBar } from '@/components/shared/submit-bar';
import { TextareaField } from '@/components/shared/textarea-field';
import type { DesdeCliente } from '@/features/clientes/cliente-navegacion';
import type { ClienteOpcion } from '@/features/clientes/cliente-nombre';
import { CLIENTES_LIMIT } from '@/features/clientes/clientes-api';
import { generateClientRef } from '@/features/gastos/client-ref';
import { useTenantId } from '@/features/member/use-tenant-id';
import { destinoTrasDevolucion, type OrigenDevolucion } from '@/features/viajes/viaje-navegacion';
import { RecordNotFoundError } from '@/lib/data-errors';
import { charLength } from '@/lib/text';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import {
  DESCRIPCION_COUNTER_FROM,
  ELIMINAR_DEVOLUCION_CONTEXT,
  GUARDAR_DEVOLUCION_CONTEXT,
  MAX_DESCRIPCION,
  MOTIVO_LABELS,
  MOTIVO_ORDER,
  SIN_CLIENTES_MESSAGE,
} from './constants';
import { agruparClientes } from './devolucion-clientes';
import {
  DESCRIPCION_OBLIGATORIA_MESSAGE,
  emptyDevolucionValues,
  esMotivoOtro,
  validateDevolucionForm,
  valuesFromDevolucion,
  type DevolucionFormErrors,
  type DevolucionFormField,
  type DevolucionFormValues,
} from './devolucion-form';
import { DevolucionNoEncontrada } from './devolucion-no-encontrada';
import type { DevolucionDetalle } from './devoluciones-api';
import { useActualizarDevolucion, useCrearDevolucion, useEliminarDevolucion } from './use-devolucion-mutations';

/** ids de los campos en el DOM: a dónde va el foco cuando falla la validación. */
const FIELD_DOM_IDS: Record<DevolucionFormField, string> = {
  motivo: 'devolucion-motivo-0', // primera opción del grupo de botones
  clienteId: 'devolucion-cliente',
  descripcion: 'devolucion-descripcion',
};

const MOTIVO_OPTIONS = MOTIVO_ORDER.map((value) => ({ value, label: MOTIVO_LABELS[value] }));

type ResultadoGuardado = 'listo' | 'no-encontrado';

interface DevolucionFormularioProps {
  /** El viaje de la URL, ya validado como uuid: la devolución se carga en ESE viaje y se vuelve a ESE viaje. */
  viajeId: string;
  /** Si viene, se EDITA esa devolución (motivo, cliente y descripción; nunca se mueve a otro viaje); si no, se crea una nueva. */
  devolucion?: DevolucionDetalle;
  /** Los clientes que se pueden elegir (la lista cargada, por nombre). */
  clientes: readonly ClienteOpcion[];
  /** La lista de clientes llegó al tope: hay más de los que se muestran. */
  clientesTruncado: boolean;
  /** Los `cliente_id` de las entregas del viaje: esos clientes se ofrecen primero. */
  idsClientesDelViaje: ReadonlyArray<string>;
  /** `search` de la lista de viajes ('' o '?mes=...'), ya saneado: el detalle del viaje lo necesita para su enlace "Viajes". */
  volver: string;
  /**
   * De dónde se abrió la edición, ya validado (`leerOrigenDevolucion`): desde la lista de Devoluciones, guardar o borrar
   * vuelve a esa lista (misma pestaña y mismo mes); desde el detalle de un cliente, a ese cliente; con `null`, al detalle
   * del viaje, como siempre.
   */
  origen: OrigenDevolucion | null;
  /** El cliente desde el que se llegó (ya validado), si lo hubo: a él se vuelve con el origen `cliente`, o viaja de vuelta
   *  al detalle del viaje. */
  desdeCliente?: DesdeCliente | null;
}

/**
 * Formulario de devolución (alta y edición, el mismo componente). Orden: Motivo → Cliente → Descripción. La fecha es
 * la del viaje: no hay campo de fecha.
 *
 * Resiliencia (patrón de src/lib/use-submit-feedback.ts):
 *  - El estado de los campos vive acá, en memoria, y NO se limpia si el guardado falla.
 *  - "Reintentar" reenvía el formulario con los mismos valores. En el ALTA el INSERT es idempotente: un `client_ref`
 *    generado al abrir el formulario, igual en cada reintento (ver `crearDevolucion`), así que un reintento tras una
 *    respuesta perdida no duplica la devolución.
 *  - Tras guardar, la pantalla queda bloqueada ("Guardando…") hasta que se navega al viaje.
 *
 * Cliente: obligatorio. Los de las entregas del viaje van primero; si el cliente guardado de una devolución ya no está
 * en la lista (borrado, o más allá del tope), el selector queda en "Elige un cliente" —nunca muestra OTRO cliente— y
 * pide elegir al guardar.
 *
 * Descripción: opcional, salvo con el motivo "Otro" (regla del front, la base no la exige): ahí es obligatoria.
 */
export function DevolucionFormulario({
  viajeId,
  devolucion,
  clientes,
  clientesTruncado,
  idsClientesDelViaje,
  volver,
  origen,
  desdeCliente = null,
}: DevolucionFormularioProps) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const editando = devolucion !== undefined;

  const [values, setValues] = useState<DevolucionFormValues>(() =>
    devolucion ? valuesFromDevolucion(devolucion) : emptyDevolucionValues(),
  );
  const [errors, setErrors] = useState<DevolucionFormErrors>({});
  const [focusRequest, setFocusRequest] = useState<{ field: DevolucionFormField; n: number } | null>(null);
  const [gone, setGone] = useState(false);

  // Clave de idempotencia del ALTA: una vez al abrir, igual en cada reintento, nueva tras guardar.
  const [clientRef, setClientRef] = useState(() => (editando ? '' : generateClientRef()));
  // Huellas de todo lo ya mandado con ese `clientRef` (ver `crearDevolucion`).
  const sentRef = useRef(new Set<string>());

  // ¿Sigue montada la pantalla? Si el usuario se va (o se cierra la sesión) mientras la escritura está en vuelo, al
  // llegar la respuesta NO se navega: lo arrastraría al viaje desde donde esté. La invalidación de las queries sí se
  // hace igual (en `onSettled`, con el tenantId capturado al empezar). Se pone en true en el setup del efecto (no solo
  // en el valor inicial) porque StrictMode monta, desmonta y vuelve a montar.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const crear = useCrearDevolucion();
  const actualizar = useActualizarDevolucion();
  const eliminar = useEliminarDevolucion();
  const { run, pending, error, retryable } = useSubmitFeedback({ context: GUARDAR_DEVOLUCION_CONTEXT });

  const gruposDeClientes = useMemo<SelectGroup[]>(
    () =>
      agruparClientes(clientes, idsClientesDelViaje).map((grupo) => ({
        label: grupo.label,
        options: grupo.clientes.map((cliente) => ({ value: cliente.id, label: cliente.nombre })),
      })),
    [clientes, idsClientesDelViaje],
  );
  const sinClientes = clientes.length === 0;
  // Un cliente que no está en la lista (borrado, o fuera del tope) se muestra como "sin elegir": si el `<select>`
  // recibiera un valor sin opción, el navegador mostraría OTRO cliente sin avisar.
  const clienteVisible = clientes.some((cliente) => cliente.id === values.clienteId) ? values.clienteId : '';

  const otro = esMotivoOtro(values.motivo);
  // Con tope: un texto enorme pegado no se recorre entero en cada render.
  const descripcionLength = charLength(values.descripcion, MAX_DESCRIPCION);

  // Foco al primer campo con error, después de que se pinte el error. Es un efecto que solo toca el DOM (no hay
  // setState adentro).
  useEffect(() => {
    if (!focusRequest) return;
    const element = document.getElementById(FIELD_DOM_IDS[focusRequest.field]);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' }); // centrado: no queda bajo el header fijo
  }, [focusRequest]);

  function setField<K extends DevolucionFormField>(field: K, value: DevolucionFormValues[K]) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] === undefined ? previous : { ...previous, [field]: undefined }));
  }

  function handleMotivoChange(motivo: string) {
    setField('motivo', motivo as DevolucionFormValues['motivo']);
    // El aviso de "descripción obligatoria" solo vale para el motivo "Otro": al cambiar de motivo se descarta (si el
    // nuevo también la exigiera, se vuelve a validar al guardar).
    setErrors((previous) =>
      previous.descripcion === DESCRIPCION_OBLIGATORIA_MESSAGE ? { ...previous, descripcion: undefined } : previous,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateDevolucionForm(values, { clientes });
    if (!validation.ok) {
      setErrors(validation.errors);
      setFocusRequest((previous) => ({ field: validation.firstField, n: (previous?.n ?? 0) + 1 }));
      return;
    }
    setErrors({});
    const { columns } = validation;

    const result = await run<ResultadoGuardado>(async () => {
      if (devolucion) {
        try {
          // Solo motivo, cliente y descripción: la devolución NO se mueve a otro viaje.
          await actualizar.mutateAsync({ tenantId, id: devolucion.id, changes: columns });
        } catch (failure) {
          // 0 filas: la devolución ya no existe. No es un error que se arregle reintentando.
          if (failure instanceof RecordNotFoundError) return 'no-encontrado';
          throw failure;
        }
        return 'listo';
      }
      // `crearDevolucion` trata "ya estaba guardada" (23505 del client_ref) como éxito.
      await crear.mutateAsync({ tenantId, viajeId, columns, clientRef, sent: sentRef.current });
      return 'listo';
    });

    if (!result.ok) return; // el error ya se muestra en la SubmitBar, sin tocar los campos
    if (!mountedRef.current) return; // se fue de la pantalla mientras guardaba: no arrastrarlo al viaje
    if (result.data === 'no-encontrado') {
      setGone(true);
      return;
    }

    if (!editando) {
      sentRef.current.clear();
      setClientRef(generateClientRef());
    }
    // Al viaje, o a la lista de Devoluciones o al cliente si se abrió desde ahí: la ruta se arma en el código con uuids ya
    // validados y el `volver` ya saneado, nunca con algo que venga del estado.
    const destino = destinoTrasDevolucion({ viajeId, volver, origen, aviso: 'devolucion-guardada', cliente: desdeCliente });
    navigate(destino.to, { replace: true, state: destino.state });
  }

  if (gone) return <DevolucionNoEncontrada viajeId={viajeId} volver={volver} origen={origen} desdeCliente={desdeCliente} />;

  return (
    <div className="space-y-8">
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
        <ChoiceGroup
          id="devolucion-motivo"
          legend="Motivo"
          value={values.motivo}
          onChange={handleMotivoChange}
          options={MOTIVO_OPTIONS}
          error={errors.motivo}
        />

        <SelectField
          id={FIELD_DOM_IDS.clienteId}
          label="Cliente"
          placeholder="Elige un cliente"
          options={[]}
          groups={gruposDeClientes}
          value={clienteVisible}
          onChange={(clienteId) => setField('clienteId', clienteId)}
          hint={
            sinClientes
              ? SIN_CLIENTES_MESSAGE
              : clientesTruncado
                ? `Tienes más de ${CLIENTES_LIMIT} clientes: aquí se muestran los primeros ${CLIENTES_LIMIT}, por orden alfabético.`
                : undefined
          }
          error={errors.clienteId}
        />

        {/* Con el motivo "Otro" la descripción es obligatoria (es lo único que dice qué pasó); en los demás, opcional. */}
        <TextareaField
          id={FIELD_DOM_IDS.descripcion}
          label="Descripción"
          optional={!otro}
          value={values.descripcion}
          onChange={(value) => setField('descripcion', value)}
          hint={
            descripcionLength > MAX_DESCRIPCION
              ? `Más de ${MAX_DESCRIPCION} caracteres: acórtala.`
              : descripcionLength >= DESCRIPCION_COUNTER_FROM
                ? `${descripcionLength} de ${MAX_DESCRIPCION} caracteres`
                : otro
                  ? 'Obligatoria si el motivo es «Otro»: escribe qué pasó.'
                  : undefined
          }
          error={errors.descripcion}
        />

        <SubmitBar pending={pending} error={error} retryable={retryable} label="Guardar devolución" disabled={sinClientes} />
      </form>

      {devolucion ? (
        <div className="border-t border-border pt-6">
          <ConfirmDelete
            label="Eliminar devolución"
            context={ELIMINAR_DEVOLUCION_CONTEXT}
            onConfirm={async () => {
              // 0 filas borradas = ya no estaba: para un borrado es lo mismo que éxito.
              await eliminar.mutateAsync({ tenantId, id: devolucion.id });
              if (!mountedRef.current) return; // se fue de la pantalla mientras borraba
              const destino = destinoTrasDevolucion({
                viajeId,
                volver,
                origen,
                aviso: 'devolucion-eliminada',
                cliente: desdeCliente,
              });
              navigate(destino.to, { replace: true, state: destino.state });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
