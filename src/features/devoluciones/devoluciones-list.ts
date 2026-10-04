import type { MotivoDevolucion } from '@/lib/db';
import { MOTIVO_LABELS, MOTIVO_ORDER } from './constants';

/** Lógica pura de la lista de devoluciones de un mes: el resumen (total y conteo por motivo) y sus textos. */

export interface ConteoPorMotivo {
  motivo: MotivoDevolucion;
  cantidad: number;
}

export interface ResumenDevoluciones {
  total: number;
  /** Solo los motivos con al menos una devolución, en el orden fijo de `MOTIVO_ORDER` (no el de aparición). */
  porMotivo: ConteoPorMotivo[];
}

/** Total y conteo por motivo de las devoluciones que se están viendo (si la lista es parcial, el resumen también). */
export function resumenDelMes(devoluciones: ReadonlyArray<{ motivo: MotivoDevolucion }>): ResumenDevoluciones {
  const cantidades = new Map<MotivoDevolucion, number>();
  for (const { motivo } of devoluciones) cantidades.set(motivo, (cantidades.get(motivo) ?? 0) + 1);
  const porMotivo = MOTIVO_ORDER.flatMap((motivo) => {
    const cantidad = cantidades.get(motivo) ?? 0;
    return cantidad > 0 ? [{ motivo, cantidad }] : [];
  });
  return { total: devoluciones.length, porMotivo };
}

/** "1 devolución" / "N devoluciones"; con la lista parcial, "(las más recientes)" como en el resumen de viajes. */
export function textoTotalDevoluciones(total: number, truncado: boolean): string {
  if (total === 1) return '1 devolución';
  return `${total} devoluciones${truncado ? ' (las más recientes)' : ''}`;
}

/** "Rotura o daño 2 · Vencimiento 1": solo los motivos con al menos una. */
export function textoPorMotivo(porMotivo: ReadonlyArray<ConteoPorMotivo>): string {
  return porMotivo.map(({ motivo, cantidad }) => `${MOTIVO_LABELS[motivo]} ${cantidad}`).join(' · ');
}
