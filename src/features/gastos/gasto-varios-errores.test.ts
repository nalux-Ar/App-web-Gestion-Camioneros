import { describe, expect, it } from 'vitest';

import { GASTO_FIELD_ORDER, type GastoFormField } from './gasto-form';
import type { LoteValidation } from './gasto-lote';
import {
  SIN_ERRORES,
  camposEnOrdenVisual,
  erroresDelLote,
  erroresDeUnGasto,
  hayErrores,
  primerErrorVisual,
  sinErrorCompartido,
  sinErrorDeCategoria,
  sinErrorDelBloque,
  sinErroresDeBloques,
  type ErroresDeCarga,
} from './gasto-varios-errores';

// Dónde se muestra cada error y a cuál se lleva el foco: el PRIMER error en el orden en que se VEN los campos (con varias categorías,
// los métodos de pago van al final de todo, así que no siempre coincide con el «primero» que da la validación del lote).

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';

describe('erroresDeUnGasto', () => {
  it('ubica cada error: la categoría en el grupo, la fecha y el viaje como compartidos y el resto en el bloque de esa clave', () => {
    const errores = erroresDeUnGasto(A, {
      categoriaId: 'Elige una categoría.',
      monto: 'monto mal',
      fecha: 'fecha mal',
      viajeId: 'viaje mal',
      metodoPago: 'método mal',
      litros: 'litros mal',
    });
    expect(errores.categoria).toBe('Elige una categoría.');
    expect(errores.compartidos).toEqual({ fecha: 'fecha mal', viajeId: 'viaje mal' });
    expect(errores.bloques).toEqual({ [A]: { monto: 'monto mal', metodoPago: 'método mal', litros: 'litros mal' } });
  });

  it('sin errores de bloque no crea un bloque vacío', () => {
    const errores = erroresDeUnGasto(A, { fecha: 'mal' });
    expect(errores.bloques).toEqual({});
    expect('categoria' in errores).toBe(false);
  });

  it('con la clave vacía (ninguna categoría marcada) los errores del bloque van al borrador', () => {
    expect(erroresDeUnGasto('', { monto: 'mal' }).bloques).toEqual({ '': { monto: 'mal' } });
  });
});

describe('erroresDelLote', () => {
  it('pasa los compartidos y los errores de cada bloque por su categoría', () => {
    const validacion: Extract<LoteValidation, { ok: false }> = {
      ok: false,
      compartidos: { fecha: 'fecha mal' },
      bloques: [
        { categoriaId: A, errors: { monto: 'monto mal' } },
        { categoriaId: B, errors: { metodoPago: 'método mal' } },
      ],
      primero: { categoriaId: A, field: 'monto' },
    };
    const errores = erroresDelLote(validacion);
    expect(errores.compartidos).toEqual({ fecha: 'fecha mal' });
    expect(errores.bloques).toEqual({ [A]: { monto: 'monto mal' }, [B]: { metodoPago: 'método mal' } });
    expect(errores.categoria).toBeUndefined();
  });
});

describe('sacar un error al corregirlo', () => {
  const base: ErroresDeCarga = {
    categoria: 'cat',
    compartidos: { fecha: 'f', viajeId: 'v' },
    bloques: { [A]: { monto: 'm', descripcion: 'd' }, [B]: { metodoPago: 'p' } },
  };

  it('del bloque: solo ese campo; si era el último, el bloque desaparece', () => {
    const sinMonto = sinErrorDelBloque(base, A, 'monto');
    expect(sinMonto.bloques[A]).toEqual({ descripcion: 'd' });
    expect(sinMonto.bloques[B]).toEqual({ metodoPago: 'p' });
    expect(sinErrorDelBloque(base, B, 'metodoPago').bloques).toEqual({ [A]: { monto: 'm', descripcion: 'd' } });
  });

  it('si no había error en ese campo devuelve el MISMO objeto (no se vuelve a dibujar nada)', () => {
    expect(sinErrorDelBloque(base, A, 'litros')).toBe(base);
    expect(sinErrorDelBloque(base, 'otra', 'monto')).toBe(base);
    expect(sinErrorDelBloque(base, '__proto__', 'monto')).toBe(base);
  });

  it('compartido: solo la fecha o solo el viaje', () => {
    expect(sinErrorCompartido(base, 'fecha').compartidos).toEqual({ viajeId: 'v' });
    expect(sinErrorCompartido(base, 'viajeId').compartidos).toEqual({ fecha: 'f' });
    expect(sinErrorCompartido(SIN_ERRORES, 'fecha')).toBe(SIN_ERRORES);
  });

  it('de la categoría', () => {
    expect('categoria' in sinErrorDeCategoria(base)).toBe(false);
    expect(sinErrorDeCategoria(SIN_ERRORES)).toBe(SIN_ERRORES);
  });

  it('de varios bloques a la vez (todos sus errores); lo de los demás queda', () => {
    const resto = sinErroresDeBloques(base, [A, 'no existe']);
    expect(resto.bloques).toEqual({ [B]: { metodoPago: 'p' } });
    expect(resto.compartidos).toEqual(base.compartidos);
    expect(sinErroresDeBloques(base, ['no existe'])).toBe(base);
  });

  it('no modifica el objeto original', () => {
    const copia = JSON.stringify(base);
    sinErrorDelBloque(base, A, 'monto');
    sinErrorCompartido(base, 'fecha');
    sinErrorDeCategoria(base);
    sinErroresDeBloques(base, [A]);
    expect(JSON.stringify(base)).toBe(copia);
  });
});

describe('hayErrores', () => {
  it('sin nada no hay; con uno en cualquier lugar, sí', () => {
    expect(hayErrores(SIN_ERRORES)).toBe(false);
    expect(hayErrores({ ...SIN_ERRORES, categoria: 'x' })).toBe(true);
    expect(hayErrores({ compartidos: { fecha: 'x' }, bloques: {} })).toBe(true);
    expect(hayErrores({ compartidos: {}, bloques: { [A]: { monto: 'x' } } })).toBe(true);
    expect(hayErrores({ compartidos: {}, bloques: { [A]: {} } })).toBe(false);
  });
});

describe('camposEnOrdenVisual', () => {
  it('con un solo bloque es EXACTAMENTE el orden de siempre (GASTO_FIELD_ORDER)', () => {
    expect(camposEnOrdenVisual('una', [A]).map((puesto) => puesto.campo)).toEqual([...GASTO_FIELD_ORDER]);
  });

  it('con un solo bloque la categoría, la fecha y el viaje no son de ningún bloque; el resto sí', () => {
    const puestos = camposEnOrdenVisual('una', [A]);
    for (const puesto of puestos) {
      const compartido = puesto.campo === 'categoriaId' || puesto.campo === 'fecha' || puesto.campo === 'viajeId';
      expect(puesto.clave).toBe(compartido ? null : A);
    }
  });

  it('sin ninguna categoría marcada usa la clave vacía (el borrador)', () => {
    expect(camposEnOrdenVisual('una', []).find((puesto) => puesto.campo === 'monto')!.clave).toBe('');
  });

  it('con varios: la categoría, cada bloque entero (en su orden), la fecha, el viaje y AL FINAL el método de pago de cada uno', () => {
    const orden = camposEnOrdenVisual('varias', [A, B]).map((puesto) => `${puesto.clave === null ? '-' : puesto.clave === A ? 'A' : 'B'}:${puesto.campo}`);
    expect(orden).toEqual([
      '-:categoriaId',
      'A:descripcion',
      'A:monto',
      'A:camionId',
      'A:litros',
      'A:kmOdometro',
      'A:tanqueLleno',
      'B:descripcion',
      'B:monto',
      'B:camionId',
      'B:litros',
      'B:kmOdometro',
      'B:tanqueLleno',
      '-:fecha',
      '-:viajeId',
      'A:metodoPago',
      'B:metodoPago',
    ]);
  });

  it('dentro de un bloque el orden de los campos es el de siempre (sin la categoría, la fecha, el viaje ni el método)', () => {
    const delBloque = camposEnOrdenVisual('varias', [A]).filter((puesto) => puesto.clave === A && puesto.campo !== 'metodoPago');
    const esperado = GASTO_FIELD_ORDER.filter((campo: GastoFormField) => !['categoriaId', 'fecha', 'viajeId', 'metodoPago'].includes(campo));
    expect(delBloque.map((puesto) => puesto.campo)).toEqual(esperado);
  });
});

describe('primerErrorVisual', () => {
  it('sin errores no hay a dónde llevar el foco', () => {
    expect(primerErrorVisual(SIN_ERRORES, 'una', [A])).toBeNull();
    expect(primerErrorVisual(SIN_ERRORES, 'varias', [A, B])).toBeNull();
  });

  it('con un solo bloque coincide con el primer campo con error del orden de siempre, para cualquier combinación de errores', () => {
    const campos: GastoFormField[] = [...GASTO_FIELD_ORDER];
    // todas las combinaciones de 1 y de 2 errores
    for (const uno of campos) {
      for (const otro of campos) {
        const errors = { [uno]: 'x', [otro]: 'y' };
        const esperado = campos.find((campo) => errors[campo] !== undefined);
        const puesto = primerErrorVisual(erroresDeUnGasto(A, errors), 'una', [A]);
        expect(puesto?.campo, `${uno} y ${otro}`).toBe(esperado);
      }
    }
  });

  it('con varios: un error de método de pago del PRIMER bloque va DESPUÉS de un error de monto del segundo (los métodos van al final)', () => {
    const errores: ErroresDeCarga = { compartidos: {}, bloques: { [A]: { metodoPago: 'p' }, [B]: { monto: 'm' } } };
    expect(primerErrorVisual(errores, 'varias', [A, B])).toEqual({ campo: 'monto', clave: B });
  });

  it('con varios: la fecha va antes que cualquier método de pago y después de todos los montos', () => {
    const conFecha: ErroresDeCarga = { compartidos: { fecha: 'f' }, bloques: { [B]: { metodoPago: 'p' } } };
    expect(primerErrorVisual(conFecha, 'varias', [A, B])).toEqual({ campo: 'fecha', clave: null });
    const conMonto: ErroresDeCarga = { compartidos: { fecha: 'f' }, bloques: { [B]: { monto: 'm' } } };
    expect(primerErrorVisual(conMonto, 'varias', [A, B])).toEqual({ campo: 'monto', clave: B });
  });

  it('con varios: entre los métodos de pago, el del primer bloque', () => {
    const errores: ErroresDeCarga = { compartidos: {}, bloques: { [A]: { metodoPago: 'p' }, [B]: { metodoPago: 'p' } } };
    expect(primerErrorVisual(errores, 'varias', [A, B])).toEqual({ campo: 'metodoPago', clave: A });
  });

  it('con varios: lo de un bloque que no está a la vista (otra clave) no cuenta', () => {
    const errores: ErroresDeCarga = { compartidos: {}, bloques: { otra: { monto: 'm' } } };
    expect(primerErrorVisual(errores, 'varias', [A, B])).toBeNull();
  });

  it('el error del grupo de categorías va primero de todos', () => {
    const errores: ErroresDeCarga = { categoria: 'c', compartidos: { fecha: 'f' }, bloques: { [A]: { monto: 'm' } } };
    expect(primerErrorVisual(errores, 'una', [A])).toEqual({ campo: 'categoriaId', clave: null });
  });
});
