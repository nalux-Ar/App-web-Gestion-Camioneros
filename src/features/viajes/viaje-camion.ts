/**
 * Cambiar el camión de un viaje que ya tiene gastos. Lógica PURA (textos del botón y del aviso).
 *
 * Si un viaje pasa a otro camión, la base mueve a ese camión los gastos del viaje que tenían camión (trigger
 * `fn_propagar_camion_viaje`, migración 010): no queda registro del camión anterior. Por eso, antes de guardar, se cuentan
 * (fresco) los gastos que se van a mover y el botón principal lo dice: "Guardar y pasar 3 gastos al camión AB 123 CD". Sin
 * paso extra: el botón ya nombra la consecuencia.
 */

export type EstadoGastosAMover =
  /** El camión no cambió (o el viaje es nuevo, o queda sin camión): no se mueve nada. */
  | { tipo: 'sin-cambio' }
  /** Contando: el botón espera (no se guarda sin haber dicho cuántos gastos se mueven). */
  | { tipo: 'cargando' }
  /** No se pudo contar: se puede guardar igual, con un aviso sin números. */
  | { tipo: 'error' }
  | { tipo: 'listo'; cantidad: number };

export interface TextosCambioDeCamion {
  /** Texto del botón principal. */
  label: string;
  /** Aviso visible arriba del botón (null si no hay nada que decir). */
  aviso: string | null;
  /** false mientras se cuenta. */
  puedeGuardar: boolean;
}

function gastosEn(cantidad: number): string {
  return cantidad === 1 ? '1 gasto' : `${cantidad} gastos`;
}

/** `camion` es cómo se nombra el camión nuevo ("AB 123 CD"). */
export function textosCambioDeCamion(estado: EstadoGastosAMover, camion: string): TextosCambioDeCamion {
  if (estado.tipo === 'cargando') return { label: 'Revisando los gastos del viaje…', aviso: null, puedeGuardar: false };
  if (estado.tipo === 'error') {
    return {
      label: 'Guardar viaje',
      aviso: `No pudimos revisar los gastos del viaje: si tiene gastos con otro camión, al guardar pasan al camión ${camion}.`,
      puedeGuardar: true,
    };
  }
  const cantidad = estado.tipo === 'listo' && Number.isInteger(estado.cantidad) && estado.cantidad > 0 ? estado.cantidad : 0;
  if (cantidad === 0) return { label: 'Guardar viaje', aviso: null, puedeGuardar: true };
  return {
    label: `Guardar y pasar ${gastosEn(cantidad)} al camión ${camion}`,
    aviso: `Este viaje tiene ${gastosEn(cantidad)} con otro camión: al guardar ${cantidad === 1 ? 'pasa' : 'pasan'} al camión ${camion}. No queda registro del camión anterior.`,
    puedeGuardar: true,
  };
}
