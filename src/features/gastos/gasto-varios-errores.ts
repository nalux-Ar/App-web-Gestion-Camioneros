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
 *  - Con un solo bloque (`'una'`: una categoría marcada, ninguna o la edición): el orden de siempre, `GASTO_FIELD_ORDER`
 *    (categoría, descripción, monto, camión, litros, km, tanque, fecha, viaje, método de pago).
 *  - Con varios (`'varias'`): el grupo de categorías; después, bloque por bloque (en el orden de los bloques), su descripción, monto y lo
 *    del combustible; después la fecha y el viaje; y AL FINAL el método de pago de cada bloque (van juntos abajo del todo).
 */
export function camposEnOrdenVisual(disposicion: 'una' | 'varias', claves: readonly string[]): PuestoDeCampo[] {
  if (disposicion === 'una') {
    const clave = claves[0] ?? '';
    return GASTO_FIELD_ORDER.map((campo) => ({ campo, clave: campo === 'categoriaId' || esCampoCompartido(campo) ? null : clave }));
  }
  return [
    { campo: 'categoriaId', clave: null },
    ...claves.flatMap((clave) => CAMPOS_DEL_BLOQUE.map((campo) => ({ campo, clave }))),
    { campo: 'fecha', clave: null },
    { campo: 'viajeId', clave: null },
    ...claves.map((clave) => ({ campo: 'metodoPago' as const, clave })),
  ];
}

/** El primer lugar, en el orden en que se ven los campos, que tiene un error; null si no hay ninguno. */
export function primerErrorVisual(
  errores: ErroresDeCarga,
  disposicion: 'una' | 'varias',
  claves: readonly string[],
): PuestoDeCampo | null {
  return camposEnOrdenVisual(disposicion, claves).find((puesto) => mensajeDe(errores, puesto) !== undefined) ?? null;
}
