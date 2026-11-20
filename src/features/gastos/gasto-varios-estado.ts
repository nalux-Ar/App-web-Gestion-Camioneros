import type { MetodoPago } from '@/lib/db';

/**
 * Lo que se escribe en «Nuevo gasto» cuando se puede marcar MÁS DE UNA categoría. Lógica PURA (sin React): qué categorías están
 * marcadas y qué se escribió en el bloque de cada una.
 *
 * Cada categoría marcada es un BLOQUE con su monto, su descripción y su método de pago. Lo que es de toda la carga (fecha y viaje)
 * y lo del combustible (camión, litros, km y tanque lleno: solo existe un bloque de Combustible) NO está acá: vive en el formulario.
 *
 * Qué se ve mientras hay 0 o 1 categoría marcada: UN solo juego de campos, igual que antes de poder marcar varias. Mientras no hay
 * ninguna marcada ese juego es el «borrador» (clave `SIN_CATEGORIA`): lo escrito ahí lo hereda la primera categoría que se marque, y
 * si se desmarca la última, lo escrito vuelve al borrador. Así, cambiar de categoría (desmarcar una y marcar otra) no hace perder lo
 * que ya se escribió, como cuando la categoría era una sola opción.
 */

/** La clave del borrador: el juego de campos que se ve cuando no hay ninguna categoría marcada. */
export const SIN_CATEGORIA = '';

/** Lo que se completa por categoría. Todo texto, tal cual lo tipeó el usuario (como `GastoFormValues`). */
export interface CamposDelBloque {
  monto: string;
  descripcion: string;
  /** '' = todavía sin elegir (obligatorio en CADA bloque: el método es de cada gasto). */
  metodoPago: '' | MetodoPago;
}

export type CampoDelBloque = keyof CamposDelBloque;

export const BLOQUE_VACIO: CamposDelBloque = { monto: '', descripcion: '', metodoPago: '' };

export interface CargaDeGastos {
  /** Los ids de las categorías marcadas, sin repetir. El orden en pantalla lo da la lista de categorías, no el de los toques. */
  elegidas: readonly string[];
  /** Lo escrito por categoría (y, con la clave `SIN_CATEGORIA`, el borrador). De una categoría desmarcada se conserva por si se vuelve a marcar. */
  bloques: Readonly<Record<string, CamposDelBloque>>;
}

/** Una carga sin nada marcado y sin nada escrito. */
export const CARGA_VACIA: CargaDeGastos = { elegidas: [], bloques: {} };

/** Lo escrito en el bloque de esa clave (la de una categoría o `SIN_CATEGORIA`); vacío si todavía no se escribió nada. */
export function bloqueDe(carga: CargaDeGastos, clave: string): CamposDelBloque {
  return Object.hasOwn(carga.bloques, clave) ? carga.bloques[clave]! : BLOQUE_VACIO;
}

/** ¿No se escribió nada en este bloque? */
export function bloqueEstaVacio(bloque: CamposDelBloque): boolean {
  return bloque.monto === '' && bloque.descripcion === '' && bloque.metodoPago === '';
}

function sinClave(bloques: Readonly<Record<string, CamposDelBloque>>, clave: string): Record<string, CamposDelBloque> {
  const copia = { ...bloques };
  delete copia[clave];
  return copia;
}

/**
 * Marca la categoría si no estaba marcada y la desmarca si lo estaba.
 *
 *  - Marcar una más: se agrega su bloque (con lo que tuviera escrito de antes, o vacío).
 *  - Desmarcar una (quedan otras): su bloque desaparece de la pantalla, pero lo escrito se conserva por si se vuelve a marcar.
 *  - Desmarcar la ÚLTIMA: lo escrito pasa al borrador (sigue a la vista, sin categoría).
 *  - Marcar la PRIMERA (no había ninguna): hereda el borrador, si el borrador tiene algo escrito; si no, lo que ella ya tuviera.
 */
export function alternarCategoria(carga: CargaDeGastos, categoriaId: string): CargaDeGastos {
  if (categoriaId === SIN_CATEGORIA) return carga;

  if (carga.elegidas.includes(categoriaId)) {
    const quedan = carga.elegidas.filter((id) => id !== categoriaId);
    if (quedan.length > 0) return { elegidas: quedan, bloques: carga.bloques };
    return { elegidas: [], bloques: { ...sinClave(carga.bloques, categoriaId), [SIN_CATEGORIA]: bloqueDe(carga, categoriaId) } };
  }

  if (carga.elegidas.length === 0) {
    const borrador = bloqueDe(carga, SIN_CATEGORIA);
    const heredado = bloqueEstaVacio(borrador) ? bloqueDe(carga, categoriaId) : borrador;
    return { elegidas: [categoriaId], bloques: { ...sinClave(carga.bloques, SIN_CATEGORIA), [categoriaId]: heredado } };
  }

  return { elegidas: [...carga.elegidas, categoriaId], bloques: carga.bloques };
}

/**
 * Deja marcada SOLO esta categoría (la edición de un gasto, que tiene una sola): lo escrito pasa de la anterior a la nueva, como
 * cuando la categoría era una opción entre varias. Con la misma categoría no cambia nada.
 */
export function elegirUnica(carga: CargaDeGastos, categoriaId: string): CargaDeGastos {
  if (carga.elegidas.length === 1 && carga.elegidas[0] === categoriaId) return carga;
  const sinElegir = carga.elegidas.reduce(alternarCategoria, carga);
  return alternarCategoria(sinElegir, categoriaId);
}

/** Cambia un campo del bloque de esa clave. */
export function cambiarCampo<K extends CampoDelBloque>(
  carga: CargaDeGastos,
  clave: string,
  campo: K,
  valor: CamposDelBloque[K],
): CargaDeGastos {
  return { elegidas: carga.elegidas, bloques: { ...carga.bloques, [clave]: { ...bloqueDe(carga, clave), [campo]: valor } } };
}

/** Una carga con UNA categoría marcada y lo escrito (la edición de un gasto: arranca con su categoría y sus datos). */
export function cargaConUna(categoriaId: string, bloque: CamposDelBloque): CargaDeGastos {
  return { elegidas: [categoriaId], bloques: { [categoriaId]: bloque } };
}

/** Una carga sin ninguna categoría marcada y con un borrador escrito. */
export function cargaConBorrador(bloque: CamposDelBloque): CargaDeGastos {
  return { elegidas: [], bloques: { [SIN_CATEGORIA]: bloque } };
}
