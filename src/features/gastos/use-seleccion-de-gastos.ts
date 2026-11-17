import { useState } from 'react';

import { alternarMarca, marcadosVigentes, recortarSeleccion, todosMarcados } from './sumar-gastos-seleccion';

/**
 * Qué gastos están marcados en una lista que se puede refrescar sola. Sirve a «Sumar gastos que ya cargué» y servirá a «Quitar».
 *
 * `vigentes` son los ids de la lista de AHORA, en su orden. Dos reglas, las dos a propósito:
 *  - La selección se RECORTA cada vez que cambia la lista (se refrescó al volver la señal, o después de sumar): lo que ya no está
 *    deja de estar marcado y, si más tarde VUELVE a aparecer (otro dispositivo lo quitó del viaje), vuelve SIN marcar. Nadie
 *    termina sumando un gasto que no marcó.
 *  - Lo que se manda (`idsParaEnviar`) es siempre la selección ∩ la lista de este render, en el orden de la lista, nunca un
 *    conjunto guardado de antes.
 *
 * El recorte se hace durante el render (el patrón de React para ajustar un estado cuando cambia un dato; ver «You Might Not Need
 * an Effect»), no en un efecto: con un efecto habría un render intermedio con ids que ya no están.
 */
export function useSeleccionDeGastos(vigentes: readonly string[]) {
  const huella = vigentes.join(',');
  const [guardados, setGuardados] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [huellaVista, setHuellaVista] = useState(huella);

  let marcados = guardados;
  if (huella !== huellaVista) {
    marcados = recortarSeleccion(guardados, vigentes);
    setHuellaVista(huella);
    setGuardados(marcados);
  }

  return {
    /** Lo marcado, ya recortado a la lista de ahora (para dibujar las casillas). */
    marcados,
    /** Lo que se manda al sumar: selección ∩ lista de ahora, en el orden de la lista. */
    idsParaEnviar: marcadosVigentes(vigentes, marcados),
    /** ¿Está todo marcado? (con la lista vacía, no). */
    todosMarcados: todosMarcados(vigentes, marcados),
    // Un id que no está en la lista de ahora no se puede marcar (no debería pasar: las casillas salen de la lista): así lo marcado
    // es SIEMPRE un subconjunto de la lista.
    alternar: (id: string) => {
      if (vigentes.includes(id)) setGuardados((previos) => alternarMarca(previos, id));
    },
    marcarTodos: () => setGuardados(new Set(vigentes)),
    desmarcarTodos: () => setGuardados(new Set<string>()),
    /** Vacía la selección: después de cada «Sumar» que salió bien. */
    vaciar: () => setGuardados(new Set<string>()),
  };
}
