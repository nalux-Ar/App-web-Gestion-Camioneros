import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceGroup } from '@/components/shared/choice-group';
import { ConfirmDelete } from '@/components/shared/confirm-delete';
import { DateField } from '@/components/shared/date-field';
import { NumberField } from '@/components/shared/number-field';
import { SelectField } from '@/components/shared/select-field';
import { SubmitBar } from '@/components/shared/submit-bar';
import { TextareaField } from '@/components/shared/textarea-field';
import { useTenantId } from '@/features/member/use-tenant-id';
import { RecordNotFoundError } from '@/lib/data-errors';
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
  litros: 'gasto-litros',
  kmOdometro: 'gasto-km',
  tanqueLleno: 'gasto-tanque-0',
  fecha: 'gasto-fecha',
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
 * Combustible: con la categoría Combustible aparecen litros, km del odómetro y tanque lleno;
 * el precio por litro NO se tipea, se calcula (monto ÷ litros). Si se cambia a otra categoría,
 * esos campos desaparecen y al guardar se mandan en NULL (también en el UPDATE).
 */
export function GastoFormulario({ categorias, gasto, volver }: GastoFormularioProps) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const editando = gasto !== undefined;

  const [values, setValues] = useState<GastoFormValues>(() =>
    gasto ? valuesFromGasto(gasto) : emptyGastoValues(todayLocal()),
  );
  const [errors, setErrors] = useState<GastoFormErrors>({});
  const [focusRequest, setFocusRequest] = useState<{ field: GastoFormField; n: number } | null>(null);
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

  const fuel = esCombustibleElegida(values.categoriaId, categorias);
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
    const element = document.getElementById(FIELD_DOM_IDS[focusRequest.field]);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' }); // centrado: no queda bajo el header fijo
  }, [focusRequest]);

  function setField<K extends GastoFormField>(field: K, value: GastoFormValues[K]) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] === undefined ? previous : { ...previous, [field]: undefined }));
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

    const validation = validateGastoForm(values, { categorias, today: todayLocal() });
    if (!validation.ok) {
      setErrors(validation.errors);
      setFocusRequest((previous) => ({ field: validation.firstField, n: (previous?.n ?? 0) + 1 }));
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
    // A la lista del mes del gasto (si es de otro mes, así se ve que quedó guardado).
    navigate(`/gastos${searchDelMesDeFecha(columns.fecha)}`, { replace: true, state: { aviso: 'guardado' satisfies GastoAviso } });
  }

  if (gone) return <GastoNoEncontrado volver={volver} />;

  const today = todayLocal();

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
              navigate(`/gastos${volver}`, { replace: true, state: { aviso: 'eliminado' satisfies GastoAviso } });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
