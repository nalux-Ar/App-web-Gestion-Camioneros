import type { ResolucionCamion } from '@/features/camiones/camion-seleccion';
import type { MetodoPago } from '@/lib/db';
import { MAX_GASTOS_POR_CARGA } from './constants';
import {
  validateGastoForm,
  type GastoColumns,
  type GastoFormField,
  type GastoFormValues,
  type TanqueLlenoChoice,
  type ValidarGastoContext,
} from './gasto-form';
import { LoteDeGastosInvalidoError } from './gasto-lote-errores';

/**
 * Validación PURA de cargar VARIOS gastos de una vez («Nuevo gasto» con más de una categoría). Cada categoría tildada es un
 * BLOQUE con su propio monto, descripción y método de pago (y, en Combustible, litros, km, tanque lleno y camión); la fecha y el
 * viaje son UNO solo, compartido por todos. Cada gasto sigue siendo una fila con una categoría.
 *
 * NO repite ninguna regla: cada bloque se valida llamando a `validateGastoForm` con lo compartido + lo suyo, y esto solo junta los
 * resultados. Con UN solo bloque el resultado es exactamente el de `validateGastoForm` (mismas columnas, mismos errores, mismo
 * primer campo con error): con una categoría tildada la pantalla se comporta igual que hoy.
 */

/** Lo que se completa UNA vez y vale para todos los gastos de la carga. */
export interface CompartidoDelLote {
  /** 'YYYY-MM-DD' */
  fecha: string;
  /** Id del viaje al que van todos los gastos, o '' = sin viaje. */
  viajeId: string;
}

/** Lo que se completa por categoría tildada. Todo texto, tal cual lo tipeó el usuario (como `GastoFormValues`). */
export interface BloqueDeGasto {
  categoriaId: string;
  monto: string;
  descripcion: string;
  /** '' = todavía sin elegir (obligatorio en CADA bloque: el método es de cada gasto). */
  metodoPago: '' | MetodoPago;
  // Solo cuentan en Combustible; en las demás categorías se ignoran y esas columnas van en null.
  litros: string;
  kmOdometro: string;
  tanqueLleno: TanqueLlenoChoice;
  /**
   * El camión ya resuelto (`resolverCamion` sobre `decidirCamion`): SOLO para el bloque de Combustible, que es el único que lo
   * usa (el de las demás categorías se ignora). Es el mismo `ResolucionCamion` que recibe `validateGastoForm`: con el camión
   * sin resolver (`undefined`) la carga de combustible va sin camión, igual que allá.
   */
  camion?: ResolucionCamion;
}

/** Lo mismo que necesita `validateGastoForm`, menos el camión: ese va dentro de cada bloque (solo lo usa Combustible). */
export type ValidarLoteContext = Omit<ValidarGastoContext, 'camion'>;

/** Los campos que son de TODA la carga: su error se muestra una sola vez, no en cada bloque. */
export const CAMPOS_COMPARTIDOS = ['fecha', 'viajeId'] as const satisfies readonly GastoFormField[];
export type CampoCompartido = (typeof CAMPOS_COMPARTIDOS)[number];
/** Los que son de cada bloque. */
export type CampoDeBloque = Exclude<GastoFormField, CampoCompartido>;

export type ErroresCompartidos = Partial<Record<CampoCompartido, string>>;
export type ErroresDeBloque = Partial<Record<CampoDeBloque, string>>;

/** ¿Este campo es de toda la carga (fecha, viaje) y no de un bloque? */
export function esCampoCompartido(campo: GastoFormField): campo is CampoCompartido {
  return (CAMPOS_COMPARTIDOS as readonly string[]).includes(campo);
}

/** Un gasto listo para enviar: sus columnas y la categoría a la que pertenece (para ligarlo con su `client_ref`). */
export interface GastoDelLote {
  categoriaId: string;
  columns: GastoColumns;
}

export type LoteValidation =
  | {
      ok: true;
      /** En el MISMO orden que los bloques. */
      gastos: GastoDelLote[];
    }
  | {
      ok: false;
      /** Errores de la fecha y del viaje (uno solo para toda la carga). */
      compartidos: ErroresCompartidos;
      /** Errores propios de cada bloque, SOLO de los bloques que tienen alguno, en el orden de los bloques. */
      bloques: Array<{ categoriaId: string; errors: ErroresDeBloque }>;
      /**
       * Adónde llevar el foco: el PRIMER bloque (en el orden de los bloques) que no valida y su primer campo con error, con el
       * mismo orden de campos que el formulario de un solo gasto (`GASTO_FIELD_ORDER`; con un solo bloque es exactamente su
       * `firstField`). Si lo único que falla es lo compartido (fecha o viaje), es el primer bloque y un campo compartido
       * (`esCampoCompartido`): la pantalla lo lleva a donde tenga ese campo.
       */
      primero: { categoriaId: string; field: GastoFormField };
    };

/**
 * Valida la carga completa y arma las columnas de cada gasto.
 *
 * Tira `LoteDeGastosInvalidoError` (NO es un error de los campos: es algo que la pantalla no tendría que dejar pasar) si no hay
 * ningún bloque, si hay más de `MAX_GASTOS_POR_CARGA`, o si una categoría está en más de un bloque (una categoría, un gasto por
 * carga). Eso se revisa antes de validar nada. Un bloque con una categoría que no existe NO es eso: es un error del campo
 * categoría de ese bloque, como en el formulario de un solo gasto.
 */
export function validateLoteDeGastos(
  compartido: CompartidoDelLote,
  bloques: readonly BloqueDeGasto[],
  context: ValidarLoteContext,
): LoteValidation {
  if (bloques.length === 0) throw new LoteDeGastosInvalidoError('vacio');
  if (bloques.length > MAX_GASTOS_POR_CARGA) throw new LoteDeGastosInvalidoError('demasiadas');
  if (new Set(bloques.map((bloque) => bloque.categoriaId)).size !== bloques.length) {
    throw new LoteDeGastosInvalidoError('repetida');
  }

  const gastos: GastoDelLote[] = [];
  const compartidos: ErroresCompartidos = {};
  const conErrores: Array<{ categoriaId: string; errors: ErroresDeBloque }> = [];
  let primero: { categoriaId: string; field: GastoFormField } | null = null;

  for (const bloque of bloques) {
    const values: GastoFormValues = {
      categoriaId: bloque.categoriaId,
      monto: bloque.monto,
      fecha: compartido.fecha,
      viajeId: compartido.viajeId,
      descripcion: bloque.descripcion,
      metodoPago: bloque.metodoPago,
      // El camión que se elige en pantalla ya llega resuelto en `camion`: `validateGastoForm` no mira este campo.
      camionId: '',
      litros: bloque.litros,
      kmOdometro: bloque.kmOdometro,
      tanqueLleno: bloque.tanqueLleno,
    };
    const resultado = validateGastoForm(values, { ...context, camion: bloque.camion });

    if (resultado.ok) {
      gastos.push({ categoriaId: bloque.categoriaId, columns: resultado.columns });
      continue;
    }

    primero ??= { categoriaId: bloque.categoriaId, field: resultado.firstField };

    const errors: ErroresDeBloque = {};
    for (const [campo, mensaje] of Object.entries(resultado.errors) as Array<[GastoFormField, string]>) {
      if (esCampoCompartido(campo)) compartidos[campo] = mensaje;
      else errors[campo] = mensaje;
    }
    if (Object.keys(errors).length > 0) conErrores.push({ categoriaId: bloque.categoriaId, errors });
  }

  if (primero !== null) return { ok: false, compartidos, bloques: conErrores, primero };
  return { ok: true, gastos };
}
