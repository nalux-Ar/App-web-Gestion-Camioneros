import { GASTO_FIELD_ORDER, type GastoFormErrors, type GastoFormField } from './gasto-form';
import {
  esCampoCompartido,
  type CampoCompartido,
  type CampoDeBloque,
  type ErroresCompartidos,
  type ErroresDeBloque,
  type LoteValidation,
} from './gasto-lote';

/**
 * Dónde se muestra cada error de «Nuevo gasto» y a cuál se lleva el foco. Lógica PURA.
 *
 * Los errores se guardan igual con una categoría marcada que con varias: los de la fecha y el viaje (`compartidos`: son uno solo para
 * toda la carga), los del grupo de categorías (`categoria`) y los de cada bloque, por la clave del bloque (el id de su categoría, o
 * `SIN_CATEGORIA` cuando no hay ninguna marcada).
 */
export interface ErroresDeCarga {
  categoria?: string;
  compartidos: ErroresCompartidos;
  bloques: Readonly<Record<string, ErroresDeBloque>>;
}

export const SIN_ERRORES: ErroresDeCarga = { compartidos: {}, bloques: {} };

/** Los errores de `validateGastoForm` (un solo gasto) ubicados donde se muestran: el campo de categoría, lo compartido y el bloque de esa clave. */
export function erroresDeUnGasto(clave: string, errors: GastoFormErrors): ErroresDeCarga {
  const compartidos: ErroresCompartidos = {};
  const bloque: ErroresDeBloque = {};
  let categoria: string | undefined;
  for (const [campo, mensaje] of Object.entries(errors) as Array<[GastoFormField, string | undefined]>) {
    if (mensaje === undefined) continue;
    if (campo === 'categoriaId') categoria = mensaje;
    else if (esCampoCompartido(campo)) compartidos[campo] = mensaje;
    else bloque[campo] = mensaje;
  }
  return {
    ...(categoria === undefined ? {} : { categoria }),
    compartidos,
    bloques: Object.keys(bloque).length > 0 ? { [clave]: bloque } : {},
  };
}

/** Los errores de `validateLoteDeGastos` (varios gastos) ubicados donde se muestran. */
export function erroresDelLote(validacion: Extract<LoteValidation, { ok: false }>): ErroresDeCarga {
  const bloques: Record<string, ErroresDeBloque> = {};
  for (const { categoriaId, errors } of validacion.bloques) bloques[categoriaId] = errors;
  return { compartidos: validacion.compartidos, bloques };
}

/** Saca el error de un campo de un bloque (al corregirlo). Devuelve el mismo objeto si no había nada que sacar. */
export function sinErrorDelBloque(errores: ErroresDeCarga, clave: string, campo: CampoDeBloque): ErroresDeCarga {
  const delBloque = Object.hasOwn(errores.bloques, clave) ? errores.bloques[clave]! : undefined;
  if (delBloque === undefined || delBloque[campo] === undefined) return errores;
  const resto = { ...delBloque };
  delete resto[campo];
  const bloques = { ...errores.bloques };
  if (Object.keys(resto).length > 0) bloques[clave] = resto;
  else delete bloques[clave];
  return { ...errores, bloques };
}

/** Saca el error de la fecha o del viaje (al corregirlo). */
export function sinErrorCompartido(errores: ErroresDeCarga, campo: CampoCompartido): ErroresDeCarga {
  if (errores.compartidos[campo] === undefined) return errores;
  const compartidos = { ...errores.compartidos };
  delete compartidos[campo];
  return { ...errores, compartidos };
}

/** Saca el error del grupo de categorías. */
export function sinErrorDeCategoria(errores: ErroresDeCarga): ErroresDeCarga {
  if (errores.categoria === undefined) return errores;
  const resto = { ...errores };
  delete resto.categoria;
  return resto;
}

/** Saca todos los errores de esos bloques (al marcar o desmarcar categorías: el bloque ya no es el mismo). */
export function sinErroresDeBloques(errores: ErroresDeCarga, claves: readonly string[]): ErroresDeCarga {
  if (!claves.some((clave) => Object.hasOwn(errores.bloques, clave))) return errores;
  const bloques = { ...errores.bloques };
  for (const clave of claves) delete bloques[clave];
  return { ...errores, bloques };
}

/** ¿Hay algún error para mostrar? */
export function hayErrores(errores: ErroresDeCarga): boolean {
  return (
    errores.categoria !== undefined ||
    Object.values(errores.compartidos).some((mensaje) => mensaje !== undefined) ||
    Object.values(errores.bloques).some((bloque) => Object.values(bloque).some((mensaje) => mensaje !== undefined))
  );
}

/**
 * Un lugar de la pantalla donde puede haber un error: un campo de un bloque (`clave` = el del bloque) o un campo que no es de ningún
 * bloque (el grupo de categorías, la fecha y el viaje: `clave` = null).
 */
export interface PuestoDeCampo {
  campo: GastoFormField;
  clave: string | null;
}

/** El orden de los campos DENTRO de un bloque, tal como se ven (el de `GASTO_FIELD_ORDER` sin lo compartido ni el método de pago). */
const CAMPOS_DEL_BLOQUE: readonly CampoDeBloque[] = GASTO_FIELD_ORDER.filter(
  (campo): campo is CampoDeBloque => campo !== 'categoriaId' && campo !== 'metodoPago' && !esCampoCompartido(campo),
);

/** Lo del bloque que está SIEMPRE a su lado: todo menos la descripción (que o va arriba, en «Gastos varios», o va en el pliegue de notas). */
const CAMPOS_DEL_BLOQUE_SIN_DESCRIPCION: readonly CampoDeBloque[] = CAMPOS_DEL_BLOQUE.filter((campo) => campo !== 'descripcion');

/** Lo que va ANTES del método de pago con un solo bloque: categoría, descripción, monto, camión, litros, km y tanque (el orden de `GASTO_FIELD_ORDER`). */
const CAMPOS_ANTES_DEL_METODO: readonly GastoFormField[] = GASTO_FIELD_ORDER.filter(
  (campo) => campo !== 'metodoPago' && campo !== 'fecha' && campo !== 'viajeId',
);

/**
 * El orden de TODOS los campos con un solo bloque, tal como se ven. NO es `GASTO_FIELD_ORDER` (ese es el de la validación): en pantalla
 * el método de pago va ANTES de la fecha y el viaje, y la descripción de una categoría común va en el pliegue «Agregar nota o viaje»
 * (después de la fecha, antes del viaje). La de «Gastos varios» no se pliega: queda arriba, justo debajo de la categoría.
 */
const ORDEN_VISUAL_DE_UN_BLOQUE_COMUN: readonly GastoFormField[] = [
  ...CAMPOS_ANTES_DEL_METODO.filter((campo) => campo !== 'descripcion'),
  'metodoPago',
  'fecha',
  'descripcion',
  'viajeId',
];
const ORDEN_VISUAL_DE_UN_BLOQUE_VARIOS: readonly GastoFormField[] = [...CAMPOS_ANTES_DEL_METODO, 'metodoPago', 'fecha', 'viajeId'];

function mensajeDe(errores: ErroresDeCarga, puesto: PuestoDeCampo): string | undefined {
  if (puesto.clave === null) {
    if (puesto.campo === 'categoriaId') return errores.categoria;
    if (esCampoCompartido(puesto.campo)) return errores.compartidos[puesto.campo];
    return undefined;
  }
  return Object.hasOwn(errores.bloques, puesto.clave) ? errores.bloques[puesto.clave]![puesto.campo as CampoDeBloque] : undefined;
}

/**
 * Los campos de la pantalla EN EL ORDEN EN QUE SE VEN, para llevar el foco al primero con error.
 *
 * `clavesDeVarios` son los bloques que son «Gastos varios» (su descripción es obligatoria y va arriba, a la vista); en los demás la
 * descripción es una nota que va en el pliegue «Agregar nota o viaje», DESPUÉS de la fecha. Sin ese dato todos los bloques cuentan como
 * comunes.
 *
 *  - Con un solo bloque (`'una'`: una categoría marcada, ninguna o la edición):
 *      común:          categoría, monto, camión, litros, km, tanque, método de pago, fecha, descripción (nota), viaje.
 *      «Gastos varios»: categoría, descripción, monto, camión, litros, km, tanque, método de pago, fecha, viaje.
 *  - Con varios (`'varias'`): el grupo de categorías; después, bloque por bloque (en el orden de los bloques), [su descripción si es
 *    «Gastos varios»], monto y lo del combustible; después el método de pago de cada bloque (van juntos, en el grupo «¿Cómo pagaste cada
 *    gasto?»); la fecha; las notas de los bloques que no son «Gastos varios» (en el orden de los bloques, en el pliegue); y AL FINAL el viaje.
 */
export function camposEnOrdenVisual(
  disposicion: 'una' | 'varias',
  claves: readonly string[],
  clavesDeVarios: readonly string[] = [],
): PuestoDeCampo[] {
  if (disposicion === 'una') {
    const clave = claves[0] ?? '';
    const orden = clavesDeVarios.includes(clave) ? ORDEN_VISUAL_DE_UN_BLOQUE_VARIOS : ORDEN_VISUAL_DE_UN_BLOQUE_COMUN;
    return orden.map((campo) => ({ campo, clave: campo === 'categoriaId' || esCampoCompartido(campo) ? null : clave }));
  }
  const comunes = claves.filter((clave) => !clavesDeVarios.includes(clave));
  return [
    { campo: 'categoriaId', clave: null },
    ...claves.flatMap((clave) => [
      ...(clavesDeVarios.includes(clave) ? [{ campo: 'descripcion' as const, clave }] : []),
      ...CAMPOS_DEL_BLOQUE_SIN_DESCRIPCION.map((campo) => ({ campo, clave })),
    ]),
    ...claves.map((clave) => ({ campo: 'metodoPago' as const, clave })),
    { campo: 'fecha', clave: null },
    ...comunes.map((clave) => ({ campo: 'descripcion' as const, clave })),
    { campo: 'viajeId', clave: null },
  ];
}

/** El primer lugar, en el orden en que se ven los campos, que tiene un error; null si no hay ninguno. */
export function primerErrorVisual(
  errores: ErroresDeCarga,
  disposicion: 'una' | 'varias',
  claves: readonly string[],
  clavesDeVarios: readonly string[] = [],
): PuestoDeCampo | null {
  return camposEnOrdenVisual(disposicion, claves, clavesDeVarios).find((puesto) => mensajeDe(errores, puesto) !== undefined) ?? null;
}
