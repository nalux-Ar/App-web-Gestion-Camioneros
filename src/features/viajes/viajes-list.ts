import { fromDbNumber, fromScaledInt, toScaledInt } from '@/lib/numbers';

/** Lógica pura de la lista de viajes: forma de la fila, km de cada viaje y totales del mes. */

/** Una fila tal cual la devuelve la consulta de la lista (con el embed `entregas(count)`). */
export interface FilaViajeDeLista {
  id: string;
  fecha: string;
  origen: string;
  destino: string;
  /** El camión del viaje (la patente se muestra desde la lista de camiones, sin embed). */
  camion_id?: string | null;
  km_inicial: number | string | null;
  km_final: number | string | null;
  km_recorridos: number | string | null;
  ingreso: number | string | null;
  created_at: string;
  /** PostgREST: `[{ count: n }]` (una sola fila de conteo, con 0 si no hay entregas). */
  entregas: ReadonlyArray<{ count: number | string }>;
}

/** El viaje como lo usa la pantalla: números ya leídos y la cantidad de entregas ya contada. */
export interface ViajeDeLista {
  id: string;
  fecha: string;
  origen: string;
  destino: string;
  camion_id: string | null;
  km_inicial: number | null;
  km_final: number | null;
  km_recorridos: number | null;
  ingreso: number | null;
  created_at: string;
  cantidad_entregas: number;
}

/** El conteo del embed `entregas(count)`. Cualquier forma inesperada cuenta como 0 en vez de romper la lista. */
export function contarEntregas(embed: FilaViajeDeLista['entregas'] | null | undefined): number {
  const crudo = embed?.[0]?.count;
  const cantidad = typeof crudo === 'string' ? Number(crudo) : crudo;
  return typeof cantidad === 'number' && Number.isInteger(cantidad) && cantidad > 0 ? cantidad : 0;
}

export function aViajeDeLista(fila: FilaViajeDeLista): ViajeDeLista {
  return {
    id: fila.id,
    fecha: fila.fecha,
    origen: fila.origen,
    destino: fila.destino,
    camion_id: fila.camion_id ?? null,
    km_inicial: fromDbNumber(fila.km_inicial),
    km_final: fromDbNumber(fila.km_final),
    km_recorridos: fromDbNumber(fila.km_recorridos),
    ingreso: fromDbNumber(fila.ingreso),
    created_at: fila.created_at,
    cantidad_entregas: contarEntregas(fila.entregas),
  };
}

type KmColumnas = Pick<ViajeDeLista, 'km_inicial' | 'km_final' | 'km_recorridos'>;

/**
 * Km del viaje en DÉCIMAS de km (entero), o null si no se pueden calcular:
 *  - con `km_recorridos`: ese valor;
 *  - con inicial y final: la resta;
 *  - si no (solo el inicial, o nada): null.
 */
export function kmEnDecimas(viaje: KmColumnas): number | null {
  if (viaje.km_recorridos !== null) return toScaledInt(viaje.km_recorridos, 'km');
  if (viaje.km_inicial !== null && viaje.km_final !== null) {
    return toScaledInt(viaje.km_final, 'km') - toScaledInt(viaje.km_inicial, 'km');
  }
  return null;
}

/** Qué mostrar de los km en la fila: el valor, "Km final sin cargar" (viaje en curso: solo el inicial) o nada. */
export type KmDelViaje = { tipo: 'km'; km: number } | { tipo: 'sin-final' } | { tipo: 'sin-km' };

export function kmDelViaje(viaje: KmColumnas): KmDelViaje {
  const decimas = kmEnDecimas(viaje);
  if (decimas !== null) return { tipo: 'km', km: fromScaledInt(decimas, 'km') };
  if (viaje.km_inicial !== null) return { tipo: 'sin-final' };
  return { tipo: 'sin-km' };
}

export interface TotalesViajes {
  viajes: number;
  /** Km totales de los viajes con km calculables; null si ninguno tiene. */
  km: number | null;
  /** Ingresos totales de los viajes que lo cargaron; null si ninguno lo cargó. */
  ingreso: number | null;
}

/**
 * Totales del mes. Las sumas se hacen en ENTEROS (décimas de km y centavos) y recién al final se vuelve
 * a decimales: 0,1 + 0,2 no da 0,30000000000000004. Un viaje sin ingreso no suma (distinto de ingreso 0:
 * ese suma 0); uno sin km calculables tampoco suma km.
 */
export function totalesDelMes(
  viajes: ReadonlyArray<KmColumnas & Pick<ViajeDeLista, 'ingreso'>>,
): TotalesViajes {
  let decimas = 0;
  let conKm = 0;
  let centavos = 0;
  let conIngreso = 0;
  for (const viaje of viajes) {
    const km = kmEnDecimas(viaje);
    if (km !== null) {
      decimas += km;
      conKm += 1;
    }
    if (viaje.ingreso !== null) {
      centavos += toScaledInt(viaje.ingreso, 'dinero');
      conIngreso += 1;
    }
  }
  return {
    viajes: viajes.length,
    km: conKm > 0 ? fromScaledInt(decimas, 'km') : null,
    ingreso: conIngreso > 0 ? fromScaledInt(centavos, 'dinero') : null,
  };
}
