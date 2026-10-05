import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

import { estadoDesdeCliente, type DesdeCliente } from '@/features/clientes/cliente-navegacion';
import { rutaEditarDevolucion } from '@/features/viajes/viaje-navegacion';
import { MOTIVO_LABELS } from './constants';
import type { DevolucionDeLista } from './devoluciones-api';

interface DevolucionItemProps {
  devolucion: DevolucionDeLista;
  /** El viaje en cuyo detalle está la fila (uuid ya validado: la ruta se arma en el código). */
  viajeId: string;
  /** `search` de la lista de viajes ('' o '?mes=...'), ya saneado: viaja a la edición para que el "volver" lo conserve. */
  volver: string;
  /** Si el detalle del viaje se abrió desde un cliente (ya validado): también viaja, para volver al detalle con él. */
  desdeCliente?: DesdeCliente | null;
}

/**
 * Una fila de la sección "Devoluciones" del detalle de un viaje: toda es un enlace a editar (área táctil ≥ 64 px).
 * Lo principal es el cliente; debajo, el motivo, y después la descripción cortada a 2 líneas (el texto completo se ve
 * al abrirla). Sin fecha: es la del viaje. Todo se muestra como texto (nunca como HTML).
 */
export function DevolucionItem({ devolucion, viajeId, volver, desdeCliente = null }: DevolucionItemProps) {
  return (
    <li>
      <Link
        to={rutaEditarDevolucion(viajeId, devolucion.id)}
        state={{ volver, ...estadoDesdeCliente(desdeCliente) }}
        className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
    </li>
  );
}
