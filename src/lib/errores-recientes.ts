import { classifyDataError, type DataErrorKind } from '@/lib/data-errors';

/**
 * Registro en MEMORIA de los últimos errores técnicos de la sesión, para mandarlos con un reporte de problema
 * ("Reportar un problema": `contexto.errores_recientes`). Se alimenta de forma central, sin tocar cada pantalla: el
 * `QueryCache` y el `MutationCache` de `query-client.ts` (cualquier consulta o guardado que falla) y el `ErrorBoundary`
 * (un error al dibujar).
 *
 * SEGURIDAD (es lo importante de este archivo): cada entrada es una LISTA BLANCA armada acá, nunca el error tal cual.
 *  - `tipo`: la clase del error (`classifyDataError`), o `render`.
 *  - `sqlstate`: el código de Postgres, solo si son exactamente 5 mayúsculas o dígitos ("23505", "P0002").
 *  - `constraint`: solo el NOMBRE de un constraint, y solo si el MENSAJE es exactamente una de las frases de Postgres que
 *    lo citan (unique, check, foreign key, exclusión) y es un identificador simple (`^[a-z0-9_]{1,63}$`). Nunca de los
 *    detalles. Del mensaje se toma ese nombre y nada más.
 *  - `operacion`: de dónde vino (el `scope.id` de una mutación, o la parte fija de la key de una consulta, sin el tenant
 *    ni parámetros), solo si cumple `^[a-z0-9-]{1,40}$`.
 *  - `hace_s`: hace cuántos segundos pasó (se calcula al leer).
 * JAMÁS el `message`, `details`, `hint` ni ningún otro texto del servidor: los errores de Postgres pueden traer valores
 * reales de los datos ("Key (patente)=(AB123CD) already exists"). Tampoco ids, ni del usuario ni de la cuenta.
 *
 * Se vacía al cerrar sesión o cambiar de usuario (`AuthProvider`, junto con la caché de datos). Los errores del propio
 * envío del reporte no se registran (`meta.sinRegistroDeErrores` en la mutación): si no, un reporte que falla por falta
 * de red llenaría el registro de sus propios fallos.
 */

/** Cuántos errores se guardan (los más viejos se descartan) y cuántos se leen para un reporte. */
export const MAX_ERRORES_GUARDADOS = 20;
export const ERRORES_POR_REPORTE = 5;

export type TipoErrorReciente = DataErrorKind | 'render';

/** Una entrada tal como viaja en el reporte. `type` (no `interface`): tiene que poder ir en una columna JSON. */
export type ErrorReciente = {
  tipo: TipoErrorReciente;
  sqlstate?: string;
  constraint?: string;
  operacion?: string;
  hace_s: number;
};

type Entrada = Omit<ErrorReciente, 'hace_s'> & { en: number };

let entradas: Entrada[] = [];

const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONSTRAINT = /^[a-z0-9_]{1,63}$/;
const OPERACION = /^[a-z0-9-]{1,40}$/;

/** El nombre que se captura y otro nombre citado (de tabla o relación), entre comillas. */
const NOMBRE = '"([^"]{1,63})"';
const OTRO_NOMBRE = '"[^"]{1,63}"';
/**
 * Las frases EXACTAS con que Postgres cita el nombre de un constraint, ancladas al principio y al final: el MENSAJE tiene que
 * ser una de ellas, entera. El texto de los datos suele ir dentro de un mensaje (p. ej. `invalid input syntax for type
 * uuid: "<lo que escribió la persona>"`) o en los detalles (`Failing row contains (…)`): un mensaje que no es exactamente
 * una de estas frases no aporta constraint, aunque adentro diga `constraint "…"`.
 */
const FRASES_CON_CONSTRAINT: readonly RegExp[] = [
  `duplicate key value violates unique constraint ${NOMBRE}`,
  `new row for relation ${OTRO_NOMBRE} violates check constraint ${NOMBRE}`,
  `insert or update on table ${OTRO_NOMBRE} violates foreign key constraint ${NOMBRE}`,
  `update or delete on table ${OTRO_NOMBRE} violates foreign key constraint ${NOMBRE} on table ${OTRO_NOMBRE}`,
  `conflicting key value violates exclusion constraint ${NOMBRE}`,
].map((frase) => new RegExp(`^${frase}$`));
/** Una parte de query key que es un rótulo fijo ("resumen", "lista", "categorias-gasto"), no un parámetro (fechas e ids llevan dígitos). */
const ROTULO_DE_KEY = /^[a-z][a-z-]{0,30}$/;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/** El SQLSTATE del error si es un código de 5 mayúsculas o dígitos; si no, nada. */
function sqlstateDe(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = texto((error as Record<string, unknown>).code);
  return SQLSTATE.test(code) ? code : undefined;
}

/**
 * SOLO el nombre del constraint, si el MENSAJE es exactamente una de las frases de Postgres que lo citan
 * (`FRASES_CON_CONSTRAINT`) y el nombre es un identificador simple. NUNCA de los detalles: traen valores de los datos.
 */
function constraintDe(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const fuentes = [texto((error as Record<string, unknown>).message)];
  for (const fuente of fuentes) {
    for (const frase of FRASES_CON_CONSTRAINT) {
      const nombre = frase.exec(fuente)?.[1];
      if (nombre !== undefined && CONSTRAINT.test(nombre)) return nombre;
    }
  }
  return undefined;
}

/** La operación si es un identificador corto y seguro; si no, nada. */
export function operacionValida(valor: unknown): string | undefined {
  return typeof valor === 'string' && OPERACION.test(valor) ? valor : undefined;
}

/**
 * La parte fija de una query key, sin el tenant ni parámetros: `['tenant', <id>, 'resumen', 'gastos', '2026-10-01', …]`
 * → `resumen-gastos`. Toma hasta 2 rótulos seguidos después del tenant y corta en el primer parámetro.
 */
export function operacionDeQueryKey(queryKey: unknown): string | undefined {
  if (!Array.isArray(queryKey)) return undefined;
  const partes = queryKey[0] === 'tenant' ? queryKey.slice(2) : queryKey;
  const rotulos: string[] = [];
  for (const parte of partes) {
    if (rotulos.length === 2 || typeof parte !== 'string' || !ROTULO_DE_KEY.test(parte)) break;
    rotulos.push(parte);
  }
  return rotulos.length > 0 ? operacionValida(rotulos.join('-')) : undefined;
}

function guardar(entrada: Entrada): void {
  entradas = [...entradas, entrada].slice(-MAX_ERRORES_GUARDADOS);
}

/** Un error de una consulta o de un guardado. `operacion` ya viene armada por quien llama (y se vuelve a validar acá). */
export function registrarErrorDeDatos(error: unknown, operacion?: unknown, ahora: number = Date.now()): void {
  const entrada: Entrada = { tipo: classifyDataError(error), en: ahora };
  const sqlstate = sqlstateDe(error);
  const constraint = constraintDe(error);
  const operacionSegura = operacionValida(operacion);
  if (sqlstate !== undefined) entrada.sqlstate = sqlstate;
  if (constraint !== undefined) entrada.constraint = constraint;
  if (operacionSegura !== undefined) entrada.operacion = operacionSegura;
  guardar(entrada);
}

/** Un error al dibujar (lo atrapó el `ErrorBoundary`). Nada del error: solo que pasó. */
export function registrarErrorDeRender(ahora: number = Date.now()): void {
  guardar({ tipo: 'render', en: ahora });
}

/** Los últimos `cantidad` errores, del más viejo al más nuevo, con hace cuántos segundos pasaron. */
export function erroresRecientes(cantidad: number = ERRORES_POR_REPORTE, ahora: number = Date.now()): ErrorReciente[] {
  if (cantidad <= 0) return [];
  return entradas.slice(-cantidad).map(({ en, ...resto }) => ({ ...resto, hace_s: Math.max(0, Math.round((ahora - en) / 1000)) }));
}

/** Vacía el registro (al cerrar sesión o cambiar de usuario). */
export function limpiarErroresRecientes(): void {
  entradas = [];
}
