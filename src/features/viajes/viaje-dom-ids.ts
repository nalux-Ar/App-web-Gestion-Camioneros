import type { EntregaField, ViajeFocusTarget, ViajeFormField } from './viaje-form';

/**
 * ids de los campos en el DOM: a dónde va el foco cuando falla la validación (y cuando se agrega o quita
 * una entrega). Los usa el formulario, la sección de entregas y las pruebas.
 */

export const CAMPO_DOM_IDS: Record<ViajeFormField, string> = {
  fecha: 'viaje-fecha',
  origen: 'viaje-origen',
  destino: 'viaje-destino',
  kmInicial: 'viaje-km-inicial',
  kmFinal: 'viaje-km-final',
  kmRecorridos: 'viaje-km-recorridos',
  ingreso: 'viaje-ingreso',
  observaciones: 'viaje-observaciones',
};

/** Encabezado de la sección de entregas (foco para los errores de la sección completa). */
export const ENTREGAS_DOM_ID = 'viaje-entregas';

/** Botón "Agregar entrega". */
export const AGREGAR_ENTREGA_DOM_ID = 'viaje-entregas-agregar';

const ENTREGA_SUFIJOS: Record<EntregaField, string> = {
  clienteId: 'cliente',
  incidencias: 'incidencias',
};

/** Id del control de una fila de entrega: anclado a la `key` local de la fila, no a su posición. */
export function entregaDomId(key: string, field: EntregaField): string {
  return `entrega-${key}-${ENTREGA_SUFIJOS[field]}`;
}

/** Foco pedido desde el formulario: un error de validación, o el botón de agregar tras quitar una entrega. */
export type FocusRequest = ViajeFocusTarget | { tipo: 'agregar' };

export function domIdOf(target: FocusRequest): string {
  switch (target.tipo) {
    case 'campo':
      return CAMPO_DOM_IDS[target.field];
    case 'entregas':
      return ENTREGAS_DOM_ID;
    case 'agregar':
      return AGREGAR_ENTREGA_DOM_ID;
    case 'entrega':
      return entregaDomId(target.key, target.field);
  }
}
