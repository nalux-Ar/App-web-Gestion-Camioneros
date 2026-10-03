/**
 * Textos de la confirmación de borrar un viaje. Lógica pura.
 *
 * Borrar un viaje SIEMPRE desvincula antes sus gastos (`eliminarViajeDesvinculandoGastos`): los gastos se conservan,
 * solo pierden el vínculo. Por eso la confirmación dice cuántos son (la consulta de conteo se hace al abrir el
 * paso de confirmar) y el botón lo nombra. Si el conteo falla, un texto genérico y se puede borrar igual.
 */

export type EstadoConteoGastos =
  /** Todavía no se sabe cuántos gastos tiene: el botón de confirmar espera (con el texto cambiando bajo el dedo sería confuso). */
  | { tipo: 'cargando' }
  | { tipo: 'listo'; cantidad: number }
  /** No se pudo contar: se puede borrar igual, con un aviso genérico. */
  | { tipo: 'error' };

export interface TextosDeBorrado {
  prompt: string;
  confirmLabel: string;
  /** false mientras se averigua el conteo. */
  puedeConfirmar: boolean;
}

export const ETIQUETA_BORRAR = 'Sí, eliminar';
export const PREGUNTA_SIN_GASTOS = '¿Seguro? Esto no se puede deshacer.';
export const PREGUNTA_REVISANDO = 'Revisando si el viaje tiene gastos…';
export const PREGUNTA_GENERICA =
  '¿Seguro? Si tiene gastos vinculados, se conservan pero quedan sin viaje. Esto no se puede deshacer.';

/**
 * Justo antes de desvincular se vuelve a contar: si la cantidad ya no es la que se mostró (alguien vinculó o
 * desvinculó un gasto mientras la confirmación estaba abierta), no se toca nada y se avisa con este texto.
 */
export function textoConteoCambiado(cantidadAhora: number): string {
  if (cantidadAhora <= 0) return 'El viaje ya no tiene gastos vinculados. Revisa y vuelve a confirmar.';
  if (cantidadAhora === 1) return 'Ahora el viaje tiene 1 gasto vinculado. Revisa y vuelve a confirmar.';
  return `Ahora el viaje tiene ${cantidadAhora} gastos vinculados. Revisa y vuelve a confirmar.`;
}

/**
 * El paso 1 (desvincular) se aplicó pero el paso 2 (borrar el viaje) falló: el viaje sigue y sus gastos ya no
 * están vinculados. Se dice explícitamente, seguido del motivo del fallo (`detalle`, ya en español).
 */
export function textoBorradoIncompleto(desvinculados: number, detalle: string): string {
  const hecho =
    desvinculados === 1
      ? 'El gasto ya quedó sin viaje, pero el viaje no se borró.'
      : `Los ${desvinculados} gastos ya quedaron sin viaje, pero el viaje no se borró.`;
  return `${hecho} ${detalle}`;
}

export function textosDeBorrado(estado: EstadoConteoGastos): TextosDeBorrado {
  if (estado.tipo === 'cargando') {
    return { prompt: PREGUNTA_REVISANDO, confirmLabel: ETIQUETA_BORRAR, puedeConfirmar: false };
  }
  if (estado.tipo === 'error') {
    return { prompt: PREGUNTA_GENERICA, confirmLabel: ETIQUETA_BORRAR, puedeConfirmar: true };
  }
  const { cantidad } = estado;
  if (cantidad <= 0) {
    return { prompt: PREGUNTA_SIN_GASTOS, confirmLabel: ETIQUETA_BORRAR, puedeConfirmar: true };
  }
  if (cantidad === 1) {
    return {
      prompt: '¿Seguro? Este viaje tiene 1 gasto. Se conserva, pero queda sin viaje. Esto no se puede deshacer.',
      confirmLabel: 'Desvincular el gasto y borrar el viaje',
      puedeConfirmar: true,
    };
  }
  return {
    prompt: `¿Seguro? Este viaje tiene ${cantidad} gastos. Se conservan, pero quedan sin viaje. Esto no se puede deshacer.`,
    confirmLabel: 'Desvincular los gastos y borrar el viaje',
    puedeConfirmar: true,
  };
}
