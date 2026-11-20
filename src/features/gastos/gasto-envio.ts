import { generateClientRef } from './client-ref';

/**
 * Lo que «Nuevo gasto» recuerda de lo que YA mandó a la base mientras vive la pantalla: las claves de idempotencia (`client_ref`) de lo
 * que va a guardar y las huellas de todo lo mandado con esas claves (`sent`, ver `crearGasto` y `crearGastos`).
 *
 * Las dos cosas van SIEMPRE juntas. `sent` solo tiene sentido con las claves con las que se mandó: si se vaciara `sent` y se siguieran
 * usando las MISMAS claves, un lote nuevo chocaría con lo que ya se guardó (23505) y se leería como «ya estaban guardados» sin haber
 * guardado nada. Y al revés, claves nuevas con `sent` viejo harían creer que se mandó otra cosa. Por eso no hay forma de vaciar una sin
 * la otra: `reiniciarEnvio` devuelve un envío ENTERO nuevo (huellas vacías y claves nuevas) y quien lo guarda lo reemplaza de una vez.
 */
export interface EnvioDeLaCarga {
  /** Las huellas de todo lo ya mandado con las claves de abajo (aunque no se haya confirmado). Lo modifican `crearGasto` y `crearGastos`. */
  readonly sent: Set<string>;
  /** La clave del gasto cuando se guarda UNO solo (el camino de siempre). Fija mientras vive este envío. */
  readonly clave: string;
  /** La clave de cada categoría cuando se guardan varios: una por categoría, creada la primera vez que se pide y fija desde ahí. */
  readonly porCategoria: Map<string, string>;
}

/** Un envío nuevo: huellas vacías y claves nuevas (la del gasto único se crea ya; la de cada categoría, la primera vez que se pide). */
export function nuevoEnvio(generar: () => string = generateClientRef): EnvioDeLaCarga {
  return { sent: new Set<string>(), clave: generar(), porCategoria: new Map<string, string>() };
}

/** El reinicio, para después de guardar bien y para «Empezar de nuevo»: un envío ENTERO nuevo, nunca solo una de sus dos partes. */
export function reiniciarEnvio(generar: () => string = generateClientRef): EnvioDeLaCarga {
  return nuevoEnvio(generar);
}

/** La clave de esta categoría: siempre la misma dentro de un envío (los reintentos mandan lo mismo) y distinta de la de las demás. */
export function claveDeCategoria(envio: EnvioDeLaCarga, categoriaId: string, generar: () => string = generateClientRef): string {
  const existente = envio.porCategoria.get(categoriaId);
  if (existente !== undefined) return existente;
  const nueva = generar();
  envio.porCategoria.set(categoriaId, nueva);
  return nueva;
}
