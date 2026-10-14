import type { ReactNode } from 'react';

import { InlineError } from '@/components/shared/inline-error';
import { isRetryableDataError } from '@/lib/data-errors';
import { cn } from '@/lib/utils';
import type { FilaDeBarra } from './resumen-calculos';
import { formatMonto, textoDetalleBarra } from './resumen-pantalla-textos';
import { mensajeErrorResumen, RESUMEN_ERROR_CONTEXT } from './resumen-textos';

/** Lo que un bloque usa de su consulta (un `useQuery` de `use-resumen.ts`). */
export interface ConsultaDeBloque<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * La tarjeta de un bloque (los mismos bordes y fondo del resumen de Viajes): una sección con su título h2, que es su
 * nombre accesible. `ocupada` = `aria-busy` mientras el contenido todavía no está.
 */
export function TarjetaResumen({ id, titulo, ocupada = false, children }: { id: string; titulo: string; ocupada?: boolean; children: ReactNode }) {
  const tituloId = `${id}-titulo`;
  return (
    <section id={id} aria-labelledby={tituloId} aria-busy={ocupada} className="rounded-lg border border-border bg-card p-4">
      <h2 id={tituloId} className="text-lg font-semibold">
        {titulo}
      </h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

/**
 * El error de un bloque, con "Reintentar" (vuelve a pedir SOLO lo de ese bloque) cuando reintentar puede servir: no con
 * una respuesta que no cumple el contrato por parámetros inválidos ni sin cuenta (ver `RESUMEN_ERROR_CONTEXT`).
 */
export function ErrorDeBloque({ consulta, prefijo }: { consulta: ConsultaDeBloque<unknown>; prefijo?: string }) {
  const mensaje = mensajeErrorResumen(consulta.error);
  return (
    <InlineError
      message={prefijo ? `${prefijo} ${mensaje}` : mensaje}
      onRetry={isRetryableDataError(consulta.error, RESUMEN_ERROR_CONTEXT) ? () => void consulta.refetch() : undefined}
      retrying={consulta.isFetching}
    />
  );
}

/** Filas grises mientras carga un bloque. Mudas: el aviso de carga para lectores de pantalla es uno solo, el de la pantalla. */
export function BloqueCargando({ filas = 2 }: { filas?: number }) {
  return (
    <div aria-hidden="true" data-cargando="" className="space-y-2">
      {Array.from({ length: filas }, (_, indice) => (
        <div key={indice} className="h-6 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      ))}
    </div>
  );
}

interface BloqueResumenProps<T> {
  /** id de la sección (el del título es `${id}-titulo`). */
  id: string;
  titulo: string;
  consulta: ConsultaDeBloque<T>;
  filasCargando?: number;
  /** El contenido con los datos ya cargados (el vacío lo decide cada bloque). */
  children: (datos: T) => ReactNode;
}

/**
 * Un bloque del Resumen: tarjeta con su título y SU estado. Mientras carga, filas grises (`aria-busy`); si falla, el error
 * con "Reintentar" (y, si había datos de antes, se siguen viendo debajo); con datos, `children(datos)`.
 */
export function BloqueResumen<T>({ id, titulo, consulta, filasCargando = 2, children }: BloqueResumenProps<T>) {
  return (
    <TarjetaResumen id={id} titulo={titulo} ocupada={consulta.data === undefined && !consulta.isError}>
      {consulta.isError ? <ErrorDeBloque consulta={consulta} /> : null}
      {consulta.data !== undefined ? children(consulta.data) : consulta.isError ? null : <BloqueCargando filas={filasCargando} />}
    </TarjetaResumen>
  );
}

/**
 * Las barras de un desglose. Cada fila dice TODO en texto (nombre, monto, cantidad y % del total); la barra es solo
 * visual (`aria-hidden`), con los colores del tema. El ancho es el % exacto del total; un monto muy chico igual se ve.
 */
export function ListaDeBarras({ filas }: { filas: readonly FilaDeBarra[] }) {
  return (
    <ul className="space-y-3">
      {filas.map((fila) => (
        <li key={fila.clave} data-fila={fila.clave}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words font-medium">{fila.etiqueta}</span>
            <span className="shrink-0 font-semibold tabular-nums">{formatMonto(fila.monto)}</span>
          </div>
          <div aria-hidden="true" className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full bg-primary', fila.monto > 0 && 'min-w-1')} style={{ width: `${fila.ancho}%` }} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{textoDetalleBarra(fila)}</p>
        </li>
      ))}
    </ul>
  );
}
