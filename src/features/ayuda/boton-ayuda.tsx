import { Suspense, useEffect, useRef, useState } from 'react';
import { Compass, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HojaAyudaDiferida } from './ayuda-lazy';
import { TEXTO_VER_RECORRIDO, type AyudaPantalla } from './ayuda-pantallas';
import { pedirRecorrido } from './pedido-recorrido';

interface BotonAyudaProps {
  ayuda: AyudaPantalla;
  /** Para que el recorrido pueda señalar este botón (`data-ayuda`). */
  dataAyuda?: string;
  /** Agrega al final de la ayuda "Ver el recorrido otra vez" (solo Inicio). */
  conRecorrido?: boolean;
  className?: string;
}

/**
 * La "i" permanente de cada pantalla: abre la ayuda de ESA pantalla. La hoja va diferida (el chunk se baja recién al
 * tocar) y, al cerrarla, el foco vuelve a este botón. Táctil de 48 px (el piso del proyecto).
 */
export function BotonAyuda({ ayuda, dataAyuda, conRecorrido = false, className }: BotonAyudaProps) {
  const [abierta, setAbierta] = useState(false);
  const recorridoPendiente = useRef(false);

  // El recorrido se pide recién con la hoja ya desmontada: así su `inert`, su velo y el foco no chocan con los del recorrido.
  useEffect(() => {
    if (abierta || !recorridoPendiente.current) return;
    recorridoPendiente.current = false;
    pedirRecorrido();
  }, [abierta]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Ayuda de esta pantalla"
        aria-haspopup="dialog"
        data-ayuda={dataAyuda}
        onClick={(evento) => {
          // Safari no enfoca el botón al tocarlo: sin esto, al cerrar el foco no tendría a dónde volver.
          evento.currentTarget.focus({ preventScroll: true });
          setAbierta(true);
        }}
        className={cn('shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-6', className)}
      >
        <Info aria-hidden="true" />
      </Button>
      {abierta ? (
        <Suspense fallback={null}>
          <HojaAyudaDiferida
            titulo={ayuda.titulo}
            puntos={ayuda.puntos}
            onCerrar={() => setAbierta(false)}
            accion={
              conRecorrido ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    recorridoPendiente.current = true;
                    setAbierta(false);
                  }}
                >
                  <Compass aria-hidden="true" /> {TEXTO_VER_RECORRIDO}
                </Button>
              ) : undefined
            }
          />
        </Suspense>
      ) : null}
    </>
  );
}
