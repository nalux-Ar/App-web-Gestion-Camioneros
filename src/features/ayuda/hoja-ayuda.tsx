import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { BOTON_CERRAR } from './ayuda-textos';
import { DialogoAyuda } from './dialogo-ayuda';
import { calcularPosicion } from './posicion';
import { leerViewport } from './use-dialogo-ayuda';
import { VeloAyuda } from './velo-ayuda';

interface HojaAyudaProps {
  titulo: string;
  /** Los puntos de la ayuda: textos planos. */
  puntos: readonly string[];
  onCerrar: () => void;
}

/**
 * La ayuda de una pantalla (la que abre la "i"): el mismo diálogo que el recorrido, sin objetivo. En el celular, hoja
 * abajo; en escritorio, centrada. "Cerrar", Esc o tocar el velo la cierran, y el foco vuelve a la "i".
 */
export function HojaAyuda({ titulo, puntos, onCerrar }: HojaAyudaProps) {
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
        esquina={
          <Button type="button" variant="ghost" onClick={onCerrar}>
            {BOTON_CERRAR}
          </Button>
        }
      >
        <ul className="list-disc space-y-2 pl-5">
          {puntos.map((punto) => (
            <li key={punto}>{punto}</li>
          ))}
        </ul>
      </DialogoAyuda>
    </>
  );
}
