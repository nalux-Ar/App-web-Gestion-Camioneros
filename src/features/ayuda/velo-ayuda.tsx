import { createPortal } from 'react-dom';

import type { Rect } from './posicion';

/** Cuánto se agranda el aro alrededor del objetivo. */
const HOLGURA = 4;

/**
 * El velo que oscurece la app mientras hay un diálogo de ayuda (en un portal, fuera de la app inerte). Con objetivo, el
 * oscurecido sale de la sombra del ARO (un recorte alrededor de lo señalado, con borde del color de acento); sin objetivo,
 * el velo entero oscurece. Usa `--brand-plate`, que es oscuro en el tema claro y en el oscuro. Es decorativo
 * (`aria-hidden`) y se traga los toques: durante el recorrido no se puede tocar la app.
 */
export function VeloAyuda({ rect, onToque }: { rect: Rect | null; onToque?: () => void }) {
  return createPortal(
    <>
      <div
        aria-hidden="true"
        data-velo=""
        onClick={onToque}
        className={rect === null ? 'fixed inset-0 z-[60] touch-none bg-brand-plate/60' : 'fixed inset-0 z-[60] touch-none'}
      />
      {rect !== null ? (
        <div
          aria-hidden="true"
          data-aro=""
          style={{ top: rect.top - HOLGURA, left: rect.left - HOLGURA, width: rect.width + HOLGURA * 2, height: rect.height + HOLGURA * 2 }}
          className="pointer-events-none fixed z-[61] rounded-md ring-2 ring-primary shadow-[0_0_0_9999px_hsl(var(--brand-plate)/0.6)] motion-safe:transition-all motion-safe:duration-200"
        />
      ) : null}
    </>,
    document.body,
  );
}
