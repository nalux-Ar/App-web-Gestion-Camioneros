// «Nuevo gasto» y la edición: la nota (la descripción) y el viaje van plegados detrás de un botón («Agregar nota o viaje»), salvo la
// descripción de «Gastos varios», que es obligatoria y va siempre a la vista con otra pregunta («¿En qué gastaste?»).
// Textos y reglas PURAS de ese pliegue.

/** La pregunta de la descripción de «Gastos varios»: es obligatoria, así que no lleva «(opcional)» y no se esconde. */
export const ETIQUETA_EN_QUE_GASTASTE = '¿En qué gastaste?';

/** La ayuda debajo de «¿En qué gastaste?» (la validación sigue siendo la de siempre: sin texto no se guarda). */
export const AYUDA_EN_QUE_GASTASTE = 'Es obligatorio: cuéntanos de qué se trata.';

/** El rótulo de la descripción de un gasto cuando hay UNA sola categoría (o ninguna): el de siempre. */
export const ETIQUETA_DESCRIPCION = 'Descripción';

/** El rótulo de la nota de un gasto cuando hay VARIAS categorías: dice de cuál es («Nota de Peajes»). */
export function etiquetaDeNota(nombreDeCategoria: string): string {
  return `Nota de ${nombreDeCategoria}`;
}

/**
 * Lo que dice el botón que despliega el pliegue, según cuántas notas hay adentro (las de las categorías que NO son «Gastos varios»;
 * la de «Gastos varios» siempre está a la vista):
 *  - ninguna: solo queda el viaje → «Agregar viaje»;
 *  - una: «Agregar nota o viaje»;
 *  - dos o más (varias categorías): «Agregar notas o viaje».
 */
export function textoDelPliegue(cantidadDeNotas: number): string {
  if (cantidadDeNotas <= 0) return 'Agregar viaje';
  return cantidadDeNotas === 1 ? 'Agregar nota o viaje' : 'Agregar notas o viaje';
}

/**
 * ¿Hay algo escrito o elegido dentro del pliegue? Entonces se ve desplegado desde el principio: un pliegue cerrado no puede esconder
 * datos (un gasto que se edita y ya tiene nota o viaje, un viaje que llega elegido, una nota que pasó a otra categoría).
 * `notas` son los textos de las notas que están en el pliegue.
 */
export function hayDatosEnElPliegue({ viajeId, notas }: { viajeId: string; notas: readonly string[] }): boolean {
  return viajeId !== '' || notas.some((nota) => nota.trim() !== '');
}
