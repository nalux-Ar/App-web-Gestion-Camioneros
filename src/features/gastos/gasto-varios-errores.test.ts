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

// Dónde se muestra cada error y a cuál se lleva el foco: el PRIMER error en el orden en que se VEN los campos. El método de pago va ANTES
// de la fecha y de la nota y el viaje (con varias categorías, los métodos de pago de todos los bloques van juntos, después de todos los
// bloques), y la descripción de una categoría común es una nota que va en el pliegue «Agregar nota o viaje», DESPUÉS de la fecha; la de
// «Gastos varios» (obligatoria) sigue arriba. No siempre coincide con el «primero» que da la validación (`GASTO_FIELD_ORDER`, que no cambia).

/** El orden en pantalla con un solo bloque COMÚN (la nota va en el pliegue), escrito A MANO: si alguien lo mueve, esta prueba salta. */
const ORDEN_VISUAL_UNA: readonly GastoFormField[] = [
  'categoriaId',
  'monto',
  'camionId',
  'litros',
  'kmOdometro',
  'tanqueLleno',
  'metodoPago',
  'fecha',
  'descripcion',
  'viajeId',
];

/** El orden en pantalla con un solo bloque «Gastos varios» (su descripción es obligatoria y va arriba), escrito A MANO. */
const ORDEN_VISUAL_UNA_VARIOS: readonly GastoFormField[] = [
  'categoriaId',
  'descripcion',
  'monto',
  'camionId',
  'litros',
  'kmOdometro',
  'tanqueLleno',
  'metodoPago',
  'fecha',
  'viajeId',
];

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

/** «A:monto», «-:fecha»…: cada puesto con la inicial de su bloque (A, B, C) o «-» si no es de ningún bloque. */
function leer(puestos: ReadonlyArray<{ campo: string; clave: string | null }>): string[] {
  const C = 'c0000000-0000-4000-8000-000000000003';
  return puestos.map((puesto) => `${puesto.clave === null ? '-' : puesto.clave === A ? 'A' : puesto.clave === B ? 'B' : puesto.clave === C ? 'C' : '?'}:${puesto.campo}`);
}
const C = 'c0000000-0000-4000-8000-000000000003';

describe('camposEnOrdenVisual: un solo bloque', () => {
  it('común: categoría, monto, camión, litros, km, tanque, MÉTODO DE PAGO, fecha, DESCRIPCIÓN (nota) y viaje', () => {
    expect(camposEnOrdenVisual('una', [A]).map((puesto) => puesto.campo)).toEqual([...ORDEN_VISUAL_UNA]);
    expect(camposEnOrdenVisual('una', [A], []).map((puesto) => puesto.campo)).toEqual([...ORDEN_VISUAL_UNA]);
  });

  it('«Gastos varios»: la descripción queda arriba, justo debajo de la categoría y antes del monto', () => {
    expect(camposEnOrdenVisual('una', [A], [A]).map((puesto) => puesto.campo)).toEqual([...ORDEN_VISUAL_UNA_VARIOS]);
  });

  it('«Gastos varios» de OTRO bloque no cambia el orden de este (solo cuenta si la clave es la del bloque)', () => {
    expect(camposEnOrdenVisual('una', [A], [B]).map((puesto) => puesto.campo)).toEqual([...ORDEN_VISUAL_UNA]);
  });

  it('la nota (descripción común) va después de la fecha y antes del viaje; la de «Gastos varios» antes del monto', () => {
    const comun = camposEnOrdenVisual('una', [A]).map((puesto) => puesto.campo);
    expect(comun.indexOf('fecha')).toBeLessThan(comun.indexOf('descripcion'));
    expect(comun.indexOf('descripcion') + 1).toBe(comun.indexOf('viajeId'));
    const varios = camposEnOrdenVisual('una', [A], [A]).map((puesto) => puesto.campo);
    expect(varios.indexOf('descripcion')).toBe(varios.indexOf('categoriaId') + 1);
    expect(varios.indexOf('descripcion') + 1).toBe(varios.indexOf('monto'));
  });

  it('el método de pago va justo después del tanque y antes de la fecha, en los dos casos (la validación sigue con su orden)', () => {
    for (const varios of [[], [A]]) {
      const orden = camposEnOrdenVisual('una', [A], varios).map((puesto) => puesto.campo);
      expect(orden.indexOf('tanqueLleno') + 1).toBe(orden.indexOf('metodoPago'));
      expect(orden.indexOf('metodoPago') + 1).toBe(orden.indexOf('fecha'));
    }
    expect(GASTO_FIELD_ORDER.indexOf('metodoPago')).toBeGreaterThan(GASTO_FIELD_ORDER.indexOf('viajeId')); // el orden de la validación no se tocó
  });

  it('son los mismos campos que los de la validación, ni uno más ni uno menos (solo cambia el orden), común o «Gastos varios»', () => {
    for (const varios of [[], [A]]) {
      const visuales = camposEnOrdenVisual('una', [A], varios).map((puesto) => puesto.campo);
      expect(new Set(visuales).size).toBe(visuales.length);
      expect([...visuales].sort()).toEqual([...GASTO_FIELD_ORDER].sort());
    }
  });

  it('la categoría, la fecha y el viaje no son de ningún bloque; el resto sí', () => {
    for (const varios of [[], [A]]) {
      for (const puesto of camposEnOrdenVisual('una', [A], varios)) {
        const compartido = puesto.campo === 'categoriaId' || puesto.campo === 'fecha' || puesto.campo === 'viajeId';
        expect(puesto.clave).toBe(compartido ? null : A);
      }
    }
  });

  it('sin ninguna categoría marcada usa la clave vacía (el borrador), que es un bloque común', () => {
    expect(camposEnOrdenVisual('una', []).find((puesto) => puesto.campo === 'monto')!.clave).toBe('');
    expect(camposEnOrdenVisual('una', []).map((puesto) => puesto.campo)).toEqual([...ORDEN_VISUAL_UNA]);
  });
});

describe('camposEnOrdenVisual: varios bloques', () => {
  it('sin «Gastos varios»: la categoría, cada bloque (monto y combustible), los métodos de pago juntos, la fecha, las notas de cada bloque y AL FINAL el viaje', () => {
    expect(leer(camposEnOrdenVisual('varias', [A, B]))).toEqual([
      '-:categoriaId',
      'A:monto',
      'A:camionId',
      'A:litros',
      'A:kmOdometro',
      'A:tanqueLleno',
      'B:monto',
      'B:camionId',
      'B:litros',
      'B:kmOdometro',
      'B:tanqueLleno',
      'A:metodoPago',
      'B:metodoPago',
      '-:fecha',
      'A:descripcion',
      'B:descripcion',
      '-:viajeId',
    ]);
  });

  it('con «Gastos varios» en el primer bloque: su descripción abre su bloque (antes de su monto) y no está entre las notas del pliegue', () => {
    expect(leer(camposEnOrdenVisual('varias', [A, B], [A]))).toEqual([
      '-:categoriaId',
      'A:descripcion',
      'A:monto',
      'A:camionId',
      'A:litros',
      'A:kmOdometro',
      'A:tanqueLleno',
      'B:monto',
      'B:camionId',
      'B:litros',
      'B:kmOdometro',
      'B:tanqueLleno',
      'A:metodoPago',
      'B:metodoPago',
      '-:fecha',
      'B:descripcion',
      '-:viajeId',
    ]);
  });

  it('con «Gastos varios» en el segundo bloque: su descripción va arriba de SU monto (después de todo lo del primer bloque) y la nota del primero, en el pliegue', () => {
    expect(leer(camposEnOrdenVisual('varias', [A, B], [B]))).toEqual([
      '-:categoriaId',
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
      'A:metodoPago',
      'B:metodoPago',
      '-:fecha',
      'A:descripcion',
      '-:viajeId',
    ]);
  });

  it('con tres bloques y «Gastos varios» en el del medio: los tres métodos juntos, y las notas del primero y del tercero (en ese orden) entre la fecha y el viaje', () => {
    const orden = leer(camposEnOrdenVisual('varias', [A, B, C], [B]));
    expect(orden.slice(orden.indexOf('A:metodoPago'))).toEqual(['A:metodoPago', 'B:metodoPago', 'C:metodoPago', '-:fecha', 'A:descripcion', 'C:descripcion', '-:viajeId']);
    expect(orden.filter((puesto) => puesto.endsWith(':descripcion'))).toEqual(['B:descripcion', 'A:descripcion', 'C:descripcion']);
    expect(orden.indexOf('B:descripcion')).toBeLessThan(orden.indexOf('B:monto'));
  });

  it('si todos los bloques fueran «Gastos varios» no hay notas en el pliegue: después de la fecha solo queda el viaje', () => {
    const orden = leer(camposEnOrdenVisual('varias', [A, B], [A, B]));
    expect(orden.slice(-2)).toEqual(['-:fecha', '-:viajeId']);
    expect(orden.filter((puesto) => puesto.endsWith(':descripcion'))).toEqual(['A:descripcion', 'B:descripcion']);
  });

  it('una clave de «Gastos varios» que no es de ningún bloque a la vista se ignora', () => {
    expect(leer(camposEnOrdenVisual('varias', [A, B], ['otra']))).toEqual(leer(camposEnOrdenVisual('varias', [A, B])));
  });

  it('cada campo de cada bloque aparece UNA sola vez, con o sin «Gastos varios» (no se pierde ni se repite ninguno)', () => {
    for (const varios of [[], [A], [B], [A, B]]) {
      const orden = leer(camposEnOrdenVisual('varias', [A, B], varios));
      expect(new Set(orden).size, varios.join()).toBe(orden.length);
      expect(orden.filter((puesto) => puesto === 'A:descripcion' || puesto === 'B:descripcion')).toHaveLength(2);
      expect(orden.filter((puesto) => puesto.endsWith(':monto'))).toHaveLength(2);
      expect(orden.filter((puesto) => puesto.endsWith(':metodoPago'))).toHaveLength(2);
    }
  });

  it('los métodos de pago de todos los bloques van después de TODO lo de TODOS los bloques (también del tanque lleno) y antes de la fecha', () => {
    const orden = camposEnOrdenVisual('varias', [A, B], [A]);
    const primerMetodo = orden.findIndex((puesto) => puesto.campo === 'metodoPago');
    const ultimoDeBloque = orden.map((puesto) => puesto.clave !== null && puesto.campo !== 'metodoPago' && puesto.campo !== 'descripcion').lastIndexOf(true);
    expect(primerMetodo).toBeGreaterThan(ultimoDeBloque);
    expect(orden.findIndex((puesto) => puesto.campo === 'fecha')).toBeGreaterThan(orden.map((puesto) => puesto.campo).lastIndexOf('metodoPago'));
  });

  it('dentro de un bloque el orden de los campos de siempre (descripción solo en «Gastos varios», y siempre sin el método)', () => {
    const delBloque = camposEnOrdenVisual('varias', [A], [A]).filter((puesto) => puesto.clave === A && puesto.campo !== 'metodoPago');
    const esperado = GASTO_FIELD_ORDER.filter((campo: GastoFormField) => !['categoriaId', 'fecha', 'viajeId', 'metodoPago'].includes(campo));
    expect(delBloque.map((puesto) => puesto.campo)).toEqual(esperado);
  });
});

describe('primerErrorVisual', () => {
  it('sin errores no hay a dónde llevar el foco', () => {
    expect(primerErrorVisual(SIN_ERRORES, 'una', [A])).toBeNull();
    expect(primerErrorVisual(SIN_ERRORES, 'una', [A], [A])).toBeNull();
    expect(primerErrorVisual(SIN_ERRORES, 'varias', [A, B])).toBeNull();
    expect(primerErrorVisual(SIN_ERRORES, 'varias', [A, B], [A])).toBeNull();
  });

  it('con un solo bloque coincide con el primer campo con error del orden en pantalla, para cualquier combinación de 1 y 2 errores (común y «Gastos varios»)', () => {
    for (const [orden, varios] of [
      [ORDEN_VISUAL_UNA, []],
      [ORDEN_VISUAL_UNA_VARIOS, [A]],
    ] as const) {
      const campos: GastoFormField[] = [...orden];
      for (const uno of campos) {
        for (const otro of campos) {
          const errors = { [uno]: 'x', [otro]: 'y' };
          const esperado = campos.find((campo) => errors[campo] !== undefined);
          const puesto = primerErrorVisual(erroresDeUnGasto(A, errors), 'una', [A], varios);
          expect(puesto?.campo, `${uno} y ${otro} (${varios.length ? 'varios' : 'común'})`).toBe(esperado);
        }
      }
    }
  });

  it('con un solo bloque y TRES errores a la vez (monto, descripción, viaje, fecha, método): gana el primero en pantalla, común o «Gastos varios»', () => {
    const errores = erroresDeUnGasto(A, { monto: 'm', descripcion: 'd', viajeId: 'v', fecha: 'f', metodoPago: 'p' });
    expect(primerErrorVisual(errores, 'una', [A])).toEqual({ campo: 'monto', clave: A });
    expect(primerErrorVisual(errores, 'una', [A], [A])).toEqual({ campo: 'descripcion', clave: A });
    const sinMonto = erroresDeUnGasto(A, { descripcion: 'd', viajeId: 'v', fecha: 'f', metodoPago: 'p' });
    expect(primerErrorVisual(sinMonto, 'una', [A])).toEqual({ campo: 'metodoPago', clave: A });
    const sinMetodo = erroresDeUnGasto(A, { descripcion: 'd', viajeId: 'v', fecha: 'f' });
    expect(primerErrorVisual(sinMetodo, 'una', [A])).toEqual({ campo: 'fecha', clave: null });
    const sinFecha = erroresDeUnGasto(A, { descripcion: 'd', viajeId: 'v' });
    expect(primerErrorVisual(sinFecha, 'una', [A])).toEqual({ campo: 'descripcion', clave: A }); // la nota va antes que el viaje
    expect(primerErrorVisual(sinFecha, 'una', [A], [A])).toEqual({ campo: 'descripcion', clave: A }); // arriba, antes de todo
  });

  it('con un solo bloque: la nota (descripción común) pierde contra el método y la fecha, y gana contra el viaje; la de «Gastos varios» gana contra todo menos la categoría', () => {
    const conDescripcionYFecha = erroresDeUnGasto(A, { descripcion: 'd', fecha: 'f' });
    expect(primerErrorVisual(conDescripcionYFecha, 'una', [A])).toEqual({ campo: 'fecha', clave: null });
    expect(primerErrorVisual(conDescripcionYFecha, 'una', [A], [A])).toEqual({ campo: 'descripcion', clave: A });
    const conDescripcionYViaje = erroresDeUnGasto(A, { descripcion: 'd', viajeId: 'v' });
    expect(primerErrorVisual(conDescripcionYViaje, 'una', [A])).toEqual({ campo: 'descripcion', clave: A });
    const conCategoria = erroresDeUnGasto(A, { categoriaId: 'c', descripcion: 'd' });
    expect(primerErrorVisual(conCategoria, 'una', [A], [A])).toEqual({ campo: 'categoriaId', clave: null });
  });

  it('con un solo bloque: un error del método de pago gana sobre uno de la fecha o del viaje (se ve antes); y la fecha gana sobre el viaje', () => {
    expect(primerErrorVisual(erroresDeUnGasto(A, { metodoPago: 'p', fecha: 'f' }), 'una', [A])).toEqual({ campo: 'metodoPago', clave: A });
    expect(primerErrorVisual(erroresDeUnGasto(A, { metodoPago: 'p', viajeId: 'v' }), 'una', [A])).toEqual({ campo: 'metodoPago', clave: A });
    expect(primerErrorVisual(erroresDeUnGasto(A, { fecha: 'f', viajeId: 'v' }), 'una', [A])).toEqual({ campo: 'fecha', clave: null });
    expect(primerErrorVisual(erroresDeUnGasto(A, { tanqueLleno: 't', metodoPago: 'p' }), 'una', [A])).toEqual({ campo: 'tanqueLleno', clave: A });
  });

  it('con varios: un error de método de pago del PRIMER bloque va DESPUÉS de un error de monto del segundo (los métodos van después de todos los bloques)', () => {
    const errores: ErroresDeCarga = { compartidos: {}, bloques: { [A]: { metodoPago: 'p' }, [B]: { monto: 'm' } } };
    expect(primerErrorVisual(errores, 'varias', [A, B])).toEqual({ campo: 'monto', clave: B });
  });

  it('con varios: cualquier método de pago va antes que la fecha, la nota y el viaje, y después de todos los montos', () => {
    const conFecha: ErroresDeCarga = { compartidos: { fecha: 'f' }, bloques: { [B]: { metodoPago: 'p' } } };
    expect(primerErrorVisual(conFecha, 'varias', [A, B])).toEqual({ campo: 'metodoPago', clave: B });
    const conViaje: ErroresDeCarga = { compartidos: { viajeId: 'v' }, bloques: { [A]: { metodoPago: 'p' } } };
    expect(primerErrorVisual(conViaje, 'varias', [A, B])).toEqual({ campo: 'metodoPago', clave: A });
    const conNota: ErroresDeCarga = { compartidos: {}, bloques: { [A]: { descripcion: 'd' }, [B]: { metodoPago: 'p' } } };
    expect(primerErrorVisual(conNota, 'varias', [A, B])).toEqual({ campo: 'metodoPago', clave: B });
    const conMonto: ErroresDeCarga = { compartidos: { fecha: 'f' }, bloques: { [B]: { monto: 'm' } } };
    expect(primerErrorVisual(conMonto, 'varias', [A, B])).toEqual({ campo: 'monto', clave: B });
    const soloFecha: ErroresDeCarga = { compartidos: { fecha: 'f', viajeId: 'v' }, bloques: {} };
    expect(primerErrorVisual(soloFecha, 'varias', [A, B])).toEqual({ campo: 'fecha', clave: null });
  });

  it('con varios: la fecha va antes que las notas de los bloques, y las notas (en el orden de los bloques) antes que el viaje', () => {
    const fechaYNota: ErroresDeCarga = { compartidos: { fecha: 'f' }, bloques: { [B]: { descripcion: 'd' } } };
    expect(primerErrorVisual(fechaYNota, 'varias', [A, B])).toEqual({ campo: 'fecha', clave: null });
    const notaYViaje: ErroresDeCarga = { compartidos: { viajeId: 'v' }, bloques: { [B]: { descripcion: 'd' } } };
    expect(primerErrorVisual(notaYViaje, 'varias', [A, B])).toEqual({ campo: 'descripcion', clave: B });
    const dosNotas: ErroresDeCarga = { compartidos: {}, bloques: { [A]: { descripcion: 'd' }, [B]: { descripcion: 'd' } } };
    expect(primerErrorVisual(dosNotas, 'varias', [A, B])).toEqual({ campo: 'descripcion', clave: A });
    const notaYMonto: ErroresDeCarga = { compartidos: {}, bloques: { [A]: { descripcion: 'd' }, [B]: { monto: 'm' } } };
    expect(primerErrorVisual(notaYMonto, 'varias', [A, B])).toEqual({ campo: 'monto', clave: B });
  });

  it('con varios y «Gastos varios»: su descripción va ARRIBA (antes de su monto y de lo de los bloques siguientes); la de otro bloque, en el pliegue', () => {
    const descripcionDeVarios: ErroresDeCarga = { compartidos: {}, bloques: { [A]: { monto: 'm' }, [B]: { descripcion: 'd' } } };
    expect(primerErrorVisual(descripcionDeVarios, 'varias', [A, B], [B])).toEqual({ campo: 'monto', clave: A }); // el monto del primero se ve antes
    expect(primerErrorVisual(descripcionDeVarios, 'varias', [A, B])).toEqual({ campo: 'monto', clave: A });
    const mismoBloque: ErroresDeCarga = { compartidos: {}, bloques: { [B]: { descripcion: 'd', monto: 'm' } } };
    expect(primerErrorVisual(mismoBloque, 'varias', [A, B], [B])).toEqual({ campo: 'descripcion', clave: B }); // de «Gastos varios»: antes de su monto
    expect(primerErrorVisual(mismoBloque, 'varias', [A, B])).toEqual({ campo: 'monto', clave: B }); // común: la nota va después
    const conViajeYNota: ErroresDeCarga = { compartidos: { viajeId: 'v', fecha: 'f' }, bloques: { [A]: { descripcion: 'd' }, [B]: { descripcion: 'd' } } };
    expect(primerErrorVisual(conViajeYNota, 'varias', [A, B], [B])).toEqual({ campo: 'descripcion', clave: B }); // la de «Gastos varios», arriba de todo
    expect(primerErrorVisual(conViajeYNota, 'varias', [A, B], [A, B])).toEqual({ campo: 'descripcion', clave: A });
    expect(primerErrorVisual(conViajeYNota, 'varias', [A, B])).toEqual({ campo: 'fecha', clave: null }); // todas notas: primero la fecha
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
    expect(primerErrorVisual(errores, 'varias', [A, B], [A])).toEqual({ campo: 'categoriaId', clave: null });
  });
});
