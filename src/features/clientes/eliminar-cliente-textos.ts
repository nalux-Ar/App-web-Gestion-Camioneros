import type { ConteosDelCliente } from './clientes-api';

/**
 * Textos de la confirmación de borrar un cliente. Lógica PURA.
 *
 * Un cliente con entregas o devoluciones NO se puede borrar: `entregas_cliente_fk` y `devoluciones_cliente_fk` son
 * ON DELETE RESTRICT. Por eso, al abrir la confirmación se cuentan las dos cosas (siempre fresco) y:
 *  - sin ninguna: la confirmación de siempre;
 *  - con alguna: NO se ofrece borrar y se explica por qué, con los números (y que se puede renombrar);
 *  - si el conteo falla: se deja intentar. Es seguro: si tiene entregas o devoluciones, la base rechaza el borrado sin
 *    tocar nada (RESTRICT) y el error lo dice. A diferencia de un viaje (que se lleva sus devoluciones en cascada), acá un
 *    borrado nunca destruye datos de otras tablas, así que no hace falta volver a contar justo antes de borrar: si entre la
 *    confirmación y el borrado alguien cargó una entrega de este cliente, la base lo frena igual.
 */

export type EstadoConteosCliente =
  /** Todavía no se sabe: el botón de confirmar espera (un texto que cambia bajo el dedo sería confuso). */
  | { tipo: 'cargando' }
  | ({ tipo: 'listo' } & ConteosDelCliente)
  /** No se pudo contar: se puede intentar igual (la base protege). */
  | { tipo: 'error' };

export interface TextosBorradoCliente {
  prompt: string;
  /** false mientras se averigua el conteo. */
  puedeConfirmar: boolean;
  /** true si el cliente tiene entregas o devoluciones: no se ofrece el botón de borrar. */
  bloqueado: boolean;
}

export const PREGUNTA_REVISANDO_CLIENTE = 'Revisando si el cliente tiene entregas o devoluciones…';
export const PREGUNTA_SIN_NADA_CLIENTE = '¿Seguro? Esto no se puede deshacer.';
export const PREGUNTA_GENERICA_CLIENTE =
  '¿Seguro? Si el cliente tiene entregas o devoluciones no se va a poder eliminar. Esto no se puede deshacer.';

/** Un conteo no negativo y entero: lo que no lo sea cuenta como 0 (no se inventa un texto con cantidades raras). */
function cantidadValida(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0;
}

function entregasEn(cantidad: number): string {
  return cantidad === 1 ? '1 entrega' : `${cantidad} entregas`;
}

function devolucionesEn(cantidad: number): string {
  return cantidad === 1 ? '1 devolución' : `${cantidad} devoluciones`;
}

/** "No se puede eliminar: tiene 3 entregas y 1 devolución. Puedes renombrarlo." (solo lo que tenga). */
export function textoNoSePuedeEliminar({ entregas, devoluciones }: ConteosDelCliente): string {
  const e = cantidadValida(entregas);
  const d = cantidadValida(devoluciones);
  const tiene = e > 0 && d > 0 ? `${entregasEn(e)} y ${devolucionesEn(d)}` : e > 0 ? entregasEn(e) : devolucionesEn(d);
  return `No se puede eliminar: tiene ${tiene}. Puedes renombrarlo.`;
}

export function textosBorradoCliente(estado: EstadoConteosCliente): TextosBorradoCliente {
  if (estado.tipo === 'cargando') return { prompt: PREGUNTA_REVISANDO_CLIENTE, puedeConfirmar: false, bloqueado: false };
  if (estado.tipo === 'error') return { prompt: PREGUNTA_GENERICA_CLIENTE, puedeConfirmar: true, bloqueado: false };
  if (cantidadValida(estado.entregas) === 0 && cantidadValida(estado.devoluciones) === 0) {
    return { prompt: PREGUNTA_SIN_NADA_CLIENTE, puedeConfirmar: true, bloqueado: false };
  }
  return { prompt: textoNoSePuedeEliminar(estado), puedeConfirmar: false, bloqueado: true };
}
