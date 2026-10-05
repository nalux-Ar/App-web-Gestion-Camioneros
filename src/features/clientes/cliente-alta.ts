import { generateClientRef } from '@/features/gastos/client-ref';
import type { ClienteDatos } from './cliente-form';
import { buscarDuplicado, normalizarNombre, type ClienteOpcion } from './cliente-nombre';

/**
 * Alta de un cliente con aviso de duplicado: la usan el formulario de Clientes y el "+ Nuevo cliente" al vuelo del viaje.
 * Lógica pura: la creación real se inyecta (`io`), así se prueba sin Supabase ni React.
 *
 * Dos cosas distintas:
 *  - El AVISO de duplicado: la base no tiene unique por nombre (bloquearía homónimos legítimos, p.ej. dos sucursales con el
 *    mismo nombre), así que, antes de crear, se compara el nombre normalizado contra la lista cargada y, si ya hay uno, NO
 *    se crea: la persona decide ("Usar ese" / "Ver ese cliente" o "Crear / Guardar de todos modos").
 *  - Los REINTENTOS: se resuelven en la base con el `client_ref` (migración 009, ver `crearClienteIdempotente`). Un
 *    "Reintentar" tras una respuesta perdida manda el MISMO `client_ref`: si el primer intento llegó, la base lo reconoce
 *    (23505) y se usa ese cliente en vez de crear otro. Antes de la 009 esto se mitigaba solo en el front (volver a pedir la
 *    lista y buscar el nombre antes de reintentar); ya no hace falta.
 */

export interface AltaClienteIO {
  /** Guarda el cliente con idempotencia (`crearClienteIdempotente`) y devuelve el que quedó guardado. Tira el error si falla. */
  crear(args: { datos: ClienteDatos; clientRef: string; sent: Set<string> }): Promise<ClienteOpcion>;
}

/**
 * Lo que hay que recordar entre intentos del MISMO formulario (o mini formulario). `altaCliente` lo modifica. Se descarta
 * (o se reemplaza por uno nuevo) al cerrar el formulario o tras crear bien.
 */
export interface AltaClienteEstado {
  /** Clave de idempotencia: una al abrir el formulario, la MISMA en cada reintento, nueva tras crear bien. */
  clientRef: string;
  /** Huellas de lo ya mandado con este `clientRef` (ver `crearClienteIdempotente`). */
  sent: Set<string>;
  /**
   * Nombres (normalizados) que ya se mandaron con este `clientRef`: ya pasaron el aviso (o la persona eligió crearlo de todos
   * modos), así que su reintento NO vuelve a avisar. Si avisara, el "cliente que ya existe" podría ser justamente el que creó
   * el intento anterior (respuesta perdida), y el aviso confundiría: el reintento lo resuelve la base por el `client_ref`.
   */
  nombresEnviados: Set<string>;
}

export function estadoInicialAlta(): AltaClienteEstado {
  return { clientRef: generateClientRef(), sent: new Set(), nombresEnviados: new Set() };
}

export type AltaClienteResultado =
  /** Se creó (o ya estaba creado por un intento anterior): hay que usarlo. */
  | { tipo: 'creado'; cliente: ClienteOpcion }
  /** NO se creó: ya hay uno con ese nombre. La persona decide qué hacer. */
  | { tipo: 'duplicado'; existente: ClienteOpcion };

interface AltaClienteArgs {
  /** Ya validados y recortados (el nombre con `validateNombreCliente`). */
  datos: ClienteDatos;
  /** "Crear / Guardar de todos modos": se salta el aviso. */
  forzar: boolean;
  /** La lista de clientes cargada en pantalla (contra la que se busca el duplicado). */
  clientes: readonly ClienteOpcion[];
  estado: AltaClienteEstado;
  io: AltaClienteIO;
}

/**
 * - Si hay un cliente con el mismo nombre normalizado (y no se fuerza ni es el reintento de un nombre ya mandado), devuelve
 *   `duplicado` SIN crear.
 * - Si no, crea con el `client_ref` del estado (idempotente) y devuelve el cliente guardado. Un error se propaga tal cual
 *   (con su `code`) y el estado queda listo para reintentar con la misma clave.
 */
export async function altaCliente({ datos, forzar, clientes, estado, io }: AltaClienteArgs): Promise<AltaClienteResultado> {
  const nombre = normalizarNombre(datos.nombre);
  if (!forzar && !estado.nombresEnviados.has(nombre)) {
    const existente = buscarDuplicado(datos.nombre, clientes);
    if (existente) return { tipo: 'duplicado', existente };
  }

  estado.nombresEnviados.add(nombre);
  const cliente = await io.crear({ datos, clientRef: estado.clientRef, sent: estado.sent });
  return { tipo: 'creado', cliente };
}
