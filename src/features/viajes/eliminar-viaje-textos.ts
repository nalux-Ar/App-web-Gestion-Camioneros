/**
 * Textos de la confirmación de borrar un viaje. Lógica pura.
 *
 * Borrar un viaje tiene dos consecuencias que la confirmación tiene que decir con números:
 *  - Sus GASTOS se conservan: `eliminarViajeDesvinculandoGastos` los desvincula antes de borrar el viaje.
 *  - Sus DEVOLUCIONES se borran junto con el viaje (la base las borra en cascada; no hay un paso extra).
 * La consulta de conteo (los dos números, siempre frescos) se hace al abrir el paso de confirmar y el botón
 * nombra lo que va a pasar. Si el conteo falla, un texto genérico y se puede borrar igual.
 */

/** Cuántos gastos y cuántas devoluciones tiene el viaje. */
export interface ConteosDelViaje {
  gastos: number;
  devoluciones: number;
}

export type EstadoConteos =
  /** Todavía no se sabe cuántos tiene: el botón de confirmar espera (con el texto cambiando bajo el dedo sería confuso). */
  | { tipo: 'cargando' }
  | ({ tipo: 'listo' } & ConteosDelViaje)
  /** No se pudo contar (alguno de los dos conteos): se puede borrar igual, con un aviso genérico. */
  | { tipo: 'error' };

export interface TextosDeBorrado {
  prompt: string;
  confirmLabel: string;
  /** false mientras se averigua el conteo. */
  puedeConfirmar: boolean;
}

export const ETIQUETA_BORRAR = 'Sí, eliminar';
export const PREGUNTA_SIN_NADA = '¿Seguro? Esto no se puede deshacer.';
export const PREGUNTA_REVISANDO = 'Revisando si el viaje tiene gastos o devoluciones…';
export const PREGUNTA_GENERICA =
  '¿Seguro? Si tiene gastos vinculados, se conservan pero quedan sin viaje; si tiene devoluciones, se borran con el viaje. Esto no se puede deshacer.';

/** Un conteo no negativo y entero: lo que no lo sea cuenta como 0 (no se inventa un texto con cantidades raras). */
function cantidadValida(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0;
}

function gastosEn(cantidad: number): string {
  return cantidad === 1 ? '1 gasto' : `${cantidad} gastos`;
}

function devolucionesEn(cantidad: number): string {
  return cantidad === 1 ? '1 devolución' : `${cantidad} devoluciones`;
}

/**
 * Justo antes de desvincular se vuelve a contar: si alguno de los dos números ya no es el que se mostró (alguien
 * vinculó o desvinculó un gasto, o cargó o borró una devolución, mientras la confirmación estaba abierta), no se
 * toca nada y se avisa con este texto, con los números de ahora.
 */
export function textoConteoCambiado({ gastos, devoluciones }: ConteosDelViaje): string {
  const g = cantidadValida(gastos);
  const d = cantidadValida(devoluciones);
  const revisa = 'Revisa y vuelve a confirmar.';
  if (g === 0 && d === 0) return `Ahora el viaje no tiene gastos ni devoluciones vinculados. ${revisa}`;
  if (d === 0) return `Ahora el viaje tiene ${gastosEn(g)}. ${revisa}`;
  if (g === 0) return `Ahora el viaje tiene ${devolucionesEn(d)}. ${revisa}`;
  return `Ahora el viaje tiene ${gastosEn(g)} y ${devolucionesEn(d)}. ${revisa}`;
}

/**
 * El paso 1 (desvincular) se aplicó pero el paso 2 (borrar el viaje) falló: el viaje sigue y sus gastos ya no
 * están vinculados. Se dice explícitamente, seguido del motivo del fallo (`detalle`, ya en español). Las
 * devoluciones siguen intactas: se borran junto con el viaje, y el viaje no se borró.
 */
export function textoBorradoIncompleto(desvinculados: number, detalle: string): string {
  const hecho =
    desvinculados === 1
      ? 'El gasto ya quedó sin viaje, pero el viaje no se borró.'
      : `Los ${desvinculados} gastos ya quedaron sin viaje, pero el viaje no se borró.`;
  return `${hecho} ${detalle}`;
}

export function textosDeBorrado(estado: EstadoConteos): TextosDeBorrado {
  if (estado.tipo === 'cargando') {
    return { prompt: PREGUNTA_REVISANDO, confirmLabel: ETIQUETA_BORRAR, puedeConfirmar: false };
  }
  if (estado.tipo === 'error') {
    return { prompt: PREGUNTA_GENERICA, confirmLabel: ETIQUETA_BORRAR, puedeConfirmar: true };
  }

  const g = cantidadValida(estado.gastos);
  const d = cantidadValida(estado.devoluciones);

  if (g === 0 && d === 0) {
    return { prompt: PREGUNTA_SIN_NADA, confirmLabel: ETIQUETA_BORRAR, puedeConfirmar: true };
  }

  // Solo gastos: se conservan (quedan sin viaje).
  if (d === 0) {
    return g === 1
      ? {
          prompt: '¿Seguro? Este viaje tiene 1 gasto. Se conserva, pero queda sin viaje. Esto no se puede deshacer.',
          confirmLabel: 'Desvincular el gasto y borrar el viaje',
          puedeConfirmar: true,
        }
      : {
          prompt: `¿Seguro? Este viaje tiene ${g} gastos. Se conservan, pero quedan sin viaje. Esto no se puede deshacer.`,
          confirmLabel: 'Desvincular los gastos y borrar el viaje',
          puedeConfirmar: true,
        };
  }

  const confirmLabel = d === 1 ? 'Borrar el viaje y su devolución' : 'Borrar el viaje y sus devoluciones';

  // Solo devoluciones: se borran junto con el viaje.
  if (g === 0) {
    return {
      prompt:
        d === 1
          ? '¿Seguro? Este viaje tiene 1 devolución. Se borra junto con el viaje. Esto no se puede deshacer.'
          : `¿Seguro? Este viaje tiene ${d} devoluciones. Se borran junto con el viaje. Esto no se puede deshacer.`,
      confirmLabel,
      puedeConfirmar: true,
    };
  }

  // Las dos cosas: los gastos se conservan, las devoluciones se borran.
  const queGastos = g === 1 ? 'El gasto se conserva, pero queda sin viaje' : 'Los gastos se conservan, pero quedan sin viaje';
  const queDevoluciones = d === 1 ? 'la devolución se borra con el viaje' : 'las devoluciones se borran con el viaje';
  return {
    prompt: `¿Seguro? Este viaje tiene ${gastosEn(g)} y ${devolucionesEn(d)}. ${queGastos}; ${queDevoluciones}. Esto no se puede deshacer.`,
    confirmLabel,
    puedeConfirmar: true,
  };
}
