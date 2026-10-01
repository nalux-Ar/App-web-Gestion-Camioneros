import { WifiOff } from 'lucide-react';

import { useOnlineStatus } from '@/lib/use-online-status';

interface ListSkeletonProps {
  rows?: number;
  label?: string;
}

/**
 * Estado de carga de una lista: filas grises que laten (quietas si el
 * sistema pide menos movimiento). Si no hay conexión avisa "Sin conexión":
 * con `networkMode: 'online'` una consulta sin red queda en pausa, sin error
 * y sin terminar, y un skeleton mudo parecería colgado.
 *
 * Son dos regiones separadas a propósito: las filas (`aria-busy`) y el aviso
 * de conexión, que es una región `aria-live="polite"` SIN `aria-busy`
 * (algunos lectores de pantalla no anuncian el contenido de una región
 * ocupada, y justo ese aviso es el que hay que oír).
 */
export function ListSkeleton({ rows = 4, label = 'Cargando…' }: ListSkeletonProps) {
  const online = useOnlineStatus();

  return (
    <div className="space-y-3">
      <div aria-busy="true">
        <p role="status" className="sr-only">
          {label}
        </p>
        <ul aria-hidden="true" className="space-y-3">
          {Array.from({ length: rows }, (_, index) => (
            <li key={index} className="h-16 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          ))}
        </ul>
      </div>
      <div aria-live="polite">
        {online ? null : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            Sin conexión. Cargaremos tus datos cuando vuelva la señal.
          </p>
        )}
      </div>
    </div>
  );
}
