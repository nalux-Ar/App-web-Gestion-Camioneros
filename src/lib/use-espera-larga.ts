import { useEffect, useState } from 'react';

/** A los cuántos milisegundos seguidos de espera se avisa que la señal está lenta (el corte por tiempo de una escritura es el de `db.ts`, 20 s). */
export const ESPERA_LARGA_MS = 8000;

/**
 * ¿Lleva `ms` milisegundos SEGUIDOS esperando? Devuelve `true` recién cuando `activa` estuvo en `true` todo ese tiempo, y vuelve a
 * `false` apenas `activa` pasa a `false` (el intento terminó, bien o mal). Cada vez que `activa` vuelve a `true` es un intento nuevo y la
 * cuenta arranca de cero (dos intentos seguidos no suman).
 *
 * Es solo un aviso: no toca el guardado ni decide nada (el flujo, el guard contra el doble envío y el reintento son de
 * `useSubmitFeedback`). El temporizador se limpia al desmontar y cada vez que `activa` cambia.
 */
export function useEsperaLarga(activa: boolean, ms: number = ESPERA_LARGA_MS): boolean {
  const [vencida, setVencida] = useState(false);

  useEffect(() => {
    if (!activa) return;
    const temporizador = window.setTimeout(() => setVencida(true), ms);
    return () => {
      window.clearTimeout(temporizador);
      setVencida(false);
    };
  }, [activa, ms]);

  return activa && vencida;
}
