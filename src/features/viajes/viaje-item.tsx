import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

import { formatDateShort } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { kmDelViaje, type ViajeDeLista } from './viajes-list';

interface ViajeItemProps {
  viaje: ViajeDeLista;
  /** `search` de la lista actual: viaja al detalle para volver con el mismo mes. */
  volver: string;
  /** El camión del viaje ("AB 123 CD"), solo si la cuenta tiene 2 o más camiones. */
  camion?: string;
}

function textoEntregas(cantidad: number): string {
  if (cantidad === 0) return 'Sin entregas';
  return cantidad === 1 ? '1 entrega' : `${cantidad} entregas`;
}

/**
 * Una fila de la lista: toda es un enlace al DETALLE del viaje (área táctil ≥ 64 px; desde ahí se edita). Lo principal es el recorrido
 * ("origen → destino", hasta dos líneas: los nombres de lugares pueden ser largos); debajo, la fecha y la
 * cantidad de entregas; después los km (el valor, "Km final sin cargar" si el viaje sigue en curso, o nada
 * si no se cargaron); y a la derecha el ingreso, si lo hay. Los números van sin símbolo de moneda.
 */
export function ViajeItem({ viaje, volver, camion }: ViajeItemProps) {
  const km = kmDelViaje(viaje);
  const detalle = [formatDateShort(viaje.fecha), textoEntregas(viaje.cantidad_entregas), camion].filter(Boolean).join(' · ');

  return (
    <li>
      <Link
        to={`/viajes/${viaje.id}`}
        state={{ volver }}
        className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words font-medium">
            {viaje.origen} <span aria-hidden="true">→</span>
            <span className="sr-only"> a </span> {viaje.destino}
          </p>
          <p className="text-sm text-muted-foreground">{detalle}</p>
          {km.tipo === 'km' ? (
            <p className="text-sm text-muted-foreground">{formatNumber(km.km, { decimales: 1, fijos: false })} km</p>
          ) : km.tipo === 'sin-final' ? (
            <p className="text-sm text-muted-foreground">Km final sin cargar</p>
          ) : null}
        </div>
        {viaje.ingreso !== null ? (
          <p className="shrink-0 text-right text-base font-semibold tabular-nums">
            {formatNumber(viaje.ingreso, { decimales: 2 })}
          </p>
        ) : null}
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}
