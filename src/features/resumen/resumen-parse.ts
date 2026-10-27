import { isValidDateString, type YearMonth } from '@/lib/dates';
import type { MetodoPago } from '@/lib/db';
import { isUuid } from '@/lib/uuid';
import { MAX_FILAS_GASTOS_VARIOS, MAX_FILAS_VIAJES } from './constants';
import { mesesDeLaSerie } from './resumen-fechas';
import { GRUPOS_GASTO, ResumenRespuestaInesperadaError, type GrupoGasto } from './resumen-textos';

/**
 * Lectura y validación de lo que devuelven las 4 funciones de la migración 014. Lógica PURA.
 *
 * NO se confía en los tipos generados (`database.types.ts`): el generador marca como no nulas columnas que la base sí
 * devuelve en NULL (`resultado`, `km_por_litro`, `ganancia`, `clave`, `nombre`, `activa`, `patente`…). Por eso la respuesta
 * entra como `unknown`, se valida fila por fila contra el contrato de la 014 y se convierte a tipos propios, con `| null`
 * SOLO donde el contrato lo permite. Los `numeric` se aceptan como número finito o como texto numérico (según cómo los
 * serialice PostgREST); los enteros, igual, pero tienen que ser enteros.
 *
 * Ante cualquier cosa fuera del contrato (una columna que falta o cambió de tipo, un grupo o un método de pago
 * desconocido, un nulo donde no puede haberlo, una fila repetida, totales que no cuadran) se lanza
 * `ResumenRespuestaInesperadaError` y no se devuelve NADA: un bloque con datos a medias es peor que un bloque con error.
 * Las columnas de más se ignoran (la base podría agregar alguna sin romper este front). La 014 no devuelve un número de
 * versión: la validación estricta es lo que detecta un contrato distinto.
 */

// ---------------------------------------------------------------------------
// Tipos propios (lo que usa la pantalla)
// ---------------------------------------------------------------------------

export interface MontoYCantidad {
  cantidad: number;
  monto: number;
}

export interface GastoPorCategoria extends MontoYCantidad {
  categoriaId: string;
  /** El nombre que tiene la categoría en la base (la pantalla puede preferir `nombreParaMostrar` de la lista de categorías). */
  nombre: string;
}

export interface GastoPorMetodo extends MontoYCantidad {
  /** null = "Sin especificar". */
  metodo: MetodoPago | null;
}

export interface GastoPorCamion extends MontoYCantidad {
  /** null = "Sin camión". */
  camionId: string | null;
  /** Normalizada; null solo sin camión. */
  patente: string | null;
  /** false = archivado; null solo sin camión. */
  activa: boolean | null;
}

/** `resumen_gastos`: el total (siempre) y los desgloses, en el orden de la base (monto de mayor a menor). */
export interface ResumenGastos {
  total: MontoYCantidad;
  porCategoria: GastoPorCategoria[];
  porMetodo: GastoPorMetodo[];
  porCamion: GastoPorCamion[];
}

/** Una fila de `resumen_mensual`. */
export interface ResumenDelMes {
  /** Primer día del mes, 'YYYY-MM-01'. */
  mes: string;
  gastosCantidad: number;
  gastosMonto: number;
  combustibleCargas: number;
  combustibleLitros: number;
  combustibleMonto: number;
  viajesCantidad: number;
  viajesKm: number;
  viajesConIngreso: number;
  viajesSinIngreso: number;
  viajesIngreso: number;
  /** Ingresos de los viajes del mes − todos los gastos del mes; null si ningún viaje del mes tiene ingreso cargado. */
  resultado: number | null;
}

/** Una fila de `resumen_combustible`. */
export interface CombustibleDelCamion {
  camionId: string;
  patente: string;
  /** false = archivado. */
  activa: boolean;
  /** Cargas (gastos con litros) con fecha en el período. */
  cargas: number;
  litros: number;
  monto: number;
  /** Monto / litros de las cargas del período; null sin cargas. */
  precioPromedio: number | null;
  /** Cargas del período con tanque lleno Y odómetro (los bordes de los tramos). */
  llenasConOdometro: number;
  /** Tramos VÁLIDOS que cierran en el período. Con 0, todo lo de abajo es null. */
  tramos: number;
  tramosKm: number | null;
  tramosLitros: number | null;
  tramosMonto: number | null;
  kmPorLitro: number | null;
  litros100km: number | null;
  costoPorKm: number | null;
  descartados: { retroceso: number; sinAvance: number; fueraDeRango: number };
}

/** Una fila de `resumen_viajes`. */
export interface ViajeDelResumen {
  viajeId: string;
  /** 'YYYY-MM-DD'. */
  fecha: string;
  origen: string;
  destino: string;
  camionId: string | null;
  patente: string | null;
  km: number | null;
  ingreso: number | null;
  gastosCantidad: number;
  gastosMonto: number;
  /** Ingreso − todos los gastos vinculados (de cualquier fecha); null si el viaje no tiene ingreso cargado. */
  ganancia: number | null;
}

/** `resumen_viajes`: los viajes (del más nuevo al más viejo, como máximo 500) y cuántos hay en total en el período. */
export interface ResumenViajes {
  viajes: ViajeDelResumen[];
  total: number;
  /** true si la base cortó la lista (hay más viajes que filas). */
  cortada: boolean;
}

/** Un gasto de la categoría "Gastos varios" (`resumen_gastos_varios`, migración 018). */
export interface GastoVarioDelMes {
  id: string;
  /** 'YYYY-MM-DD'. */
  fecha: string;
  /** Ya recortada por la base (80 caracteres); null si el gasto no tiene descripción. Es TEXTO: nunca se interpreta como HTML. */
  descripcion: string | null;
  /** true = la descripción tenía más y la base la cortó. */
  truncada: boolean;
  monto: number;
}

/** `resumen_gastos_varios`: los gastos varios del período (como máximo 30, fecha y monto de mayor a menor) y cuántos hay en total. */
export interface ResumenGastosVarios {
  filas: GastoVarioDelMes[];
  /** Cantidad TOTAL de gastos varios del período (si es mayor que `filas.length`, la base cortó la lista). */
  totalCantidad: number;
}

// ---------------------------------------------------------------------------
// Lectores de campos (fallan con el motivo)
// ---------------------------------------------------------------------------

const METODOS_PAGO: readonly MetodoPago[] = ['efectivo', 'tarjeta_credito', 'tarjeta_debito', 'transferencia'];
/** Un `numeric` serializado como texto: solo dígitos, con signo y decimales opcionales (nada de '1e3', '0x10', ' 12'). */
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

type Fila = Record<string, unknown>;

class Lector {
  constructor(readonly rpc: string) {}

  falla(motivo: string): never {
    throw new ResumenRespuestaInesperadaError(this.rpc, motivo);
  }

  filas(datos: unknown, max?: number): Fila[] {
    if (!Array.isArray(datos)) this.falla('la respuesta no es una lista de filas');
    if (max !== undefined && datos.length > max) this.falla(`más de ${max} filas`);
    return datos.map((fila, i) => {
      if (typeof fila !== 'object' || fila === null || Array.isArray(fila)) this.falla(`la fila ${i} no es un objeto`);
      return fila as Fila;
    });
  }

  /** Número finito (o texto numérico). `min` opcional. */
  numero(fila: Fila, campo: string, { min }: { min?: number } = {}): number {
    const valor = fila[campo];
    let numero: number | null = null;
    if (typeof valor === 'number') numero = valor;
    else if (typeof valor === 'string' && NUMERIC_TEXT.test(valor)) numero = Number(valor);
    if (numero === null || !Number.isFinite(numero)) this.falla(`${campo} no es un número`);
    if (min !== undefined && numero < min) this.falla(`${campo} es menor que ${min}`);
    return numero === 0 ? 0 : numero; // sin -0
  }

  numeroONulo(fila: Fila, campo: string, opciones: { min?: number } = {}): number | null {
    if (!(campo in fila)) this.falla(`falta ${campo}`);
    return fila[campo] === null ? null : this.numero(fila, campo, opciones);
  }

  /** Entero >= `min` (por defecto 0). */
  entero(fila: Fila, campo: string, { min = 0 }: { min?: number } = {}): number {
    const numero = this.numero(fila, campo, { min });
    if (!Number.isInteger(numero)) this.falla(`${campo} no es un entero`);
    return numero;
  }

  texto(fila: Fila, campo: string): string {
    const valor = fila[campo];
    if (typeof valor !== 'string') this.falla(`${campo} no es un texto`);
    return valor;
  }

  textoONulo(fila: Fila, campo: string): string | null {
    if (!(campo in fila)) this.falla(`falta ${campo}`);
    return fila[campo] === null ? null : this.texto(fila, campo);
  }

  /** Texto no vacío (nombres y patentes). */
  textoConValor(fila: Fila, campo: string): string {
    const valor = this.texto(fila, campo);
    if (valor.trim() === '') this.falla(`${campo} está vacío`);
    return valor;
  }

  booleano(fila: Fila, campo: string): boolean {
    const valor = fila[campo];
    if (typeof valor !== 'boolean') this.falla(`${campo} no es verdadero o falso`);
    return valor;
  }

  uuid(fila: Fila, campo: string): string {
    const valor = fila[campo];
    if (!isUuid(valor)) this.falla(`${campo} no es un uuid`);
    return valor.toLowerCase();
  }

  uuidONulo(fila: Fila, campo: string): string | null {
    if (!(campo in fila)) this.falla(`falta ${campo}`);
    return fila[campo] === null ? null : this.uuid(fila, campo);
  }

  fecha(fila: Fila, campo: string): string {
    const valor = fila[campo];
    if (typeof valor !== 'string' || !isValidDateString(valor)) this.falla(`${campo} no es una fecha`);
    return valor;
  }

  /** Para las columnas que el contrato pide en NULL (presentes y nulas). */
  nulo(fila: Fila, campo: string): void {
    if (!(campo in fila) || fila[campo] !== null) this.falla(`${campo} tendría que ser nulo`);
  }

  sinRepetidos(claves: ReadonlyArray<string | null>, que: string): void {
    if (new Set(claves).size !== claves.length) this.falla(`${que} repetido`);
  }
}

// ---------------------------------------------------------------------------
// resumen_gastos
// ---------------------------------------------------------------------------

/** Busca el grupo en la lista blanca (no por clave de objeto: `'toString'` no pasa). */
function grupoDe(valor: unknown): GrupoGasto | null {
  return GRUPOS_GASTO.find((grupo) => grupo === valor) ?? null;
}

function metodoDe(lector: Lector, fila: Fila): MetodoPago | null {
  const clave = lector.textoONulo(fila, 'clave');
  if (clave === null) return null;
  const metodo = METODOS_PAGO.find((permitido) => permitido === clave);
  if (metodo === undefined) lector.falla('método de pago desconocido');
  return metodo;
}

export function parseResumenGastos(datos: unknown): ResumenGastos {
  const lector = new Lector('resumen_gastos');
  const totales: MontoYCantidad[] = [];
  const porCategoria: GastoPorCategoria[] = [];
  const porMetodo: GastoPorMetodo[] = [];
  const porCamion: GastoPorCamion[] = [];

  for (const fila of lector.filas(datos)) {
    const grupo = grupoDe(fila.grupo);
    if (grupo === null) lector.falla('grupo desconocido');
    const monto = lector.numero(fila, 'monto', { min: 0 });
    switch (grupo) {
      case 'total':
        lector.nulo(fila, 'clave');
        lector.nulo(fila, 'nombre');
        lector.nulo(fila, 'activa');
        totales.push({ cantidad: lector.entero(fila, 'cantidad'), monto });
        break;
      case 'categoria':
        lector.nulo(fila, 'activa');
        porCategoria.push({
          categoriaId: lector.uuid(fila, 'clave'),
          nombre: lector.textoConValor(fila, 'nombre'),
          cantidad: lector.entero(fila, 'cantidad', { min: 1 }),
          monto,
        });
        break;
      case 'metodo_pago':
        lector.nulo(fila, 'nombre');
        lector.nulo(fila, 'activa');
        porMetodo.push({ metodo: metodoDe(lector, fila), cantidad: lector.entero(fila, 'cantidad', { min: 1 }), monto });
        break;
      case 'camion': {
        const camionId = lector.uuidONulo(fila, 'clave');
        if (camionId === null) {
          lector.nulo(fila, 'nombre');
          lector.nulo(fila, 'activa');
        }
        porCamion.push({
          camionId,
          patente: camionId === null ? null : lector.textoConValor(fila, 'nombre'),
          activa: camionId === null ? null : lector.booleano(fila, 'activa'),
          cantidad: lector.entero(fila, 'cantidad', { min: 1 }),
          monto,
        });
        break;
      }
    }
  }

  if (totales.length !== 1) lector.falla(totales.length === 0 ? 'falta la fila total' : 'más de una fila total');
  lector.sinRepetidos(
    porCategoria.map((fila) => fila.categoriaId),
    'categoría',
  );
  lector.sinRepetidos(
    porMetodo.map((fila) => fila.metodo),
    'método de pago',
  );
  lector.sinRepetidos(
    porCamion.map((fila) => fila.camionId),
    'camión',
  );
  return { total: totales[0]!, porCategoria, porMetodo, porCamion };
}

// ---------------------------------------------------------------------------
// resumen_mensual
// ---------------------------------------------------------------------------

/**
 * `esperado`: con qué se llamó (`mesDesde` y `meses`). La base devuelve EXACTAMENTE `meses` filas, una por mes y en orden
 * desde el de `mesDesde`: si no, es una respuesta inesperada.
 */
export function parseResumenMensual(datos: unknown, esperado: { mesDesde: YearMonth; meses: number }): ResumenDelMes[] {
  const lector = new Lector('resumen_mensual');
  const filas = lector.filas(datos);
  if (filas.length !== esperado.meses) lector.falla(`se esperaban ${esperado.meses} meses y llegaron ${filas.length}`);
  const meses = mesesDeLaSerie(esperado.mesDesde, esperado.meses);

  return filas.map((fila, i) => {
    const mes = lector.fecha(fila, 'mes');
    if (mes !== meses[i]) lector.falla(`el mes ${i} no es ${meses[i]}`);
    const viajesCantidad = lector.entero(fila, 'viajes_cantidad');
    const viajesConIngreso = lector.entero(fila, 'viajes_con_ingreso');
    const viajesSinIngreso = lector.entero(fila, 'viajes_sin_ingreso');
    if (viajesConIngreso + viajesSinIngreso !== viajesCantidad) lector.falla('los viajes con y sin ingreso no suman el total');
    const resultado = lector.numeroONulo(fila, 'resultado');
    // El contrato: resultado NULL si y solo si ningún viaje del mes tiene ingreso (un ingreso 0 cuenta como cargado).
    if ((resultado === null) !== (viajesConIngreso === 0)) lector.falla('resultado no coincide con los viajes con ingreso');
    return {
      mes,
      gastosCantidad: lector.entero(fila, 'gastos_cantidad'),
      gastosMonto: lector.numero(fila, 'gastos_monto', { min: 0 }),
      combustibleCargas: lector.entero(fila, 'combustible_cargas'),
      combustibleLitros: lector.numero(fila, 'combustible_litros', { min: 0 }),
      combustibleMonto: lector.numero(fila, 'combustible_monto', { min: 0 }),
      viajesCantidad,
      viajesKm: lector.numero(fila, 'viajes_km', { min: 0 }),
      viajesConIngreso,
      viajesSinIngreso,
      viajesIngreso: lector.numero(fila, 'viajes_ingreso', { min: 0 }),
      resultado,
    };
  });
}

// ---------------------------------------------------------------------------
// resumen_combustible
// ---------------------------------------------------------------------------

/** `esperado.camionId`: si se filtró por un camión, todas las filas tienen que ser de ese camión (0 o 1 fila). */
export function parseResumenCombustible(datos: unknown, esperado: { camionId: string | null } = { camionId: null }): CombustibleDelCamion[] {
  const lector = new Lector('resumen_combustible');
  const filas = lector.filas(datos).map((fila): CombustibleDelCamion => {
    const camionId = lector.uuid(fila, 'camion_id');
    if (esperado.camionId !== null && camionId !== esperado.camionId.toLowerCase()) lector.falla('fila de otro camión');
    const cargas = lector.entero(fila, 'cargas');
    const litros = lector.numero(fila, 'litros', { min: 0 });
    const precioPromedio = lector.numeroONulo(fila, 'precio_promedio', { min: 0 });
    // Sin cargas en el período no hay precio; con cargas, siempre (toda carga tiene litros > 0).
    if ((precioPromedio === null) !== (cargas === 0)) lector.falla('precio_promedio no coincide con las cargas');
    if (cargas > 0 && litros <= 0) lector.falla('cargas sin litros');

    const tramos = lector.entero(fila, 'tramos');
    const tramosKm = lector.numeroONulo(fila, 'tramos_km', { min: 0 });
    const tramosLitros = lector.numeroONulo(fila, 'tramos_litros', { min: 0 });
    const tramosMonto = lector.numeroONulo(fila, 'tramos_monto', { min: 0 });
    const kmPorLitro = lector.numeroONulo(fila, 'km_por_litro', { min: 0 });
    const litros100km = lector.numeroONulo(fila, 'litros_100km', { min: 0 });
    const costoPorKm = lector.numeroONulo(fila, 'costo_por_km', { min: 0 });
    // Con 0 tramos válidos, todo lo del rendimiento es NULL; con 1 o más, nada lo es.
    const delRendimiento = [tramosKm, tramosLitros, tramosMonto, kmPorLitro, litros100km, costoPorKm];
    if (tramos === 0 && delRendimiento.some((valor) => valor !== null)) lector.falla('rendimiento sin tramos');
    if (tramos > 0 && delRendimiento.some((valor) => valor === null)) lector.falla('tramos sin rendimiento');

    return {
      camionId,
      patente: lector.textoConValor(fila, 'patente'),
      activa: lector.booleano(fila, 'activa'),
      cargas,
      litros,
      monto: lector.numero(fila, 'monto', { min: 0 }),
      precioPromedio,
      llenasConOdometro: lector.entero(fila, 'llenas_con_odometro'),
      tramos,
      tramosKm,
      tramosLitros,
      tramosMonto,
      kmPorLitro,
      litros100km,
      costoPorKm,
      descartados: {
        retroceso: lector.entero(fila, 'descartados_retroceso'),
        sinAvance: lector.entero(fila, 'descartados_sin_avance'),
        fueraDeRango: lector.entero(fila, 'descartados_fuera_de_rango'),
      },
    };
  });
  lector.sinRepetidos(
    filas.map((fila) => fila.camionId),
    'camión',
  );
  return filas;
}

// ---------------------------------------------------------------------------
// resumen_viajes
// ---------------------------------------------------------------------------

export function parseResumenViajes(datos: unknown): ResumenViajes {
  const lector = new Lector('resumen_viajes');
  const filas = lector.filas(datos, MAX_FILAS_VIAJES);
  let total: number | null = null;

  const viajes = filas.map((fila): ViajeDelResumen => {
    const totalDeLaFila = lector.entero(fila, 'total_viajes', { min: 1 });
    if (total !== null && totalDeLaFila !== total) lector.falla('total_viajes distinto entre filas');
    total = totalDeLaFila;

    const camionId = lector.uuidONulo(fila, 'camion_id');
    // Sin camión, sin patente; con camión, su patente (el camión existe: la FK es RESTRICT).
    if (camionId === null) lector.nulo(fila, 'patente');
    const patente = camionId === null ? null : lector.textoConValor(fila, 'patente');
    const ingreso = lector.numeroONulo(fila, 'ingreso', { min: 0 });
    const ganancia = lector.numeroONulo(fila, 'ganancia');
    // ganancia NULL si y solo si el viaje no tiene ingreso (un ingreso 0 sí cuenta).
    if ((ganancia === null) !== (ingreso === null)) lector.falla('ganancia no coincide con el ingreso');
    return {
      viajeId: lector.uuid(fila, 'viaje_id'),
      fecha: lector.fecha(fila, 'fecha'),
      origen: lector.texto(fila, 'origen'),
      destino: lector.texto(fila, 'destino'),
      camionId,
      patente,
      km: lector.numeroONulo(fila, 'km', { min: 0 }),
      ingreso,
      gastosCantidad: lector.entero(fila, 'gastos_cantidad'),
      gastosMonto: lector.numero(fila, 'gastos_monto', { min: 0 }),
      ganancia,
    };
  });

  lector.sinRepetidos(
    viajes.map((viaje) => viaje.viajeId),
    'viaje',
  );
  const totalReal: number = total ?? 0;
  if (totalReal < viajes.length) lector.falla('total_viajes menor que las filas');
  return { viajes, total: totalReal, cortada: totalReal > viajes.length };
}

// ---------------------------------------------------------------------------
// resumen_gastos_varios
// ---------------------------------------------------------------------------

export function parseResumenGastosVarios(datos: unknown): ResumenGastosVarios {
  const lector = new Lector('resumen_gastos_varios');
  const filasCrudas = lector.filas(datos, MAX_FILAS_GASTOS_VARIOS);
  let totalCantidad: number | null = null;

  const filas = filasCrudas.map((fila): GastoVarioDelMes => {
    const totalDeLaFila = lector.entero(fila, 'total_cantidad', { min: 1 });
    if (totalCantidad !== null && totalDeLaFila !== totalCantidad) lector.falla('total_cantidad distinto entre filas');
    totalCantidad = totalDeLaFila;
    return {
      id: lector.uuid(fila, 'gasto_id'),
      fecha: lector.fecha(fila, 'fecha'),
      descripcion: lector.textoONulo(fila, 'descripcion'),
      truncada: lector.booleano(fila, 'descripcion_truncada'),
      monto: lector.numero(fila, 'monto', { min: 0 }),
    };
  });

  lector.sinRepetidos(
    filas.map((fila) => fila.id),
    'gasto',
  );
  const total: number = totalCantidad ?? 0;
  if (total < filas.length) lector.falla('total_cantidad menor que las filas');
  return { filas, totalCantidad: total };
}
