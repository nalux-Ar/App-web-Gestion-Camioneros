import { useState } from 'react';

import { alternarMarcaConTope, primerosParaMarcar, sinCupoParaMarcar, todoLoMarcableEstaMarcado } from './seleccion-con-tope';
import { marcadosVigentes, recortarSeleccion } from './sumar-gastos-seleccion';

/**
 * Qué gastos están marcados en una lista que se puede refrescar sola, con un TOPE de cuántos se pueden marcar a la vez. Es
 * `useSeleccionDeGastos` (que no se toca) más el tope: «Quitar gastos del viaje» ve hasta 500 gastos pero solo puede mandar 100 por
 * pedido. Las reglas de aquel hook valen igual acá, a propósito:
 *  - La selección se RECORTA cada vez que cambia la lista, mirando CUÁLES gastos hay (los ids), no cuántos: si sale uno y entra otro
 *    la lista sigue teniendo la misma cantidad y aun así lo que salió deja de estar marcado y, si VUELVE, vuelve SIN marcar. Nadie
 *    termina quitando un gasto que no marcó.
 *  - Lo que se manda (`idsParaEnviar`) es siempre la selección ∩ la lista de este render, en el orden de la lista, nunca un
 *    conjunto guardado de antes.
 * Y las del tope:
 *  - Nunca hay más de `tope` marcados. El tope se aplica DENTRO de la actualización del estado (con función), no contra lo que se
 *    ve en el dibujo: dos toques seguidos, antes de que la pantalla se vuelva a dibujar, no pueden pasarlo.
 *  - Con `tope` marcados, las casillas SIN marcar no se pueden marcar (`sinCupo`) pero las marcadas sí se pueden desmarcar.
 *  - `marcarTodos` marca los primeros `tope` de la lista (con una lista más corta, todos).
 *
 * El recorte se hace durante el render (el patrón de React para ajustar un estado cuando cambia un dato; ver «You Might Not Need
 * an Effect»), no en un efecto: con un efecto habría un render intermedio con ids que ya no están.
 */
export function useSeleccionConTope(vigentes: readonly string[], tope: number) {
  const huella = vigentes.join(',');
  const [guardados, setGuardados] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [huellaVista, setHuellaVista] = useState(huella);

  let marcados = guardados;
  if (huella !== huellaVista) {
    marcados = recortarSeleccion(guardados, vigentes);
    setHuellaVista(huella);
    setGuardados(marcados);
  }

  const idsParaEnviar = marcadosVigentes(vigentes, marcados);
  const cantidad = idsParaEnviar.length;

  return {
    /** Lo marcado, ya recortado a la lista de ahora (para dibujar las casillas). */
    marcados,
    /** Lo que se manda al quitar: selección ∩ lista de ahora, en el orden de la lista. Nunca más de `tope`. */
    idsParaEnviar,
    /** ¿Está marcado todo lo que se puede marcar (la lista entera, o `tope` si es más larga)? Con la lista vacía, no. */
    todosMarcados: todoLoMarcableEstaMarcado(cantidad, vigentes.length, tope),
    /** Se llegó al tope y quedan gastos sin marcar: esas casillas se apagan. */
    sinCupo: sinCupoParaMarcar(cantidad, vigentes.length, tope),
    // Un id que no está en la lista de ahora no se puede marcar (no debería pasar: las casillas salen de la lista): así lo marcado
    // es SIEMPRE un subconjunto de la lista. Sin lugar (ya hay `tope`), marcar uno nuevo no hace nada.
    alternar: (id: string) => {
      if (vigentes.includes(id)) setGuardados((previos) => alternarMarcaConTope(previos, id, tope));
    },
    marcarTodos: () => setGuardados(primerosParaMarcar(vigentes, tope)),
    desmarcarTodos: () => setGuardados(new Set<string>()),
    /** Vacía la selección: después de cada «Quitar» que terminó. */
    vaciar: () => setGuardados(new Set<string>()),
  };
}
