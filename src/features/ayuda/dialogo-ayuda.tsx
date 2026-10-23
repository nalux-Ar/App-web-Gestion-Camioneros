import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';
import type { Posicion } from './posicion';
import { atraparTab, useAppInerte, useDevolverFoco, useEscape, useFocoAlTitulo } from './use-dialogo-ayuda';

interface DialogoAyudaProps {
  titulo: string;
  /** Línea chica arriba del título (p. ej. "Paso 2 de 8"). */
  antetitulo?: string;
  /** El cuerpo: textos planos. */
  children: ReactNode;
  /** El botón de la esquina, siempre visible ("Saltar" o "Cerrar"). */
  esquina: ReactNode;
  /** Los botones de abajo (Atrás / Siguiente). */
  acciones?: ReactNode;
  posicion: Posicion;
  onEscape: () => void;
  /** Cambia en cada paso: vuelve a llevar el foco al título. */
  claveFoco?: unknown;
  /** Para medir la tarjeta desde afuera. */
  dialogoRef?: RefObject<HTMLDivElement | null>;
}

/**
 * El diálogo de la ayuda (el del recorrido y el de la "i"): `role="dialog"` con `aria-modal`, en un portal FUERA de la app,
 * que queda `inert` mientras está abierto. Foco al título, Tab atrapado adentro, Esc cierra y el foco vuelve a donde
 * estaba. Por encima del header y la barra de abajo (z-40) y de la barra fija de acciones (z-30). Solo colores del tema.
 *
 *  - Celular: hoja de ancho completo, arriba o abajo, con el safe-area del equipo.
 *  - Escritorio: tarjeta en la posición calculada, o centrada.
 * Con `prefers-reduced-motion`, sin animación (`motion-safe:`).
 */
export function DialogoAyuda({ titulo, antetitulo, children, esquina, acciones, posicion, onEscape, claveFoco, dialogoRef }: DialogoAyudaProps) {
  const tituloId = useId();
  const textoId = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const propioRef = useRef<HTMLDivElement>(null);
  const ref = dialogoRef ?? propioRef;

  useAppInerte(true);
  useDevolverFoco();
  useEscape(onEscape);
  useFocoAlTitulo(tituloRef, claveFoco);

  const lugar =
    posicion.modo === 'hoja'
      ? cn(
          'inset-x-0 max-h-[70dvh] overflow-y-auto px-4',
          posicion.lado === 'abajo'
            ? 'bottom-0 rounded-t-xl border-t pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4'
            : 'top-0 rounded-b-xl border-b pb-4 pt-[calc(1rem+env(safe-area-inset-top))]',
        )
      : posicion.modo === 'tarjeta'
        ? 'w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border p-4'
        : 'left-1/2 top-1/2 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5';

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      aria-describedby={textoId}
      data-posicion={posicion.modo === 'centrado' ? 'centrado' : `${posicion.modo}-${posicion.lado}`}
      onKeyDown={(evento) => atraparTab(evento, ref.current)}
      style={posicion.modo === 'tarjeta' ? { top: posicion.top, left: posicion.left } : undefined}
      className={cn(
        'fixed z-[62] space-y-3 border-border bg-card text-card-foreground shadow-lg motion-safe:duration-200 motion-safe:animate-in motion-safe:fade-in',
        lugar,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5 pt-2">
          {antetitulo ? <p className="text-sm text-muted-foreground">{antetitulo}</p> : null}
          <h2 id={tituloId} ref={tituloRef} tabIndex={-1} className="break-words text-lg font-semibold focus-visible:outline-none">
            {titulo}
          </h2>
        </div>
        <div className="-mr-2 -mt-1 shrink-0">{esquina}</div>
      </div>
      <div id={textoId} className="text-base">
        {children}
      </div>
      {acciones ? <div className="flex flex-wrap justify-end gap-2 pt-1">{acciones}</div> : null}
    </div>,
    document.body,
  );
}
