/**
 * UUIDs del lado del cliente: validar los que vienen de la URL y generar
 * claves de idempotencia (`client_ref`). Sin dependencias.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Es un uuid con el formato canónico (8-4-4-4-12 en hexadecimal)? Sirve para
 *  validar ids que llegan por la URL antes de usarlos en una consulta. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * uuid v4 aleatorio. `crypto.randomUUID()` solo existe en contextos seguros
 * (https o localhost): probando la app desde el celular por la IP de la red
 * local (http) NO está, y un formulario que explota al abrirse es peor que
 * uno con un respaldo. Respaldo 1: `crypto.getRandomValues` (existe también
 * fuera de contextos seguros). Respaldo 2 (navegadores muy viejos):
 * `Math.random`, suficiente para una clave de idempotencia (la base la
 * compara solo dentro del mismo transportista).
 */
export function generateUuid(): string {
  const cryptoApi = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
