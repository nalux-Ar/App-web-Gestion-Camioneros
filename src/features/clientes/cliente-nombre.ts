import type { DataErrorContext } from '@/lib/data-errors';
import { charLength } from '@/lib/text';

/**
 * Lógica PURA del nombre de un cliente (sin React ni Supabase): validación, normalización para
 * detectar duplicados y orden. La base sigue siendo la autoridad (check `clientes_nombre_chk`:
 * `length(trim(nombre)) between 1 and 200`); esto es el espejo en el front para avisar antes de enviar.
 *
 * NO hay unique por nombre en la base (bloquearía homónimos legítimos, p.ej. dos sucursales con el
 * mismo nombre): el aviso de "ya tienes un cliente así" se resuelve acá, comparando nombres
 * normalizados contra la lista cargada, y la persona decide ("Usar ese" o "Crear de todos modos").
 */

/** Largo máximo del nombre, en caracteres: mismo valor que el check de la base. */
export const MAX_NOMBRE_CLIENTE = 200;

export const NOMBRE_CLIENTE_VACIO_MESSAGE = 'Escribe el nombre del cliente.';
export const NOMBRE_CLIENTE_LARGO_MESSAGE = `El nombre puede tener hasta ${MAX_NOMBRE_CLIENTE} caracteres.`;

/** Mensajes propios de los errores de la base al CREAR un cliente al vuelo, desde un viaje (constante de módulo: la usa
 *  `useSubmitFeedback`). */
export const CREAR_CLIENTE_CONTEXT: DataErrorContext = {
  // Check de la base (23514, clase 22): el largo del nombre.
  invalidData: `Revisa el nombre del cliente: tiene que tener entre 1 y ${MAX_NOMBRE_CLIENTE} caracteres.`,
  // El cliente que guardó un intento anterior (respuesta perdida) ya no está: crearlo de nuevo funciona (el índice del
  // client_ref quedó libre).
  notFound: 'El cliente que se había creado ya no está. Toca "Crear cliente" para crearlo de nuevo.',
};

/** Lo que la pantalla necesita de un cliente para elegirlo. */
export interface ClienteOpcion {
  id: string;
  nombre: string;
}

export type NombreClienteValidation = { ok: true; value: string } | { ok: false; message: string };

/**
 * Recorta los espacios y exige de 1 a `MAX_NOMBRE_CLIENTE` caracteres (code points, como `length()` de
 * Postgres: un emoji es 1). Devuelve el valor recortado, que es el que se manda a la base. El atajo de
 * `charLength` se aplica al texto YA recortado (un pegado enorme no se recorre entero).
 */
export function validateNombreCliente(raw: string): NombreClienteValidation {
  const value = raw.trim();
  const length = charLength(value, MAX_NOMBRE_CLIENTE);
  if (length < 1) return { ok: false, message: NOMBRE_CLIENTE_VACIO_MESSAGE };
  if (length > MAX_NOMBRE_CLIENTE) return { ok: false, message: NOMBRE_CLIENTE_LARGO_MESSAGE };
  return { ok: true, value };
}

/**
 * Franja de diacríticos combinados (U+0300 a U+036F): lo que queda de las tildes y las diéresis del español
 * después de descomponer con NFD. Armada con códigos numéricos a propósito: escrita con los caracteres
 * literales, la clase se vería como `[-]` en el código.
 */
const DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/**
 * Forma comparable de un nombre: sin espacios de los costados, con los espacios múltiples (y tabs,
 * saltos, espacios duros) reducidos a uno, en minúsculas y sin tildes ni diéresis. "  Cooperativa  ÁGRÍCOLA "
 * y "cooperativa agricola" dan lo mismo. Solo sirve para comparar: lo que se guarda es el nombre tal
 * cual lo escribió la persona (recortado).
 *
 * Las minúsculas van ANTES de descomponer: "İ".toLowerCase() deja una "i" con un punto combinado, que el
 * paso siguiente quita. Solo se quitan las marcas de la franja de diacríticos combinados (U+0300–U+036F),
 * las de las tildes del español: no se tocan marcas de otras escrituras.
 */
export function normalizarNombre(nombre: string): string {
  return nombre
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICOS, '');
}

/**
 * El primer cliente de la lista con el mismo nombre normalizado, o null. Un nombre que normalizado queda
 * vacío no tiene duplicado. `ignorar` son ids de homónimos que la persona ya aceptó ("Crear de todos
 * modos"): no cuentan como duplicado.
 */
export function buscarDuplicado<T extends ClienteOpcion>(
  nombre: string,
  clientes: readonly T[],
  ignorar?: ReadonlySet<string>,
): T | null {
  const buscado = normalizarNombre(nombre);
  if (buscado === '') return null;
  return clientes.find((cliente) => !ignorar?.has(cliente.id) && normalizarNombre(cliente.nombre) === buscado) ?? null;
}

/** Por nombre, en español y sin distinguir mayúsculas ni tildes; a igualdad, por id (orden estable). */
export function ordenarClientes<T extends ClienteOpcion>(clientes: readonly T[]): T[] {
  return [...clientes].sort(
    (a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}

/**
 * La lista cargada más los clientes creados en esta pantalla que la lista todavía no trae (la lista se
 * refresca en segundo plano después de crear: sin esto, el cliente recién creado no estaría para elegir
 * ni para detectar un duplicado). Sin repetidos por id y ordenada. Si un mismo id viene en las dos listas,
 * gana el de la lista cargada (es el dato más nuevo de la base).
 */
export function combinarClientes<T extends ClienteOpcion>(cargados: readonly T[], creados: readonly T[]): T[] {
  const ids = new Set(cargados.map((cliente) => cliente.id));
  return ordenarClientes([...cargados, ...creados.filter((cliente) => !ids.has(cliente.id))]);
}
