import { formatDateShort } from '@/lib/dates';

/**
 * Opciones del selector "Viaje" del formulario de gastos. Lógica pura.
 *
 * El selector ofrece los viajes más recientes (`RECIENTES_LIMIT`) y, además, los que TIENEN que estar aunque no
 * entren en ese tope: el viaje ya vinculado al gasto que se edita (si no, abrir el gasto y guardarlo lo
 * desvincularía sin querer), el que llegó preseleccionado por `?viaje=` y el que la persona acaba de elegir (si
 * una actualización de la lista lo saca, la opción no desaparece de debajo del valor elegido).
 */

/** Lo que el selector necesita de un viaje. */
export interface ViajeOpcion {
  id: string;
  /** 'YYYY-MM-DD' */
  fecha: string;
  origen: string;
  destino: string;
}

/**
 * "2 oct · Pilar → Villa María". Del año actual se omite; de otro año va ("2 oct 2025 · ..."), para no confundir
 * dos viajes del mismo día y mes. `today` es hoy en hora local, 'YYYY-MM-DD'.
 */
export function etiquetaDeViaje(viaje: Pick<ViajeOpcion, 'fecha' | 'origen' | 'destino'>, today: string): string {
  const anio = viaje.fecha.slice(0, 4);
  const fecha = anio === today.slice(0, 4) ? formatDateShort(viaje.fecha) : `${formatDateShort(viaje.fecha)} ${anio}`;
  return `${fecha} · ${viaje.origen} → ${viaje.destino}`;
}

interface OpcionesDeViajeArgs {
  /** Los viajes recientes que trajo la consulta, en su orden (fecha desc, created_at desc). */
  recientes: readonly ViajeOpcion[];
  /** Los que tienen que estar sí o sí (vinculado, preseleccionado, elegido). `null`/`undefined` se ignoran. */
  fijos: ReadonlyArray<ViajeOpcion | null | undefined>;
}

/**
 * Los viajes que se pueden elegir, SIN repetidos (por id). Los "fijos" que no están entre los recientes van
 * primero (son los que están en juego); los recientes siguen en su orden. Un fijo que sí está entre los recientes
 * queda en su lugar.
 */
export function opcionesDeViaje({ recientes, fijos }: OpcionesDeViajeArgs): ViajeOpcion[] {
  const idsRecientes = new Set(recientes.map((viaje) => viaje.id));
  const vistos = new Set<string>();
  const adelante: ViajeOpcion[] = [];
  for (const fijo of fijos) {
    if (!fijo || idsRecientes.has(fijo.id) || vistos.has(fijo.id)) continue;
    vistos.add(fijo.id);
    adelante.push(fijo);
  }
  const resultado = [...adelante];
  for (const viaje of recientes) {
    if (vistos.has(viaje.id)) continue;
    vistos.add(viaje.id);
    resultado.push(viaje);
  }
  return resultado;
}
