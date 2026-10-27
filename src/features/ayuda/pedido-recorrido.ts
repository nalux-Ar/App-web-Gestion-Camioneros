import { useSyncExternalStore } from 'react';

/**
 * "Ver el recorrido otra vez": un contador de pedidos en una variable de módulo (no en estado de React), para que el botón
 * de Inicio pida el recorrido sin conocer al componente que lo muestra (el disparador del AppShell). Cada pedido sube el
 * contador; el disparador atiende los que todavía no atendió. No escribe nada en la base.
 */
let pedidos = 0;
const oyentes = new Set<() => void>();

export function pedirRecorrido(): void {
  pedidos += 1;
  for (const oyente of oyentes) oyente();
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/** El número de pedidos hasta ahora. */
export function usePedidosDeRecorrido(): number {
  return useSyncExternalStore(suscribir, () => pedidos);
}
