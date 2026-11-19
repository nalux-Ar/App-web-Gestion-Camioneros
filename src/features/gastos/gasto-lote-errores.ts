import { DataRequestError } from '@/lib/data-errors';
import { MAX_GASTOS_POR_CARGA } from './constants';

/**
 * Errores propios de cargar VARIOS gastos de una vez (un lote: una categoría por gasto, todos en un solo pedido). Lógica pura:
 * no depende de Supabase, así la usan la validación del lote y el guardado.
 *
 * Los dos son un `DataRequestError` con el MISMO código que usaría la base para «datos inválidos» (`22023`):
 * `classifyDataError` los toma como `invalid-data`, `mapDataError` les da el mensaje de siempre para esa clase y NO se
 * reintentan (con lo mismo darían lo mismo), igual que `SeleccionDeGastosInvalidaError`. El `message` es interno y fijo (sin ningún
 * dato recibido): nunca se muestra.
 */

export type MotivoDeLoteInvalido = 'vacio' | 'repetida' | 'demasiadas' | 'client-ref-invalido' | 'client-ref-repetido';

const MENSAJES_DE_LOTE_INVALIDO: Record<MotivoDeLoteInvalido, string> = {
  vacio: 'No hay ningún gasto en la carga',
  repetida: 'Una categoría aparece más de una vez en la carga',
  demasiadas: `Hay más de ${MAX_GASTOS_POR_CARGA} gastos en la carga`,
  'client-ref-invalido': 'Algún client_ref de la carga no es un uuid',
  'client-ref-repetido': 'Dos gastos de la carga tienen el mismo client_ref',
};

/**
 * Lo que se quiso cargar no se puede enviar: no hay ningún gasto, hay más de `MAX_GASTOS_POR_CARGA`, una categoría se repite
 * (una categoría, un gasto por carga), o un `client_ref` no es un uuid o se repite entre dos gastos. Se rechaza ANTES de tocar la
 * red. La pantalla no tendría que dejarlo pasar (el botón no se puede tocar sin nada tildado, las categorías son casillas que se
 * tildan una vez y se corta en el tope): si llega acá es un error de programación, no algo que el usuario pueda arreglar
 * reintentando.
 *
 * Un `client_ref` repetido dentro de la carga es lo más delicado: el INSERT de varias filas chocaría con el índice único del
 * `client_ref` y `crearGastos` lo leería como «ya estaban guardados» sin que se haya guardado nada.
 */
export class LoteDeGastosInvalidoError extends DataRequestError {
  readonly motivo: MotivoDeLoteInvalido;

  constructor(motivo: MotivoDeLoteInvalido) {
    super({ message: MENSAJES_DE_LOTE_INVALIDO[motivo], code: '22023' });
    this.name = 'LoteDeGastosInvalidoError';
    this.motivo = motivo;
  }
}

/**
 * Texto fijo del `message` de `LoteDeGastosDistintoError`. Es lo que reconoce `mentionsConstraint` en el contexto de errores del
 * guardado (`messagesByConstraint`, igual que `camion_archivado`): así la pantalla le pone su propio texto sin mirar la clase.
 */
export const LOTE_DISTINTO = 'lote_de_gastos_distinto';

/**
 * Ya se mandó un pedido SIN confirmar (se cortó la señal) con otros `client_ref` que los de ahora: se destildó o se agregó una
 * categoría después de un intento sin respuesta. El intento anterior pudo haberse guardado: un gasto «escondido» (guardado pero
 * fuera de la pantalla) es justo lo que no puede pasar, así que `crearGastos` corta ANTES de tocar la red. La pantalla lo evita
 * bloqueando las categorías tras un intento sin confirmar; esta capa no depende de eso. La salida es empezar de nuevo (otros
 * `client_ref` y las huellas vaciadas) y revisar la lista de Gastos.
 */
export class LoteDeGastosDistintoError extends DataRequestError {
  constructor() {
    super({ message: LOTE_DISTINTO, code: '22023' });
    this.name = 'LoteDeGastosDistintoError';
  }
}
