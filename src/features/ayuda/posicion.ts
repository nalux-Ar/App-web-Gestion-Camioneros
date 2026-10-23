/**
 * Lógica PURA del recorrido de bienvenida y de la ayuda: dónde va la tarjeta del paso, qué elemento se señala y qué pasos
 * se pueden mostrar. Sin React ni layout real: se prueba con rectángulos falsos (jsdom no tiene layout).
 */

/** Un paso del recorrido. `objetivo` es el valor de `data-ayuda` del elemento a señalar (null: paso centrado). */
export type PasoTour = {
  id: string;
  objetivo: string | null;
  titulo: string;
  /** Texto plano: se muestra siempre como texto, nunca como HTML. */
  texto: string;
  /** Si el objetivo no aparece: se saltea el paso, o se muestra centrado sin resalte. */
  siFalta: 'saltar' | 'centrado';
};

/** Un paso listo para mostrar: `conObjetivo` false = centrado (sin objetivo, o el objetivo no apareció). */
export type PasoResuelto = PasoTour & { conObjetivo: boolean };

/** Un rectángulo en coordenadas de la ventana (lo de `getBoundingClientRect`). */
export type Rect = { top: number; left: number; width: number; height: number };

/** La parte visible de la ventana (`visualViewport`, o `innerWidth`/`innerHeight` si no hay). */
export type Viewport = { ancho: number; alto: number; offsetTop?: number; offsetLeft?: number };

/** El ancho desde el que hay barra lateral y tarjeta anclada (el `md` de Tailwind). Debajo: hoja fija. */
export const ANCHO_ESCRITORIO = 768;
/** Margen entre el objetivo y la tarjeta, y entre la tarjeta y el borde de la ventana. */
export const MARGEN = 12;

export type Posicion =
  /** Celular: hoja de ancho completo pegada arriba o abajo (el safe-area lo pone el CSS). */
  | { modo: 'hoja'; lado: 'arriba' | 'abajo' }
  /** Escritorio: tarjeta anclada al objetivo. */
  | { modo: 'tarjeta'; lado: 'abajo' | 'arriba' | 'derecha' | 'izquierda'; top: number; left: number }
  /** Escritorio sin objetivo, o sin lugar alrededor: tarjeta centrada. */
  | { modo: 'centrado' };

function acotar(valor: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(valor, min), max);
}

/**
 * Dónde va la tarjeta de un paso.
 *  - Celular (< 768 px): hoja fija ABAJO si el centro del objetivo está en la mitad superior, ARRIBA si está en la
 *    inferior (así nunca tapa lo que señala, p. ej. un ítem de la barra de abajo). Sin objetivo: abajo.
 *  - Escritorio: abajo del objetivo; si no entra, arriba (flip); si tampoco, a la derecha o a la izquierda; y siempre
 *    corrida para no salirse de la ventana (shift). Si no entra por ningún lado, o no hay objetivo: centrada.
 */
export function calcularPosicion(
  rect: Rect | null,
  tarjeta: { ancho: number; alto: number },
  viewport: Viewport,
  margen: number = MARGEN,
): Posicion {
  const offsetTop = viewport.offsetTop ?? 0;
  const offsetLeft = viewport.offsetLeft ?? 0;

  if (viewport.ancho < ANCHO_ESCRITORIO) {
    if (rect === null) return { modo: 'hoja', lado: 'abajo' };
    const centro = rect.top + rect.height / 2 - offsetTop;
    return { modo: 'hoja', lado: centro < viewport.alto / 2 ? 'abajo' : 'arriba' };
  }
  if (rect === null) return { modo: 'centrado' };

  const minTop = offsetTop + margen;
  const maxTop = offsetTop + viewport.alto - margen - tarjeta.alto;
  const minLeft = offsetLeft + margen;
  const maxLeft = offsetLeft + viewport.ancho - margen - tarjeta.ancho;
  const abajo = rect.top + rect.height + margen;
  const arriba = rect.top - margen - tarjeta.alto;
  const leftCentrado = acotar(rect.left + rect.width / 2 - tarjeta.ancho / 2, minLeft, maxLeft);

  if (abajo <= maxTop) return { modo: 'tarjeta', lado: 'abajo', top: abajo, left: leftCentrado };
  if (arriba >= minTop) return { modo: 'tarjeta', lado: 'arriba', top: arriba, left: leftCentrado };

  const topCentrado = acotar(rect.top + rect.height / 2 - tarjeta.alto / 2, minTop, maxTop);
  const derecha = rect.left + rect.width + margen;
  const izquierda = rect.left - margen - tarjeta.ancho;
  if (derecha <= maxLeft) return { modo: 'tarjeta', lado: 'derecha', top: topCentrado, left: derecha };
  if (izquierda >= minLeft) return { modo: 'tarjeta', lado: 'izquierda', top: topCentrado, left: izquierda };
  return { modo: 'centrado' };
}

/** ¿El elemento se ve? (tiene cajas de layout y tamaño: un `md:hidden` o un `display: none` no cuentan). */
export function esVisible(elemento: Element): boolean {
  if (elemento.getClientRects().length === 0) return false;
  const rect = elemento.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** El primero de los candidatos que se ve (p. ej. el ítem de la barra de abajo en el celular o el de la lateral en escritorio). */
export function elegirObjetivoVisible(candidatos: Iterable<Element>): Element | null {
  for (const candidato of candidatos) if (esVisible(candidato)) return candidato;
  return null;
}

/** Los valores de `data-ayuda` válidos: solo minúsculas, dígitos y guiones (nunca se arma un selector con otra cosa). */
const OBJETIVO_VALIDO = /^[a-z0-9-]{1,40}$/;

/** El elemento visible con ese `data-ayuda`, o null. */
export function buscarObjetivo(objetivo: string, raiz: ParentNode = document): Element | null {
  if (!OBJETIVO_VALIDO.test(objetivo)) return null;
  return elegirObjetivoVisible(raiz.querySelectorAll(`[data-ayuda="${objetivo}"]`));
}

/**
 * Los pasos que se pueden mostrar: los centrados siempre; los que tienen objetivo, si existe; si no, según `siFalta`
 * (se saltean, o se muestran centrados). El contador "Paso X de N" se arma con ESTA lista: nunca cuenta pasos salteados.
 */
export function pasosResolubles(pasos: readonly PasoTour[], existe: (objetivo: string) => boolean): PasoResuelto[] {
  const resueltos: PasoResuelto[] = [];
  for (const paso of pasos) {
    if (paso.objetivo === null) resueltos.push({ ...paso, conObjetivo: false });
    else if (existe(paso.objetivo)) resueltos.push({ ...paso, conObjetivo: true });
    else if (paso.siFalta === 'centrado') resueltos.push({ ...paso, conObjetivo: false });
  }
  return resueltos;
}

/** "Paso 2 de 8" (`indice` empieza en 0). */
export function textoContador(indice: number, total: number): string {
  return `Paso ${indice + 1} de ${total}`;
}
