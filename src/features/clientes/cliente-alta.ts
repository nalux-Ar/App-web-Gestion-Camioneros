import { isRetryableDataError } from '@/lib/data-errors';
import { buscarDuplicado, normalizarNombre, type ClienteOpcion } from './cliente-nombre';

/**
 * Alta de un cliente "al vuelo" (desde un viaje) con aviso de duplicado. Lógica pura: la lista
 * fresca y la creación real se inyectan (`io`), así se prueba sin Supabase ni React.
 *
 * El problema de los reintentos: la tabla `clientes` no tiene clave de idempotencia (no hay `client_ref`
 * ni unique por nombre: bloquearía homónimos legítimos). Si la creación falla por red o timeout, la
 * respuesta pudo perderse y el cliente pudo haberse creado igual; un "Reintentar" a ciegas crearía el
 * segundo. Por eso, tras un fallo reintentable, el próximo intento PRIMERO refresca la lista y vuelve a
 * correr la verificación de duplicado: si el cliente de la respuesta perdida ya está, se ofrece "Usar ese".
 */

export interface AltaClienteIO {
  /** Pide la lista de clientes de nuevo y devuelve lo que hay AHORA en la base. Tira el error si falla. */
  refrescar(): Promise<readonly ClienteOpcion[]>;
  /** INSERT del cliente. Tira el error si falla. */
  crear(nombre: string): Promise<ClienteOpcion>;
}

/**
 * Lo que hay que recordar entre intentos del MISMO mini formulario. `altaCliente` lo modifica. Se
 * descarta al cerrar el mini formulario (cancelar o crear bien).
 */
export interface AltaClienteEstado {
  /** El intento anterior falló por red/timeout/servidor: no se sabe si el cliente se creó. */
  verificarAntes: boolean;
  /**
   * Ids de homónimos que la persona ya vio y aceptó con "Crear de todos modos". No vuelven a
   * contar como duplicado en un reintento (si no, el aviso mostraría siempre al cliente que ya
   * tenía y no al que se creó en la respuesta perdida).
   */
  ignorar: Set<string>;
}

export function estadoInicialAlta(): AltaClienteEstado {
  return { verificarAntes: false, ignorar: new Set() };
}

export type AltaClienteResultado =
  /** Se creó: hay que seleccionarlo. */
  | { tipo: 'creado'; cliente: ClienteOpcion }
  /** NO se creó: ya hay uno con ese nombre. La persona elige usarlo o crear otro igual. */
  | { tipo: 'duplicado'; existente: ClienteOpcion };

interface AltaClienteArgs {
  /** Nombre ya validado y recortado (`validateNombreCliente`). */
  nombre: string;
  /** "Crear de todos modos": se salta el aviso y los homónimos actuales quedan aceptados. */
  forzar: boolean;
  /** La lista de clientes cargada en pantalla (la que se usa si no hace falta refrescar). */
  clientes: readonly ClienteOpcion[];
  estado: AltaClienteEstado;
  io: AltaClienteIO;
}

/**
 * - Si el intento anterior quedó en duda (`estado.verificarAntes`), refresca la lista primero. Si el
 *   refresco falla, se propaga el error SIN crear nada y la duda sigue en pie.
 * - Si hay un cliente con el mismo nombre normalizado (y no se fuerza), devuelve `duplicado` sin crear.
 * - Si no, crea. Si la creación falla con un error reintentable, deja la duda anotada y propaga el error.
 */
export async function altaCliente({ nombre, forzar, clientes, estado, io }: AltaClienteArgs): Promise<AltaClienteResultado> {
  const lista = estado.verificarAntes ? await io.refrescar() : clientes;

  if (forzar) {
    const buscado = normalizarNombre(nombre);
    for (const cliente of lista) {
      if (normalizarNombre(cliente.nombre) === buscado) estado.ignorar.add(cliente.id);
    }
  } else {
    const existente = buscarDuplicado(nombre, lista, estado.ignorar);
    if (existente) return { tipo: 'duplicado', existente };
  }

  let cliente: ClienteOpcion;
  try {
    cliente = await io.crear(nombre);
  } catch (error) {
    // Con red/timeout/servidor el cliente pudo haberse creado igual. Con un error que da lo mismo
    // reintentando (datos inválidos, permiso) no se creó: no hay nada que verificar.
    estado.verificarAntes = isRetryableDataError(error);
    throw error;
  }
  estado.verificarAntes = false;
  estado.ignorar.clear();
  return { tipo: 'creado', cliente };
}
