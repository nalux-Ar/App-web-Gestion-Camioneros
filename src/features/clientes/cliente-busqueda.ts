import { normalizarNombre, type ClienteOpcion } from './cliente-nombre';

/**
 * Búsqueda de la lista de Clientes (`/clientes?q=almacen`) y su paso por la URL. Lógica PURA.
 *
 * La búsqueda es LOCAL: filtra la lista ya cargada (hasta `CLIENTES_LIMIT`), sin pedir nada a la base, comparando nombres
 * normalizados (sin tildes, mayúsculas ni espacios de más: "almacen" encuentra "Almacén Central").
 *
 * Todo lo que viene de la URL o del `location.state` es entrada del usuario: el `q` se acepta solo si es texto, se le
 * quitan los caracteres de control y se corta a `MAX_BUSQUEDA` caracteres. Nunca va a SQL ni a una ruta: solo se usa para
 * filtrar en memoria y se muestra como texto.
 */

/** Largo máximo de la búsqueda, en caracteres (code points). */
export const MAX_BUSQUEDA = 100;

/** ¿Es un carácter de control (C0, DEL o C1)? En un campo de una línea no tienen sentido. */
function esControl(caracter: string): boolean {
  const code = caracter.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
}

/** El texto de búsqueda saneado: solo texto, sin caracteres de control (se cambian por un espacio) y hasta 100 caracteres. */
export function limpiarBusqueda(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Se acota ANTES de partir el texto en caracteres: un `?q=` de millones de caracteres (autoinfligido, pero pasa por acá en
  // cada render) no se recorre entero. 2 × MAX_BUSQUEDA unidades UTF-16 alcanzan siempre para 100 code points (un emoji ocupa 2).
  return Array.from(raw.slice(0, MAX_BUSQUEDA * 2))
    .slice(0, MAX_BUSQUEDA)
    .map((caracter) => (esControl(caracter) ? ' ' : caracter))
    .join('');
}

/** Lee `?q=` de los search params (saneado). Sin `q`, o con algo que no sirve, es '' (sin búsqueda). */
export function leerBusqueda(params: URLSearchParams): string {
  return limpiarBusqueda(params.get('q'));
}

/** ¿Hay algo que buscar? Solo espacios no cuenta. */
export function hayBusqueda(q: string): boolean {
  return q.trim() !== '';
}

/** Search params para una búsqueda. Una búsqueda vacía (o de solo espacios) no se escribe: `/clientes` es "todos". */
export function busquedaToParams(q: string): URLSearchParams {
  const params = new URLSearchParams();
  const limpia = limpiarBusqueda(q);
  if (hayBusqueda(limpia)) params.set('q', limpia);
  return params;
}

/** '' o '?q=...' (con el `?`), para armar enlaces y el `volver`. */
export function busquedaToSearch(q: string): string {
  const texto = busquedaToParams(q).toString();
  return texto ? `?${texto}` : '';
}

/**
 * `search` para volver a la lista de Clientes (viaja en `location.state`): solo se acepta lo que `busquedaToSearch` podría
 * haber escrito (`?q=...`, saneado). Cualquier otra cosa (rutas, URLs, otros parámetros, objetos) se ignora: el estado de
 * navegación no es de confianza.
 */
export function sanitizeVolverClientes(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  const texto = raw.startsWith('?') ? raw.slice(1) : raw;
  return busquedaToSearch(leerBusqueda(new URLSearchParams(texto)));
}

/**
 * Los clientes cuyo nombre CONTIENE la búsqueda, comparando nombres normalizados (sin tildes, mayúsculas ni espacios de
 * más). Conserva el orden de la lista. Sin búsqueda, todos.
 */
export function filtrarClientes<T extends ClienteOpcion>(clientes: readonly T[], q: string): T[] {
  const buscado = normalizarNombre(q);
  if (buscado === '') return [...clientes];
  return clientes.filter((cliente) => normalizarNombre(cliente.nombre).includes(buscado));
}

/** "3 clientes" / "1 cliente" o, con búsqueda, "2 de 3 clientes". Para el aviso a lectores de pantalla y la línea de conteo. */
export function textoCantidadClientes(visibles: number, total: number, conBusqueda: boolean): string {
  const deTotal = total === 1 ? '1 cliente' : `${total} clientes`;
  if (!conBusqueda) return deTotal;
  return `${visibles} de ${deTotal}`;
}
