import type { ClienteOpcion } from '@/features/clientes/cliente-nombre';
import { GRUPO_CLIENTES, GRUPO_CLIENTES_DEL_VIAJE, GRUPO_OTROS_CLIENTES } from './constants';

/**
 * Cómo se agrupan los clientes en el selector de una devolución. Lógica pura.
 *
 * Lo más probable es que la devolución sea de un cliente al que se le hizo una entrega en ese mismo viaje: esos van
 * primero, en un grupo propio, y debajo "Otros clientes" con todos los demás (la base permite una devolución de un
 * cliente sin entrega en el viaje). Si el viaje no tiene entregas (o ninguna de un cliente conocido) no hay nada que
 * destacar: un solo grupo "Clientes".
 */

export interface GrupoDeClientes {
  label: string;
  clientes: ClienteOpcion[];
}

/**
 * @param clientes Todos los clientes elegibles, en el orden de la lista de clientes (por nombre): ese orden se
 *   conserva dentro de cada grupo.
 * @param idsDelViaje Los `cliente_id` de las entregas del viaje (pueden repetirse, o no estar en `clientes`).
 *
 * Se recorre `clientes` (no las entregas): así no hay duplicados aunque un cliente tenga varias entregas, y un
 * cliente de una entrega que no está en la lista (pasó del tope de la lista, o ya no existe) simplemente no se
 * ofrece. Nunca devuelve un grupo vacío.
 */
export function agruparClientes(clientes: readonly ClienteOpcion[], idsDelViaje: ReadonlyArray<string>): GrupoDeClientes[] {
  if (clientes.length === 0) return [];

  const delViaje = new Set(idsDelViaje);
  const primeros = clientes.filter((cliente) => delViaje.has(cliente.id));
  if (primeros.length === 0) return [{ label: GRUPO_CLIENTES, clientes: [...clientes] }];

  const otros = clientes.filter((cliente) => !delViaje.has(cliente.id));
  if (otros.length === 0) return [{ label: GRUPO_CLIENTES_DEL_VIAJE, clientes: primeros }];
  return [
    { label: GRUPO_CLIENTES_DEL_VIAJE, clientes: primeros },
    { label: GRUPO_OTROS_CLIENTES, clientes: otros },
  ];
}
