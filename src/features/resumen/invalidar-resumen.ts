import type { QueryClient } from '@tanstack/react-query';

import { resumenKeys } from './resumen-keys';

/**
 * Marca viejo TODO el Resumen del tenant (todos los bloques y todos los períodos). Lo llaman, en su `onSettled` (también
 * si fallan: con un timeout la escritura pudo haberse aplicado igual), las mutaciones que cambian lo que leen las
 * funciones de la 014:
 *  - crear, editar y borrar un gasto (montos, categoría, método, camión, litros, odómetro, tanque lleno, fecha);
 *  - crear, editar y borrar un viaje (ingreso, km, fecha, camión; editar el camión mueve el de sus gastos, y borrar
 *    desvincula sus gastos, lo que cambia el camión imputado de los que no son combustible);
 *  - el alta del PRIMER camión (`crear_camion` le asigna los viajes sin camión y las cargas sin camión) y editar,
 *    archivar o reactivar un camión (las funciones devuelven su patente y si está activo).
 * La pantalla no está montada mientras se edita: solo queda marcada como vieja y se vuelve a pedir al entrar. No se
 * espera la invalidación (`void`).
 */
export function invalidarResumen(queryClient: QueryClient, tenantId: string): void {
  void queryClient.invalidateQueries({ queryKey: resumenKeys.all(tenantId) });
}
