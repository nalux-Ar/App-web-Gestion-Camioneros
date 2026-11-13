import { Suspense, useEffect, useRef, useState } from 'react';
import { CircleQuestionMark, Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HojaAyudaDiferida } from './ayuda-lazy';
import { TEXTO_VER_RECORRIDO, type AyudaPantalla } from './ayuda-pantallas';
import { ETIQUETA_BOTON_AYUDA, TEXTO_BOTON_AYUDA } from './ayuda-textos';
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
 * El botón «Ayuda» de cada pantalla (ícono «?» + la palabra, con borde): abre la ayuda de ESA pantalla. Lleva el texto a la
 * vista porque un ícono suelto, gris y sin texto no se reconoce como botón. La hoja va diferida (el chunk se baja recién al
 * tocar) y, al cerrarla, el foco vuelve a este botón. Táctil de 48 px (el piso del proyecto). Su nombre accesible EMPIEZA con
 * el texto visible («Ayuda de esta pantalla»). `shrink-0` y `whitespace-nowrap` (el de `Button`): a 360 px el que se achica y
 * se parte en líneas es el título de al lado, nunca este botón.
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
        variant="outline"
        aria-label={ETIQUETA_BOTON_AYUDA}
        aria-haspopup="dialog"
        data-ayuda={dataAyuda}
        onClick={(evento) => {
          // Safari no enfoca el botón al tocarlo: sin esto, al cerrar el foco no tendría a dónde volver.
          evento.currentTarget.focus({ preventScroll: true });
          setAbierta(true);
        }}
        className={cn('shrink-0 [&_svg]:size-5', className)}
      >
        <CircleQuestionMark aria-hidden="true" />
        {TEXTO_BOTON_AYUDA}
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
