import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { BOTON_ENTENDIDO } from './ayuda-textos';
import { DialogoAyuda } from './dialogo-ayuda';
import { calcularPosicion } from './posicion';
import { leerViewport } from './use-dialogo-ayuda';
import { VeloAyuda } from './velo-ayuda';

export interface HojaAyudaProps {
  titulo: string;
  /** Los puntos de la ayuda: textos planos. */
  puntos: readonly string[];
  onCerrar: () => void;
  /** Un botón al final de la ayuda (p. ej. "Ver el recorrido otra vez" en Inicio). */
  accion?: ReactNode;
}

/**
 * La ayuda de una pantalla (la que abre el botón «Ayuda»): el mismo diálogo que el recorrido, sin objetivo. En el celular,
 * hoja abajo; en escritorio, centrada. Se cierra con «Entendido» (un botón de todo el ancho, abajo, del tamaño del botón
 * principal de siempre), con Esc o tocando el velo, y el foco vuelve al botón «Ayuda».
 */
export function HojaAyuda({ titulo, puntos, onCerrar, accion }: HojaAyudaProps) {
  const [viewport, setViewport] = useState(leerViewport);
  useEffect(() => {
    const actualizar = () => setViewport(leerViewport());
    window.addEventListener('resize', actualizar);
    return () => window.removeEventListener('resize', actualizar);
  }, []);

  return (
    <>
      <VeloAyuda rect={null} onToque={onCerrar} />
      <DialogoAyuda
        titulo={titulo}
        posicion={calcularPosicion(null, { ancho: 0, alto: 0 }, viewport)}
        onEscape={onCerrar}
        acciones={
          <Button type="button" className="w-full" onClick={onCerrar}>
            {BOTON_ENTENDIDO}
          </Button>
        }
      >
        <ul className="list-disc space-y-2 pl-5">
          {puntos.map((punto) => (
            <li key={punto}>{punto}</li>
          ))}
        </ul>
        {accion ? <div className="pt-3">{accion}</div> : null}
      </DialogoAyuda>
    </>
  );
}
