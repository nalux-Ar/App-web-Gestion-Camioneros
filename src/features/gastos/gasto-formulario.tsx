import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceGroup } from '@/components/shared/choice-group';
import { ConfirmDelete } from '@/components/shared/confirm-delete';
import { DateField } from '@/components/shared/date-field';
import { InlineError } from '@/components/shared/inline-error';
import { NumberField } from '@/components/shared/number-field';
import { SelectField } from '@/components/shared/select-field';
import { SubmitBar } from '@/components/shared/submit-bar';
import { TextareaField } from '@/components/shared/textarea-field';
import type { CamionDeLista } from '@/features/camiones/camion';
import {
  CAMIONES_SIN_CARGAR_MESSAGE,
  combinarCamiones,
  decidirCamion,
  domIdDelCamion,
  resolverCamion,
  type ResolucionCamion,
} from '@/features/camiones/camion-seleccion';
import { CamionSelector } from '@/features/camiones/camion-selector';
import { useCamiones } from '@/features/camiones/use-camiones';
import { estadoDesdeCliente } from '@/features/clientes/cliente-navegacion';
import { useMember } from '@/features/member/use-member';
import { useTenantId } from '@/features/member/use-tenant-id';
import { RECIENTES_LIMIT } from '@/features/viajes/constants';
import { useViajesRecientes } from '@/features/viajes/use-viajes';
import { rutaDelViaje, type DesdeViaje, type DetalleAviso } from '@/features/viajes/viaje-navegacion';
import { etiquetaDeViaje, opcionesDeViaje, type ViajeOpcion } from '@/features/viajes/viaje-opciones';
import { mapDataError, RecordNotFoundError } from '@/lib/data-errors';
import { todayLocal } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { charLength } from '@/lib/text';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { categoriasParaElegir, nombreParaMostrar, type Categoria } from './categorias';
import { generateClientRef } from './client-ref';
import {
  DESCRIPCION_COUNTER_FROM,
  ELIMINAR_GASTO_CONTEXT,
  GUARDAR_GASTO_CONTEXT,
  MAX_DESCRIPCION,
  METODO_PAGO_LABELS,
  MIN_FECHA,
  METODO_PAGO_ORDER,
  type GastoAviso,
} from './constants';
import {
  DESCRIPCION_OBLIGATORIA_MESSAGE,
  emptyGastoValues,
  esCombustibleElegida,
  esGastosVariosElegida,
  previewPrecioPorLitro,
  validateGastoForm,
  valuesFromGasto,
  type GastoFormErrors,
  type GastoFormField,
  type GastoFormValues,
  type TanqueLlenoChoice,
} from './gasto-form';
import { GastoNoEncontrado } from './gasto-no-encontrado';
import type { GastoDetalle } from './gastos-api';
import { searchDelMesDeFecha } from './gastos-filters';
import { useActualizarGasto, useCrearGasto, useEliminarGasto } from './use-gasto-mutations';

/** ids de los campos en el DOM: a dónde va el foco cuando falla la validación. */
const FIELD_DOM_IDS: Record<GastoFormField, string> = {
  categoriaId: 'gasto-categoria-0', // primera opción del grupo de botones
  monto: 'gasto-monto',
  // Prefijo: el control real depende de la decisión (botones, lista o bloque); ver `domIdDelCamion`.
  camionId: 'gasto-camion',
  litros: 'gasto-litros',
  kmOdometro: 'gasto-km',
  tanqueLleno: 'gasto-tanque-0',
  fecha: 'gasto-fecha',
  viajeId: 'gasto-viaje',
  metodoPago: 'gasto-metodo',
  descripcion: 'gasto-descripcion',
};

const METODO_PAGO_OPTIONS = METODO_PAGO_ORDER.map((value) => ({ value, label: METODO_PAGO_LABELS[value] }));

const TANQUE_OPTIONS: ReadonlyArray<{ value: TanqueLlenoChoice; label: string }> = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
  { value: '', label: 'Sin indicar' },
];

type ResultadoGuardado = 'listo' | 'no-encontrado';

interface GastoFormularioProps {
  /** Todas las categorías (activas e inactivas). */
  categorias: readonly Categoria[];
  /** Si viene, se EDITA ese gasto; si no, se crea uno nuevo. */
  gasto?: GastoDetalle;
  /** `search` de la lista a la que volver ('' o '?mes=...&categoria=...'), ya validado. */
  volver: string;
  /**
   * Solo si el gasto se abrió desde el detalle de un viaje (ya validado, ver `leerDesdeViaje`): al guardar y al
   * borrar se vuelve a ESE viaje en vez de a la lista de gastos.
   */
  desdeViaje?: DesdeViaje | null;
  /** El viaje que llegó preseleccionado por `?viaje=` (ya consultado y existente). Solo en el alta. */
  viajePreseleccionado?: ViajeOpcion | null;
}

/**
 * Formulario de gasto (alta y edición, el mismo componente).
 *
 * Resiliencia (patrón de src/lib/use-submit-feedback.ts):
 *  - El estado de los campos vive acá, en memoria, y NO se limpia si el guardado falla.
 *  - "Reintentar" reenvía el formulario con los mismos valores. En el ALTA el INSERT es
 *    idempotente: un `client_ref` generado al abrir el formulario, igual en cada reintento
 *    (ver `crearGasto`), así que un reintento tras una respuesta perdida no duplica el gasto.
 *  - Tras guardar, la pantalla queda bloqueada ("Guardando…") hasta que se navega a la lista.
 *
 * Viaje (opcional): el selector ofrece "Sin viaje" y los viajes más recientes (ver `opcionesDeViaje`), y siempre
 * incluye el viaje ya vinculado al gasto que se edita y el preseleccionado. Si la lista no carga, el error con
 * "Reintentar" va junto al campo y NO bloquea el guardado ni toca nada de lo tipeado.
 *
 * Combustible: con la categoría Combustible aparecen el camión, los litros, el km del odómetro y el tanque lleno;
 * el precio por litro NO se tipea, se calcula (monto ÷ litros). Si se cambia a otra categoría,
 * esos campos desaparecen y al guardar se mandan en NULL (también en el UPDATE).
 *
 * Camión (solo Combustible: con litros hace falta camión; ver `decidirCamion`): si el gasto va en un viaje con camión, va
 * ESE camión, bloqueado y visible; si no, con uno solo activo se asigna solo, con dos o más se elige con un toque (sin
 * preselección) y sin ninguno se carga uno ahí mismo ("+ Nuevo camión", solo el administrador). Un gasto que ya tenía un
 * camión archivado lo conserva. Si la lista de camiones no carga, la carga de combustible no se guarda.
 */
export function GastoFormulario({
  categorias,
  gasto,
  volver,
  desdeViaje = null,
  viajePreseleccionado = null,
}: GastoFormularioProps) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const editando = gasto !== undefined;

  const [values, setValues] = useState<GastoFormValues>(() =>
    gasto ? valuesFromGasto(gasto) : emptyGastoValues(todayLocal(), viajePreseleccionado?.id ?? ''),
  );
  const [errors, setErrors] = useState<GastoFormErrors>({});
  // `domId`: el id del DOM ya resuelto cuando depende de lo que se ve (el control del camión cambia según la decisión).
  const [focusRequest, setFocusRequest] = useState<{ field: GastoFormField; n: number; domId?: string } | null>(null);
  const [gone, setGone] = useState(false);

  // Clave de idempotencia del ALTA: una vez al abrir, igual en cada reintento, nueva tras guardar.
  const [clientRef, setClientRef] = useState(() => (editando ? '' : generateClientRef()));
  // Huellas de todo lo ya mandado con ese `clientRef` (ver `crearGasto`).
  const sentRef = useRef(new Set<string>());

  // ¿Sigue montada la pantalla? Si el usuario se va (o se cierra la sesión) mientras la escritura está en
  // vuelo, al llegar la respuesta NO se navega: lo arrastraría a Gastos desde donde esté. La invalidación de
  // las queries sí se hace igual (en `onSuccess`, con el tenantId capturado al empezar). Se pone en true en
  // el setup del efecto (no solo en el valor inicial) porque StrictMode monta, desmonta y vuelve a montar.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const crear = useCrearGasto();
  const actualizar = useActualizarGasto();
  const eliminar = useEliminarGasto();
  const { run, pending, error, retryable } = useSubmitFeedback({ context: GUARDAR_GASTO_CONTEXT });

  // Viajes que se pueden elegir: los recientes + los que tienen que estar sí o sí (el vinculado al gasto, el preseleccionado
  // y el que se acaba de elegir, para que una actualización de la lista no le saque la opción al valor elegido).
  const viajesQuery = useViajesRecientes();
  const [viajeElegido, setViajeElegido] = useState<ViajeOpcion | null>(null);
  const recientes = viajesQuery.data;
  const vinculado = gasto?.viajes ?? null;
  const viajes = useMemo(
    () => opcionesDeViaje({ recientes: recientes ?? [], fijos: [vinculado, viajePreseleccionado, viajeElegido] }),
    [recientes, vinculado, viajePreseleccionado, viajeElegido],
  );
  const today = todayLocal();
  const opcionesViaje = useMemo(
    () => viajes.map((viaje) => ({ value: viaje.id, label: etiquetaDeViaje(viaje, today) })),
    [viajes, today],
  );

  const fuel = esCombustibleElegida(values.categoriaId, categorias);

  // Camión de la carga de combustible: la lista de camiones (en caché) + los cargados o reactivados acá mismo, que la lista
  // todavía no trae (se refresca en segundo plano). El camión del viaje elegido manda (la base exige que coincidan).
  const { member } = useMember();
  // `fresca`: se vuelve a pedir al abrir el formulario (si no, una lista vieja con 1 solo camión asignaría ese sin mostrar el selector).
  const camionesQuery = useCamiones({ fresca: true });
  // Cada camión cargado o reactivado acá, con el momento de la lista que se tenía al hacerlo (`dataUpdatedAt`): en cuanto la
  // lista se vuelve a leer, ella manda (ver `combinarCamiones`).
  const [camionesCreados, setCamionesCreados] = useState<Array<{ camion: CamionDeLista; listaAl: number }>>([]);
  const [mensajeCamion, setMensajeCamion] = useState<string | null>(null);
  const camionesCargados = camionesQuery.data?.items;
  const listaAl = camionesQuery.dataUpdatedAt;
  const camiones = useMemo(
    () =>
      camionesCargados
        ? combinarCamiones(
            camionesCargados,
            camionesCreados.filter((creado) => creado.listaAl >= listaAl).map((creado) => creado.camion),
          )
        : null,
    [camionesCargados, camionesCreados, listaAl],
  );
  const viajeElegidoOpcion = values.viajeId === '' ? null : (viajes.find((viaje) => viaje.id === values.viajeId) ?? null);
  const camionDelViaje = viajeElegidoOpcion?.camion_id ?? null;
  const decisionCamion =
    fuel && camiones
      ? decidirCamion({ camiones, original: gasto?.camion_id ?? null, camionDelViaje, contexto: 'combustible' })
      : null;
  const resolucionCamion: ResolucionCamion = !fuel
    ? { ok: true, camionId: null }
    : decisionCamion
      ? resolverCamion(decisionCamion, values.camionId)
      : { ok: false, message: CAMIONES_SIN_CARGAR_MESSAGE };

  function usarCamionNuevo(camion: CamionDeLista, mensaje: string) {
    setCamionesCreados((previos) => [...previos.filter((previo) => previo.camion.id !== camion.id), { camion, listaAl }]);
    setField('camionId', camion.id);
    setMensajeCamion(mensaje);
  }
  // "Gastos varios": la descripción es obligatoria (ver `validateGastoForm`).
  const gastosVarios = esGastosVariosElegida(values.categoriaId, categorias);
  const opcionesCategoria = categoriasParaElegir(categorias, gasto?.categoria_id).map((categoria) => ({
    value: categoria.id,
    label: nombreParaMostrar(categoria),
  }));
  const precioPorLitro = fuel ? previewPrecioPorLitro(values.monto, values.litros) : null;
  // Con tope: un texto enorme pegado no se recorre entero en cada render.
  const descripcionLength = charLength(values.descripcion, MAX_DESCRIPCION);

  // Foco al primer campo con error, después de que se pinte el error. Es un efecto que
  // solo toca el DOM (no hay setState adentro).
  useEffect(() => {
    if (!focusRequest) return;
    const element = document.getElementById(focusRequest.domId ?? FIELD_DOM_IDS[focusRequest.field]);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' }); // centrado: no queda bajo el header fijo
  }, [focusRequest]);

  function setField<K extends GastoFormField>(field: K, value: GastoFormValues[K]) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] === undefined ? previous : { ...previous, [field]: undefined }));
  }

  function handleViajeChange(viajeId: string) {
    setField('viajeId', viajeId);
    setViajeElegido(viajes.find((viaje) => viaje.id === viajeId) ?? null);
    // Se deja el viaje que tenía camión: el camión queda elegido (editable), con el valor que tenía.
    if (camionDelViaje) setField('camionId', camionDelViaje);
  }

  function handleCategoriaChange(categoriaId: string) {
    setField('categoriaId', categoriaId);
    // El aviso de "descripción obligatoria" solo vale para "Gastos varios": al cambiar de categoría se descarta
    // (si la nueva también la exige, se vuelve a validar al guardar).
    setErrors((previous) =>
      previous.descripcion === DESCRIPCION_OBLIGATORIA_MESSAGE ? { ...previous, descripcion: undefined } : previous,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateGastoForm(values, { categorias, today: todayLocal(), viajes, camion: resolucionCamion });
    if (!validation.ok) {
      setErrors(validation.errors);
      // El camión no tiene un único control: el foco va al que se está mostrando (botón, lista o bloque).
      const domId = validation.firstField === 'camionId' ? domIdDelCamion(FIELD_DOM_IDS.camionId, decisionCamion) : undefined;
      setFocusRequest((previous) => ({ field: validation.firstField, n: (previous?.n ?? 0) + 1, domId }));
      return;
    }
    setErrors({});
    const { columns } = validation;

    const result = await run<ResultadoGuardado>(async () => {
      if (gasto) {
        try {
          await actualizar.mutateAsync({ tenantId, id: gasto.id, changes: columns });
        } catch (failure) {
          // 0 filas: el gasto ya no existe. No es un error que se arregle reintentando.
          if (failure instanceof RecordNotFoundError) return 'no-encontrado';
          throw failure;
        }
        return 'listo';
      }
      // `crearGasto` trata "ya estaba guardado" (23505 del client_ref) como éxito.
      await crear.mutateAsync({ tenantId, columns, clientRef, sent: sentRef.current });
      return 'listo';
    });

    if (!result.ok) return; // el error ya se muestra en la SubmitBar, sin tocar los campos
    if (!mountedRef.current) return; // se fue de la pantalla mientras guardaba: no arrastrarlo a la lista
    if (result.data === 'no-encontrado') {
      setGone(true);
      return;
    }

    if (!editando) {
      sentRef.current.clear();
      setClientRef(generateClientRef());
    }
    if (desdeViaje) {
      // Se abrió desde el detalle de un viaje: se vuelve a ESE viaje. La ruta se arma acá con un uuid ya validado.
      navigate(rutaDelViaje(desdeViaje.id), {
        replace: true,
        state: { aviso: 'gasto-guardado' satisfies DetalleAviso, volver: desdeViaje.volver, ...estadoDesdeCliente(desdeViaje.cliente) },
      });
      return;
    }
    // A la lista del mes del gasto (si es de otro mes, así se ve que quedó guardado).
    navigate(`/gastos${searchDelMesDeFecha(columns.fecha)}`, { replace: true, state: { aviso: 'guardado' satisfies GastoAviso } });
  }

  if (gone) return <GastoNoEncontrado volver={volver} />;

  return (
    <div className="space-y-8">
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
        <ChoiceGroup
          id="gasto-categoria"
          legend="Categoría"
          value={values.categoriaId}
          onChange={handleCategoriaChange}
          options={opcionesCategoria}
          error={errors.categoriaId}
        />

        {/* Justo debajo de la categoría: es lo que dice de qué se trata el gasto. En "Gastos varios" (la
            categoría más ambigua) es obligatoria; en las demás, opcional. */}
        <TextareaField
          id="gasto-descripcion"
          label="Descripción"
          optional={!gastosVarios}
          value={values.descripcion}
          onChange={(value) => setField('descripcion', value)}
          hint={
            descripcionLength > MAX_DESCRIPCION
              ? `Más de ${MAX_DESCRIPCION} caracteres: acórtala.`
              : descripcionLength >= DESCRIPCION_COUNTER_FROM
                ? `${descripcionLength} de ${MAX_DESCRIPCION} caracteres`
                : gastosVarios
                  ? 'Obligatoria en Gastos varios: escribe de qué se trata.'
                  : undefined
          }
          error={errors.descripcion}
        />

        <NumberField
          id="gasto-monto"
          label="Monto"
          kind="dinero"
          value={values.monto}
          onChange={(value) => setField('monto', value)}
          error={errors.monto}
        />

        {fuel ? (
          <div className="space-y-5 rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-semibold">Combustible</p>
            <CamionSelector
              id={FIELD_DOM_IDS.camionId}
              decision={decisionCamion}
              value={values.camionId}
              onChange={(camionId) => setField('camionId', camionId)}
              error={errors.camionId}
              carga={{
                estado: camionesCargados ? 'listo' : camionesQuery.isError ? 'error' : 'cargando',
                error: camionesQuery.error,
                reintentando: camionesQuery.isFetching,
                onReintentar: () => void camionesQuery.refetch(),
              }}
              esAdmin={member?.rol === 'admin'}
              esElPrimero={camiones !== null && camiones.length === 0}
              onCamionListo={usarCamionNuevo}
            />
            {/* Lo que pasó al cargar o reactivar un camión desde acá (p. ej. cuántos registros sin camión se le asignaron). */}
            <p role="status" aria-live="polite" className={mensajeCamion ? 'text-sm font-medium' : 'sr-only'}>
              {mensajeCamion ?? ''}
            </p>
            <NumberField
              id="gasto-litros"
              label="Litros"
              kind="litros"
              unit="L"
              value={values.litros}
              onChange={(value) => setField('litros', value)}
              error={errors.litros}
            />
            <div className="space-y-1.5">
              <p className="text-sm font-medium leading-none">Precio por litro</p>
              <p className="text-base font-semibold tabular-nums">
                {precioPorLitro !== null ? formatNumber(precioPorLitro, { decimales: 2 }) : '—'}
              </p>
              <p className="text-sm text-muted-foreground">Se calcula solo: monto ÷ litros.</p>
            </div>
            <NumberField
              id="gasto-km"
              label="Km del odómetro"
              kind="km"
              allowZero
              optional
              unit="km"
              hint="La lectura del odómetro al cargar. Sirve para calcular el rendimiento."
              value={values.kmOdometro}
              onChange={(value) => setField('kmOdometro', value)}
              error={errors.kmOdometro}
            />
            <ChoiceGroup
              id="gasto-tanque"
              legend="¿Llenaste el tanque?"
              optional
              columns={3}
              value={values.tanqueLleno}
              onChange={(value) => setField('tanqueLleno', value as TanqueLlenoChoice)}
              options={TANQUE_OPTIONS}
              hint="Con tanque lleno se puede calcular el rendimiento (km por litro)."
              error={errors.tanqueLleno}
            />
          </div>
        ) : null}

        <DateField
          id="gasto-fecha"
          label="Fecha"
          min={MIN_FECHA}
          max={today}
          value={values.fecha}
          onChange={(value) => setField('fecha', value)}
          error={errors.fecha}
        />

        <div className="space-y-2">
          <SelectField
            id={FIELD_DOM_IDS.viajeId}
            label="Viaje"
            optional
            placeholder="Sin viaje"
            options={opcionesViaje}
            value={values.viajeId}
            onChange={handleViajeChange}
            hint={
              viajesQuery.isPending
                ? 'Cargando viajes…'
                : (recientes?.length ?? 0) >= RECIENTES_LIMIT
                  ? `Se muestran los ${RECIENTES_LIMIT} viajes más recientes.`
                  : undefined
            }
            error={errors.viajeId}
          />
          {/* Solo si NO hay lista: un refresco fallido con la lista ya cargada no molesta. No bloquea el guardado. */}
          {viajesQuery.isError && recientes === undefined ? (
            <InlineError
              message={`No pudimos cargar los viajes. ${mapDataError(viajesQuery.error)}`}
              onRetry={() => void viajesQuery.refetch()}
              retrying={viajesQuery.isFetching}
            />
          ) : null}
        </div>

        <SelectField
          id="gasto-metodo"
          label="Método de pago"
          optional
          placeholder="Sin especificar"
          options={METODO_PAGO_OPTIONS}
          value={values.metodoPago}
          onChange={(value) => setField('metodoPago', value as GastoFormValues['metodoPago'])}
          error={errors.metodoPago}
        />

        {/* Avisa a lectores de pantalla que aparecieron los campos de combustible. */}
        <p role="status" className="sr-only">
          {fuel ? 'Se agregaron los campos de combustible: litros, km del odómetro y tanque lleno.' : ''}
        </p>

        <SubmitBar pending={pending} error={error} retryable={retryable} label="Guardar gasto" />
      </form>

      {gasto ? (
        <div className="border-t border-border pt-6">
          <ConfirmDelete
            label="Eliminar gasto"
            context={ELIMINAR_GASTO_CONTEXT}
            onConfirm={async () => {
              // 0 filas borradas = ya no estaba: para un borrado es lo mismo que éxito.
              await eliminar.mutateAsync({ tenantId, id: gasto.id });
              if (!mountedRef.current) return; // se fue de la pantalla mientras borraba
              if (desdeViaje) {
                navigate(rutaDelViaje(desdeViaje.id), {
                  replace: true,
                  state: {
                    aviso: 'gasto-eliminado' satisfies DetalleAviso,
                    volver: desdeViaje.volver,
                    ...estadoDesdeCliente(desdeViaje.cliente),
                  },
                });
                return;
              }
              navigate(`/gastos${volver}`, { replace: true, state: { aviso: 'eliminado' satisfies GastoAviso } });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
