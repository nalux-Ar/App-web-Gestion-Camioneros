import { Link } from 'react-router';
import { ChevronRight, Truck } from 'lucide-react';

import { formatDateShort } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { estadoEditarDesdeLista, rutaDelViaje, rutaEditarDevolucion } from '@/features/viajes/viaje-navegacion';
import { MOTIVO_LABELS } from './constants';
import type { DevolucionDelMes } from './devoluciones-api';

interface DevolucionDelMesItemProps {
  devolucion: DevolucionDelMes;
  /** `search` de la lista actual ('?vista=devoluciones&mes=...'), ya normalizado: viaja a las dos pantallas para volver a ella. */
  volver: string;
}

// Los dos enlaces son hermanos y comparten el recuadro de la fila. El foco se dibuja HACIA ADENTRO (`ring-inset`): sin
// `overflow-hidden` en el recuadro, pero con los bordes redondeados repartidos entre los dos enlaces.
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

/**
 * Una fila de la pestaña Devoluciones de `/viajes`. Dos enlaces HERMANOS (nunca uno dentro de otro: un `<a>` no puede
 * anidarse), cada uno con su área táctil:
 *  - lo principal (cliente en negrita, motivo y la descripción cortada a 2 líneas) lleva a EDITAR la devolución, con la
 *    marca de origen en el `state` para que guardar o borrar vuelva a esta lista;
 *  - la franja de abajo ("origen → destino" y la fecha corta, como en `ViajeItem`) lleva al DETALLE del viaje.
 * Todo lo que escribió el usuario se muestra como texto (nunca como HTML). Las rutas se arman en el código con los ids
 * que devolvió la base.
 */
export function DevolucionDelMesItem({ devolucion, volver }: DevolucionDelMesItemProps) {
  const { viajes: viaje } = devolucion;

  return (
    <li className="rounded-lg border border-border bg-card">
      <Link
        to={rutaEditarDevolucion(devolucion.viaje_id, devolucion.id)}
        state={estadoEditarDesdeLista(volver)}
        className={cn('flex min-h-16 items-center gap-3 rounded-t-lg px-4 py-3 transition-colors hover:bg-accent', FOCO)}
      >
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{devolucion.clientes?.nombre ?? 'Cliente'}</p>
          <p className="text-sm text-muted-foreground">{MOTIVO_LABELS[devolucion.motivo]}</p>
          {devolucion.descripcion ? (
            <p className="line-clamp-2 break-words text-sm text-muted-foreground">{devolucion.descripcion}</p>
          ) : null}
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        to={rutaDelViaje(devolucion.viaje_id)}
        state={{ volver }}
        className={cn(
          'flex min-h-12 items-center gap-2 rounded-b-lg border-t border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          FOCO,
        )}
      >
        <Truck className="size-4 shrink-0" aria-hidden="true" />
        <span className="line-clamp-2 min-w-0 flex-1 break-words">
          {viaje.origen} <span aria-hidden="true">→</span>
          <span className="sr-only"> a </span> {viaje.destino}
        </span>
        <span className="shrink-0 tabular-nums">{formatDateShort(viaje.fecha)}</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
      </Link>
    </li>
  );
}
