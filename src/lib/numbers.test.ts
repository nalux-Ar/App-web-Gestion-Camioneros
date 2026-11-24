import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DINERO_NO_NUMERICO_MESSAGE,
  DINERO_VACIO_MESSAGE,
  EMPTY_VALUE,
  KM_NO_NUMERICO_MESSAGE,
  KM_VACIO_MESSAGE,
  LITROS_AMBIGUOUS_MESSAGE,
  LITROS_HINT,
  NUMBER_KINDS,
  SIGNO_MENOS,
  fromDbNumber,
  fromScaledInt,
  formatForInput,
  formatMoney,
  formatNumber,
  leePuntoComoMiles,
  maxValueFor,
  mensajeSoloNumeros,
  parseDecimal,
  parseDecimalText,
  roundToScale,
  textoSeLee,
  toDbNumber,
  toDbNumberOrNull,
  toScaledInt,
  validateOptionalNumber,
  validateRequiredNumber,
  type NumberKind,
} from './numbers';

/** El espacio que no corta línea y el signo menos tipográfico se normalizan para leer las pruebas. */
const NBSP = '\xa0';
const plano = (texto: string) => texto.replace(/\xa0/g, ' ').replace(/−/g, '-');

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Lectura de texto: la regla de los miles con punto (dinero y km)
// ---------------------------------------------------------------------------

type Lectura = { valor: number; decimales: number; digitosEnteros: number };

describe('parseDecimalText con `milesConPunto`: el punto es de MILES solo con la forma «12.500»', () => {
  const MILES = { milesConPunto: true } as const;

  // Texto → lo que se lee (en la forma de miles no hay decimales).
  const COMO_MILES: ReadonlyArray<readonly [string, Lectura]> = [
    ['12.500', { valor: 12500, decimales: 0, digitosEnteros: 5 }],
    ['1.234.567', { valor: 1234567, decimales: 0, digitosEnteros: 7 }],
    ['1.000', { valor: 1000, decimales: 0, digitosEnteros: 4 }],
    ['100.000', { valor: 100000, decimales: 0, digitosEnteros: 6 }],
    ['123.456', { valor: 123456, decimales: 0, digitosEnteros: 6 }],
    ['999.999', { valor: 999999, decimales: 0, digitosEnteros: 6 }],
    ['9.999.999.999', { valor: 9999999999, decimales: 0, digitosEnteros: 10 }],
    ['1.000.000', { valor: 1000000, decimales: 0, digitosEnteros: 7 }],
    ['12.000', { valor: 12000, decimales: 0, digitosEnteros: 5 }],
    ['1.001', { valor: 1001, decimales: 0, digitosEnteros: 4 }],
    ['452.310', { valor: 452310, decimales: 0, digitosEnteros: 6 }],
    [' 12.500 ', { valor: 12500, decimales: 0, digitosEnteros: 5 }], // los espacios de los extremos se ignoran
  ];

  it.each(COMO_MILES)('«%s» son miles', (texto, esperado) => {
    expect(parseDecimalText(texto, MILES)).toEqual({
      ok: true,
      value: esperado.valor,
      decimals: esperado.decimales,
      integerDigits: esperado.digitosEnteros,
    });
  });

  // Un solo punto que NO tiene la forma de miles: sigue siendo el decimal de siempre.
  const COMO_DECIMAL: ReadonlyArray<readonly [string, Lectura]> = [
    ['12.5', { valor: 12.5, decimales: 1, digitosEnteros: 2 }],
    ['12.50', { valor: 12.5, decimales: 2, digitosEnteros: 2 }],
    ['0.500', { valor: 0.5, decimales: 3, digitosEnteros: 0 }], // empieza en 0: no es un grupo de miles
    ['1234.567', { valor: 1234.567, decimales: 3, digitosEnteros: 4 }], // 4 dígitos antes del punto
    ['12.5000', { valor: 12.5, decimales: 4, digitosEnteros: 2 }], // grupo de 4 dígitos
    ['12.50000', { valor: 12.5, decimales: 5, digitosEnteros: 2 }],
    ['1.2', { valor: 1.2, decimales: 1, digitosEnteros: 1 }],
    ['0.5', { valor: 0.5, decimales: 1, digitosEnteros: 0 }],
    ['.5', { valor: 0.5, decimales: 1, digitosEnteros: 0 }],
    ['12.', { valor: 12, decimales: 0, digitosEnteros: 2 }],
    ['01.234', { valor: 1.234, decimales: 3, digitosEnteros: 1 }], // cero a la izquierda: no es de miles
    ['00.500', { valor: 0.5, decimales: 3, digitosEnteros: 0 }],
    ['1234567.123', { valor: 1234567.123, decimales: 3, digitosEnteros: 7 }],
    ['10.00', { valor: 10, decimales: 2, digitosEnteros: 2 }], // grupo de 2 dígitos
  ];

  it.each(COMO_DECIMAL)('«%s» sigue siendo decimal', (texto, esperado) => {
    expect(parseDecimalText(texto, MILES)).toEqual({
      ok: true,
      value: esperado.valor,
      decimals: esperado.decimales,
      integerDigits: esperado.digitosEnteros,
    });
  });

  // Varios puntos que NO cumplen la forma de miles: ambiguo (como hoy).
  it.each([
    '1.23.456', // un grupo de 2 dígitos en el medio
    '12.500.', // punto de más al final
    '12.500.5',
    '1.2.3',
    '1234.567.890', // grupo inicial de 4 dígitos
    '0.500.000', // grupo inicial que empieza en 0
    '12.50.000',
    '1.2345.678', // un grupo de 4
    '1..000',
    '.500.000',
    '1.000.00', // el último grupo con 2 dígitos
    '1.000.0000',
    '00.000.000',
    '01.234.567',
  ])('«%s» no se adivina: ambiguo', (texto) => {
    expect(parseDecimalText(texto, MILES)).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('SIN la opción, «12.500» es 12,5 y «1.234.567» es ambiguo (la lectura de siempre)', () => {
    expect(parseDecimalText('12.500')).toEqual({ ok: true, value: 12.5, decimals: 3, integerDigits: 2 });
    expect(parseDecimalText('1.234.567')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseDecimalText('12.500', { milesConPunto: false })).toEqual(parseDecimalText('12.500'));
    expect(parseDecimalText('1.234.567', {})).toEqual({ ok: false, reason: 'ambiguous' });
  });

  describe('con coma, todo igual que sin la opción', () => {
    const CON_COMA = [
      '12.500,50',
      '1.234.567,5',
      '12,500',
      '12,5',
      '1.234,56',
      '1,234.56', // al estilo inglés: la coma es de miles y el punto el decimal
      '1,234,567.5',
      '12.500,',
      ',5',
      '1,2,3',
      '1,2.5',
      '12.50,5',
      '1.2345,5',
      '1.234.5,6',
      '0.500,5',
      '12.500,50,1',
      '1,000',
      '1.000,000',
    ];
    it.each(CON_COMA)('«%s»', (texto) => {
      expect(parseDecimalText(texto, { milesConPunto: true })).toEqual(parseDecimalText(texto));
    });

    it('«12.500,50» es 12500,50 y «1,234.56» es 1234,56', () => {
      expect(parseDecimalText('12.500,50', MILES)).toEqual({ ok: true, value: 12500.5, decimals: 2, integerDigits: 5 });
      expect(parseDecimalText('1.234.567,5', MILES)).toEqual({ ok: true, value: 1234567.5, decimals: 1, integerDigits: 7 });
      expect(parseDecimalText('1,234.56', MILES)).toEqual({ ok: true, value: 1234.56, decimals: 2, integerDigits: 4 });
    });
  });

  describe('negativos, vacíos, espacios y texto que no es número', () => {
    it('un «-» delante avisa «negativo» también con la forma de miles', () => {
      expect(parseDecimalText('-12.500', MILES)).toEqual({ ok: false, reason: 'negative' });
      expect(parseDecimalText('-12.5', MILES)).toEqual({ ok: false, reason: 'negative' });
      expect(parseDecimalText('-1.234.567', MILES)).toEqual({ ok: false, reason: 'negative' });
      expect(parseDecimalText('-12,5', MILES)).toEqual({ ok: false, reason: 'negative' });
      expect(parseDecimalText('-1.23.456', MILES)).toEqual({ ok: false, reason: 'ambiguous' }); // lo malo se dice primero
      expect(parseDecimalText('-', MILES)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('vacío o en blanco', () => {
      expect(parseDecimalText('', MILES)).toEqual({ ok: false, reason: 'empty' });
      expect(parseDecimalText('   ', MILES)).toEqual({ ok: false, reason: 'empty' });
    });

    it.each(['12 500', '12. 500', '1 2.500', 'abc', '$12.500', '12.500e3', '12.500 km', '+12.500', '12.5.00a', '.', ',', '..'])(
      '«%s» no es un número',
      (texto) => {
        const lectura = parseDecimalText(texto, MILES);
        expect(lectura.ok).toBe(false);
        if (!lectura.ok) expect(['invalid', 'ambiguous']).toContain(lectura.reason);
      },
    );

    it('los espacios del medio y los signos son «invalid» (no se adivinan)', () => {
      expect(parseDecimalText('12 500', MILES)).toEqual({ ok: false, reason: 'invalid' });
      expect(parseDecimalText('+12.500', MILES)).toEqual({ ok: false, reason: 'invalid' });
      expect(parseDecimalText('12.500e3', MILES)).toEqual({ ok: false, reason: 'invalid' });
    });
  });

  it('un número larguísimo no rompe: el valor puede ser Infinity pero se informa por los dígitos', () => {
    const enorme = `1${'.000'.repeat(110)}`; // 331 dígitos
    const lectura = parseDecimalText(enorme, MILES);
    expect(lectura.ok).toBe(true);
    if (lectura.ok) {
      expect(lectura.value).toBe(Infinity);
      expect(lectura.integerDigits).toBe(331);
    }
    expect(parseDecimal(enorme)).toBeNull(); // la versión simple lo descarta
  });

  it('el tiempo de lectura de un texto larguísimo con muchos puntos es lineal (sin retroceso)', () => {
    const t0 = performance.now();
    parseDecimalText(`1${'.000'.repeat(20000)}x`, MILES);
    parseDecimalText(`1${'.000'.repeat(20000)}.`, MILES);
    parseDecimalText('1.'.repeat(20000), MILES);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('parseDecimal (la versión simple) no cambió', () => {
  it('sin miles: «12.500» es 12,5; ambiguos y negativos dan null', () => {
    expect(parseDecimal('12.500')).toBe(12.5);
    expect(parseDecimal('1.234,56')).toBe(1234.56);
    expect(parseDecimal('1.234.567')).toBeNull();
    expect(parseDecimal('-5')).toBeNull();
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });
});

describe('leePuntoComoMiles: en qué columnas', () => {
  it('dinero y km sí; litros y precioLitro no', () => {
    expect(leePuntoComoMiles('dinero')).toBe(true);
    expect(leePuntoComoMiles('km')).toBe(true);
    expect(leePuntoComoMiles('litros')).toBe(false);
    expect(leePuntoComoMiles('precioLitro')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validación con límites de columna
// ---------------------------------------------------------------------------

describe('validateRequiredNumber: dinero (numeric(12,2))', () => {
  const ok = (texto: string, valor: number, reglas = {}) =>
    expect(validateRequiredNumber(texto, 'dinero', reglas)).toEqual({ ok: true, value: valor });
  const mal = (texto: string, mensaje: string, reglas = {}) =>
    expect(validateRequiredNumber(texto, 'dinero', reglas)).toEqual({ ok: false, message: mensaje });

  it('el punto de miles se lee como miles', () => {
    ok('12.500', 12500);
    ok('1.234.567', 1234567);
    ok('1.000', 1000);
    ok('123.456', 123456);
    ok('12.505', 12505);
  });

  it('con coma, como siempre', () => {
    ok('12.500,50', 12500.5);
    ok('12500,50', 12500.5);
    ok('12500', 12500);
    ok('12,5', 12.5);
    ok('1.234.567,89', 1234567.89);
    ok('1,234.56', 1234.56);
  });

  it('un punto que no es de miles es el decimal: hasta 2 decimales', () => {
    ok('12.5', 12.5);
    ok('12.50', 12.5);
    ok('0.5', 0.5);
    mal('0.500', 'Usa hasta 2 decimales.');
    mal('1234.567', 'Usa hasta 2 decimales.');
    mal('12,505', 'Usa hasta 2 decimales.');
    mal('12.5000', 'Usa hasta 2 decimales.');
  });

  it('cero a la izquierda: «01.500» no es de miles', () => {
    mal('01.500', 'Usa hasta 2 decimales.');
    ok('007', 7);
    ok('012500', 12500);
  });

  it('varios puntos que no son miles: ambiguo', () => {
    const ambiguo = 'Revisa el número: usa una sola coma o un solo punto para los decimales.';
    mal('1.23.456', ambiguo);
    mal('1.2.3', ambiguo);
    mal('12.500.', ambiguo);
    mal('1,2,3', ambiguo);
  });

  it('el tope de 10 dígitos enteros, con y sin miles', () => {
    ok('9.999.999.999', 9999999999);
    ok('9999999999', 9999999999);
    ok('9999999999,99', 9999999999.99);
    ok('9.999.999.999,99', 9999999999.99);
    const grande = 'El número es demasiado grande. El máximo es $\xa09.999.999.999,99.';
    mal('10.000.000.000', grande);
    mal('10000000000', grande);
    mal('12.345.678.901', grande);
    mal('99.999.999.999,99', grande);
    mal('9999999999,999', 'Usa hasta 2 decimales.'); // los decimales se miran primero
  });

  it('un número enorme da «demasiado grande», nunca Infinity ni NaN', () => {
    const enorme = `1${'.000'.repeat(110)}`;
    const r = validateRequiredNumber(enorme, 'dinero');
    expect(r).toEqual({ ok: false, message: 'El número es demasiado grande. El máximo es $\xa09.999.999.999,99.' });
    expect(validateRequiredNumber('9'.repeat(400), 'dinero').ok).toBe(false);
  });

  it('cero y negativos', () => {
    mal('0', 'El número tiene que ser mayor que 0.');
    mal('0,00', 'El número tiene que ser mayor que 0.');
    ok('0', 0, { allowZero: true });
    ok('0,00', 0, { allowZero: true });
    mal('-12.500', 'El número no puede ser negativo.');
    mal('-0', 'El número no puede ser negativo.');
  });

  it('vacío y texto que no es número: mensajes propios del dinero', () => {
    mal('', DINERO_VACIO_MESSAGE);
    mal('   ', DINERO_VACIO_MESSAGE);
    mal('abc', DINERO_NO_NUMERICO_MESSAGE);
    mal('.', DINERO_NO_NUMERICO_MESSAGE);
    mal('$12.500', DINERO_NO_NUMERICO_MESSAGE);
    mal('12 500', DINERO_NO_NUMERICO_MESSAGE);
    mal('+5', DINERO_NO_NUMERICO_MESSAGE);
    expect(DINERO_VACIO_MESSAGE).toBe('Escribe el monto.');
    expect(DINERO_NO_NUMERICO_MESSAGE).toBe('Escribe solo números. Ej.: 12500 o 12500,50.');
  });
});

describe('validateRequiredNumber: kilómetros (numeric(9,1))', () => {
  const ok = (texto: string, valor: number) => expect(validateRequiredNumber(texto, 'km', { allowZero: true })).toEqual({ ok: true, value: valor });
  const mal = (texto: string, mensaje: string) =>
    expect(validateRequiredNumber(texto, 'km', { allowZero: true })).toEqual({ ok: false, message: mensaje });

  it('«452.310» son 452310 km (antes: «Usa hasta 1 decimal»)', () => {
    ok('452.310', 452310);
    ok('45.230', 45230);
    ok('1.234.567', 1234567);
    ok('452.310,5', 452310.5);
    ok('452310,5', 452310.5);
  });

  it('un punto que no es de miles es el decimal: hasta 1 decimal', () => {
    ok('45.5', 45.5);
    ok('0.5', 0.5);
    mal('45.55', 'Usa hasta 1 decimal.');
    mal('0.500', 'Usa hasta 1 decimal.');
    mal('1234.567', 'Usa hasta 1 decimal.');
    mal('45,55', 'Usa hasta 1 decimal.');
  });

  it('el tope de 8 dígitos enteros, con y sin miles', () => {
    ok('99.999.999', 99999999);
    ok('99999999,9', 99999999.9);
    ok('99.999.999,9', 99999999.9);
    const grande = 'El número es demasiado grande. El máximo es 99.999.999,9.';
    mal('100.000.000', grande);
    mal('100000000', grande);
    mal('123.456.789', grande);
  });

  it('cero, vacío y texto que no es número: mensajes propios de los km', () => {
    ok('0', 0);
    expect(validateRequiredNumber('0', 'km')).toEqual({ ok: false, message: 'El número tiene que ser mayor que 0.' });
    mal('', KM_VACIO_MESSAGE);
    mal('abc', KM_NO_NUMERICO_MESSAGE);
    mal('45 230', KM_NO_NUMERICO_MESSAGE);
    expect(KM_VACIO_MESSAGE).toBe('Escribe los kilómetros.');
    expect(KM_NO_NUMERICO_MESSAGE).toBe('Escribe solo números. Ej.: 45230.');
    mal('-45.230', 'El número no puede ser negativo.');
  });
});

describe('validateRequiredNumber: litros NO cambia (numeric(9,3))', () => {
  const ok = (texto: string, valor: number) => expect(validateRequiredNumber(texto, 'litros')).toEqual({ ok: true, value: valor });
  const mal = (texto: string, mensaje: string) => expect(validateRequiredNumber(texto, 'litros')).toEqual({ ok: false, message: mensaje });

  it('«1.200» y «40.500» siguen rechazados como ambiguos, con el mensaje de siempre', () => {
    mal('1.200', LITROS_AMBIGUOUS_MESSAGE);
    mal('40.500', LITROS_AMBIGUOUS_MESSAGE);
    mal(' 1.200 ', LITROS_AMBIGUOUS_MESSAGE);
    mal('123.456', LITROS_AMBIGUOUS_MESSAGE); // 3 dígitos antes del punto
    mal('999.999', LITROS_AMBIGUOUS_MESSAGE);
    mal('0.500', LITROS_AMBIGUOUS_MESSAGE); // también «0.500»: tiene la forma de «1.200» (como siempre)
    expect(LITROS_AMBIGUOUS_MESSAGE).toBe('Escribe los litros con coma para los decimales (ej. 40,5) o sin separador de miles (ej. 1200).');
    expect(LITROS_HINT).toBe('Ej.: 40,5. No uses puntos.');
  });

  it('«1.234.567» y «12.345.678» siguen siendo ambiguos (varios puntos), no miles', () => {
    const ambiguo = 'Revisa el número: usa una sola coma o un solo punto para los decimales.';
    mal('1.234.567', ambiguo);
    mal('12.345.678', ambiguo);
    mal('1.000.000', ambiguo);
  });

  it('el punto sigue siendo decimal cuando no tiene 3 dígitos; la coma, siempre decimal', () => {
    ok('40.5', 40.5);
    ok('40,5', 40.5);
    ok('40,125', 40.125);
    ok('1200', 1200);
    ok('1.200,5', 1200.5);
    ok('999.999,999', 999999.999);
  });

  it('decimales, tope y mensajes propios', () => {
    mal('1,2345', 'Usa hasta 3 decimales.');
    mal('1234567', 'El número es demasiado grande. El máximo es 999.999,999.');
    mal('', 'Escribe un número.');
    mal('abc', 'Escribe solo números, con coma o punto para los decimales.');
    mal('0', 'El número tiene que ser mayor que 0.');
    mal('-5', 'El número no puede ser negativo.');
  });
});

describe('validateRequiredNumber: precioLitro (no se tipea) sigue como antes', () => {
  it('«12.500» es el decimal 12,5: falla por decimales', () => {
    expect(validateRequiredNumber('12.500', 'precioLitro')).toEqual({ ok: false, message: 'Usa hasta 2 decimales.' });
    expect(validateRequiredNumber('', 'precioLitro')).toEqual({ ok: false, message: 'Escribe un número.' });
    expect(validateRequiredNumber('x', 'precioLitro')).toEqual({
      ok: false,
      message: 'Escribe solo números, con coma o punto para los decimales.',
    });
    expect(validateRequiredNumber('100000000', 'precioLitro')).toEqual({
      ok: false,
      message: 'El número es demasiado grande. El máximo es $\xa099.999.999,99.',
    });
  });
});

describe('validateOptionalNumber', () => {
  it('vacío es válido y da null; lo escrito se valida con las reglas de su columna', () => {
    expect(validateOptionalNumber('', 'dinero')).toEqual({ ok: true, value: null });
    expect(validateOptionalNumber('   ', 'km')).toEqual({ ok: true, value: null });
    expect(validateOptionalNumber('12.500', 'dinero', { allowZero: true })).toEqual({ ok: true, value: 12500 });
    expect(validateOptionalNumber('452.310', 'km', { allowZero: true })).toEqual({ ok: true, value: 452310 });
    expect(validateOptionalNumber('abc', 'km')).toEqual({ ok: false, message: KM_NO_NUMERICO_MESSAGE });
    expect(validateOptionalNumber('1.200', 'litros')).toEqual({ ok: false, message: LITROS_AMBIGUOUS_MESSAGE });
  });
});

describe('lo leído con miles sigue funcionando con la conversión a la columna', () => {
  it('toDbNumber, toDbNumberOrNull y roundToScale con valores leídos de «12.500»', () => {
    const dinero = validateRequiredNumber('12.500', 'dinero');
    const km = validateRequiredNumber('452.310', 'km');
    expect(dinero.ok && toDbNumber(dinero.value, 'dinero')).toBe(12500);
    expect(km.ok && toDbNumber(km.value, 'km')).toBe(452310);
    expect(toDbNumberOrNull(dinero.ok ? dinero.value : null, 'dinero')).toBe(12500);
    expect(roundToScale(12500, 'dinero')).toBe(12500);
    expect(toDbNumber(9999999999.99, 'dinero')).toBe(9999999999.99);
    expect(maxValueFor('dinero')).toBe(9999999999.99);
    expect(maxValueFor('km')).toBe(99999999.9);
  });

  it('toDbNumber falla fuerte con Infinity, NaN o un valor que no entra', () => {
    expect(() => toDbNumber(Infinity, 'dinero')).toThrow(RangeError);
    expect(() => toDbNumber(NaN, 'dinero')).toThrow(RangeError);
    expect(() => toDbNumber(1e10, 'dinero')).toThrow(RangeError);
    expect(() => toDbNumber(1e8, 'km')).toThrow(RangeError);
  });

  it('el centavo y los enteros escalados (para sumar) no se mueven', () => {
    expect(toScaledInt(12500.5, 'dinero')).toBe(1250050);
    expect(fromScaledInt(1250050, 'dinero')).toBe(12500.5);
    expect(toScaledInt(452310.5, 'km')).toBe(4523105);
    expect(fromDbNumber('12500.50')).toBe(12500.5);
    expect(fromDbNumber(null)).toBeNull();
  });

  /** Generador pseudoaleatorio con semilla (mulberry32): la misma tanda de textos en cada corrida. */
  function generador(semilla: number): () => number {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Lo que muestra «Se lee» → el número que dice (sin «$», sin «km», con coma decimal y punto de miles). */
  function numeroDeLaLinea(linea: string, kind: 'dinero' | 'km'): number {
    const cuerpo = plano(linea).replace(/^Se lee: /, '').replace(kind === 'dinero' ? /^-?\$ / : / km$/, '');
    return Number(cuerpo.replace(/\./g, '').replace(',', '.'));
  }

  it('PROPIEDAD: si el texto es válido, lo que dice «Se lee» es EXACTAMENTE lo que se guarda; si no, no hay línea', () => {
    const azar = generador(20261120);
    const alfabeto = '0123456789012345678901234567890123456789..,,,--  ';
    let validos = 0;
    let conMiles = 0;
    for (const kind of ['dinero', 'km'] as const) {
      for (const allowZero of [false, true]) {
        for (let i = 0; i < 8000; i += 1) {
          const largo = Math.floor(azar() * 17);
          let texto = '';
          for (let j = 0; j < largo; j += 1) texto += alfabeto[Math.floor(azar() * alfabeto.length)];
          const lectura = validateRequiredNumber(texto, kind, { allowZero });
          const linea = textoSeLee(texto, kind, { allowZero });
          if (!lectura.ok) {
            expect(linea, `«${texto}» (${kind}) no se lee bien: no hay línea`).toBeNull();
            continue;
          }
          validos += 1;
          if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(texto.trim())) conMiles += 1;
          // El valor leído es finito, no negativo y entra en la columna (toDbNumber no lanza).
          expect(Number.isFinite(lectura.value), texto).toBe(true);
          expect(lectura.value, texto).toBeGreaterThanOrEqual(0);
          const guardado = toDbNumber(lectura.value, kind);
          expect(Number.isFinite(guardado), texto).toBe(true);
          expect(guardado, texto).toBeLessThanOrEqual(maxValueFor(kind));
          expect(linea, `«${texto}» (${kind}) se lee bien: hay línea`).not.toBeNull();
          expect(numeroDeLaLinea(linea!, kind), `«${texto}» (${kind})`).toBe(guardado);
        }
      }
    }
    // La tanda es de verdad útil: hubo muchos textos válidos y varios con miles.
    expect(validos).toBeGreaterThan(2000);
    expect(conMiles).toBeGreaterThan(50);
  });

  it('PROPIEDAD: lo que se precarga al editar (formatForInput) vuelve a leerse como el mismo valor', () => {
    const azar = generador(7);
    for (const kind of ['dinero', 'km'] as const) {
      const { scale } = NUMBER_KINDS[kind];
      for (let i = 0; i < 3000; i += 1) {
        const enteros = Math.floor(azar() * 10 ** (1 + Math.floor(azar() * 7)));
        const decimales = Math.floor(azar() * 10 ** scale) / 10 ** scale;
        const valor = Number((enteros + decimales).toFixed(scale));
        if (valor === 0) continue;
        const texto = formatForInput(valor);
        expect(texto).not.toContain('.');
        expect(validateRequiredNumber(texto, kind), `${valor} → «${texto}»`).toEqual({ ok: true, value: valor });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// La línea «Se lee: …»
// ---------------------------------------------------------------------------

describe('textoSeLee', () => {
  it('dinero: «Se lee: $ 12.500» y con centavos si los hay', () => {
    expect(plano(textoSeLee('12500', 'dinero')!)).toBe('Se lee: $ 12.500');
    expect(plano(textoSeLee('12.500', 'dinero')!)).toBe('Se lee: $ 12.500');
    expect(plano(textoSeLee('12500,5', 'dinero')!)).toBe('Se lee: $ 12.500,50');
    expect(plano(textoSeLee('12.500,50', 'dinero')!)).toBe('Se lee: $ 12.500,50');
    expect(plano(textoSeLee('12,5', 'dinero')!)).toBe('Se lee: $ 12,50');
    expect(plano(textoSeLee('12.5', 'dinero')!)).toBe('Se lee: $ 12,50');
    expect(plano(textoSeLee('1.234.567', 'dinero')!)).toBe('Se lee: $ 1.234.567');
    expect(plano(textoSeLee('1234', 'dinero')!)).toBe('Se lee: $ 1.234'); // 4 dígitos también llevan punto
    expect(plano(textoSeLee('9999999999,99', 'dinero')!)).toBe('Se lee: $ 9.999.999.999,99');
    expect(plano(textoSeLee('0,05', 'dinero')!)).toBe('Se lee: $ 0,05');
  });

  it('km: «Se lee: 452.310 km», sin «$» y con el decimal solo si lo hay', () => {
    expect(textoSeLee('452.310', 'km')).toBe('Se lee: 452.310 km');
    expect(textoSeLee('452310', 'km')).toBe('Se lee: 452.310 km');
    expect(textoSeLee('452310,5', 'km')).toBe('Se lee: 452.310,5 km');
    expect(textoSeLee('452.310,5', 'km')).toBe('Se lee: 452.310,5 km');
    expect(textoSeLee('45230', 'km')).toBe('Se lee: 45.230 km');
    expect(textoSeLee('45,0', 'km')).toBe('Se lee: 45 km');
    expect(textoSeLee('99.999.999,9', 'km')).toBe('Se lee: 99.999.999,9 km');
    expect(textoSeLee('452310,5', 'km')).not.toContain('$');
  });

  it('el espacio entre el «$» y la cifra no corta línea', () => {
    expect(textoSeLee('12500', 'dinero')).toBe(`Se lee: $${NBSP}12.500`);
  });

  it('sin línea: vacío, en blanco o que no se lee bien (ahí manda el mensaje de error)', () => {
    for (const texto of ['', '   ', 'abc', '.', ',', '12,505', '12.5000', '0.500', '1.23.456', '-5', '-12.500', '10000000000', '10.000.000.000', '1,2,3']) {
      expect(textoSeLee(texto, 'dinero'), texto).toBeNull();
    }
    for (const texto of ['', 'abc', '45,55', '100.000.000', '100000000', '-1', '1.23.456']) {
      expect(textoSeLee(texto, 'km'), texto).toBeNull();
    }
  });

  it('el cero solo se lee donde se admite 0', () => {
    expect(textoSeLee('0', 'dinero')).toBeNull();
    expect(plano(textoSeLee('0', 'dinero', { allowZero: true })!)).toBe('Se lee: $ 0');
    expect(textoSeLee('0', 'km')).toBeNull();
    expect(textoSeLee('0', 'km', { allowZero: true })).toBe('Se lee: 0 km');
    expect(textoSeLee('0,0', 'km', { allowZero: true })).toBe('Se lee: 0 km');
    expect(textoSeLee('0,00', 'km', { allowZero: true })).toBeNull(); // 2 decimales: los km admiten 1
  });

  it('litros y precio por litro no tienen línea', () => {
    expect(textoSeLee('40,5', 'litros')).toBeNull();
    expect(textoSeLee('1200', 'litros')).toBeNull();
    expect(textoSeLee('1.200', 'litros')).toBeNull();
    expect(textoSeLee('23,5', 'precioLitro')).toBeNull();
  });

  it('no depende del idioma del teléfono', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    expect(plano(textoSeLee('12500,5', 'dinero')!)).toBe('Se lee: $ 12.500,50');
    expect(textoSeLee('452310,5', 'km')).toBe('Se lee: 452.310,5 km');
  });
});

// ---------------------------------------------------------------------------
// Formato para mostrar: siempre es-AR
// ---------------------------------------------------------------------------

describe('formatNumber (D3): siempre es-AR, sin símbolo ni unidad', () => {
  it('punto de miles y coma decimal', () => {
    expect(formatNumber(1234.5, { decimales: 2 })).toBe('1.234,50');
    expect(formatNumber(1234.5)).toBe('1.234,5');
    expect(formatNumber(1234567.891)).toBe('1.234.567,891');
    expect(formatNumber(0.5, { decimales: 2 })).toBe('0,50');
    expect(formatNumber(40.125, { decimales: 3, fijos: false })).toBe('40,125');
    expect(formatNumber(40, { decimales: 3, fijos: false })).toBe('40');
    expect(formatNumber(900, { decimales: 1, fijos: false })).toBe('900');
    expect(formatNumber(33.333, { decimales: 1 })).toBe('33,3');
  });

  it('agrupa también los números de 4 dígitos', () => {
    expect(formatNumber(1234)).toBe('1.234');
    expect(formatNumber(1234, { decimales: 0 })).toBe('1.234');
    expect(formatNumber(9999.5, { decimales: 2 })).toBe('9.999,50');
    expect(formatNumber(1000)).toBe('1.000');
    expect(formatNumber(999)).toBe('999');
  });

  it('un cero nunca lleva signo', () => {
    expect(formatNumber(-0, { decimales: 2 })).toBe('0,00');
    expect(formatNumber(-0.001, { decimales: 2 })).toBe('0,00');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-1234.5, { decimales: 2 })).toBe('-1.234,50');
  });

  it('sin valor o no finito: «—»', () => {
    expect(EMPTY_VALUE).toBe('—');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(Infinity)).toBe('—');
    expect(formatNumber(-Infinity)).toBe('—');
  });

  it('dígitos 0-9 aunque el idioma del teléfono use otros', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ar-EG');
    expect(formatNumber(1234.5, { decimales: 2 })).toBe('1.234,50');
    expect(formatNumber(1234.5, { decimales: 2 })).toMatch(/^[0-9.,]+$/);
  });

  it('el entorno tiene los datos de es-AR (si no, el formato caería en otro idioma sin avisar)', () => {
    expect(Intl.NumberFormat.supportedLocalesOf('es-AR')).toEqual(['es-AR']);
    expect(new Intl.NumberFormat('es-AR').format(1234.5)).toBe('1.234,5');
  });

  const IDIOMAS = ['en-US', 'en-GB', 'es-MX', 'es-US', 'es-419', 'es-ES', 'es-AR', 'es', 'de-DE', 'fr-FR', 'pt-BR', 'ar-EG', 'hi-IN', 'es-u-nu-arab', ''];

  it.each(IDIOMAS)('el resultado es el mismo con el teléfono en «%s»', (idioma) => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(idioma);
    expect(formatNumber(1234.5, { decimales: 2 })).toBe('1.234,50');
    expect(formatNumber(1234)).toBe('1.234');
    expect(formatNumber(1234567.5, { decimales: 1, fijos: false })).toBe('1.234.567,5');
    expect(formatNumber(0.5)).toBe('0,5');
    expect(formatMoney(1234.5)).toBe(`$${NBSP}1.234,50`);
    expect(formatMoney(12500)).toBe(`$${NBSP}12.500`);
    expect(formatForInput(1234.5)).toBe('1234,5');
  });

  it('cambiar el idioma DESPUÉS de haber formateado no cambia el formato (el cache no depende del idioma)', () => {
    const idioma = vi.spyOn(navigator, 'language', 'get');
    idioma.mockReturnValue('en-US');
    const primero = formatNumber(1234.5, { decimales: 2 });
    idioma.mockReturnValue('es-MX');
    const segundo = formatNumber(1234.5, { decimales: 2 });
    idioma.mockReturnValue('es-ES');
    const tercero = formatNumber(1234.5, { decimales: 2 });
    expect([primero, segundo, tercero]).toEqual(['1.234,50', '1.234,50', '1.234,50']);
  });

  it('el lector de texto sigue aceptando las dos formas al ESCRIBIR (también con el teléfono en inglés)', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    expect(parseDecimal('1.234,50')).toBe(1234.5);
    expect(parseDecimal('1,234.50')).toBe(1234.5);
    expect(validateRequiredNumber('1,234.50', 'dinero')).toEqual({ ok: true, value: 1234.5 });
    expect(validateRequiredNumber('1.234,50', 'dinero')).toEqual({ ok: true, value: 1234.5 });
  });
});

describe('formatMoney (D2): siempre con «$»', () => {
  it('un monto entero va sin centavos y uno con centavos lleva siempre 2 decimales', () => {
    expect(plano(formatMoney(12500))).toBe('$ 12.500');
    expect(plano(formatMoney(12500.5))).toBe('$ 12.500,50');
    expect(plano(formatMoney(12500.55))).toBe('$ 12.500,55');
    expect(plano(formatMoney(0.5))).toBe('$ 0,50');
    expect(plano(formatMoney(0.05))).toBe('$ 0,05');
    expect(plano(formatMoney(1))).toBe('$ 1');
    expect(plano(formatMoney(150000))).toBe('$ 150.000');
    expect(plano(formatMoney(1234))).toBe('$ 1.234'); // 4 dígitos con punto
    expect(plano(formatMoney(999))).toBe('$ 999');
    expect(plano(formatMoney(1000000))).toBe('$ 1.000.000');
    expect(plano(formatMoney(9999999999.99))).toBe('$ 9.999.999.999,99');
    expect(plano(formatMoney(1e21))).toBe('$ 1.000.000.000.000.000.000.000');
  });

  it('el cero es «$ 0» y no lleva signo', () => {
    expect(plano(formatMoney(0))).toBe('$ 0');
    expect(plano(formatMoney(-0))).toBe('$ 0');
    expect(plano(formatMoney(-0.004))).toBe('$ 0');
    expect(plano(formatMoney(0.004))).toBe('$ 0');
  });

  it('un negativo lleva el menos tipográfico delante del «$»', () => {
    expect(formatMoney(-1200)).toBe(`${SIGNO_MENOS}$${NBSP}1.200`);
    expect(formatMoney(-1200).charAt(0)).toBe('−');
    expect(formatMoney(-1200).charAt(0)).not.toBe('-');
    expect(plano(formatMoney(-1200.5))).toBe('-$ 1.200,50');
    expect(plano(formatMoney(-0.5))).toBe('-$ 0,50');
    expect(plano(formatMoney(-1))).toBe('-$ 1');
    expect(plano(formatMoney(-0.005))).toBe('-$ 0,01'); // redondea a 1 centavo: ya no es cero
  });

  it('redondea a centavos con la mitad hacia arriba (como la base) y decide «entero» con el valor ya redondeado', () => {
    expect(plano(formatMoney(1.005))).toBe('$ 1,01');
    expect(plano(formatMoney(2.675))).toBe('$ 2,68');
    expect(plano(formatMoney(12.915))).toBe('$ 12,92');
    expect(plano(formatMoney(120.004))).toBe('$ 120');
    expect(plano(formatMoney(119.996))).toBe('$ 120');
    expect(plano(formatMoney(0.996))).toBe('$ 1');
    expect(plano(formatMoney(0.994))).toBe('$ 0,99');
    expect(plano(formatMoney(23.294))).toBe('$ 23,29');
    expect(plano(formatMoney(99.999))).toBe('$ 100');
    expect(plano(formatMoney(-99.999))).toBe('-$ 100');
    expect(plano(formatMoney(1234.5678))).toBe('$ 1.234,57');
  });

  it('sin valor o no finito: «—», sin «$»', () => {
    for (const valor of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(formatMoney(valor)).toBe('—');
    }
  });

  it('entre el «$» y la cifra hay UN espacio que no corta línea', () => {
    expect(formatMoney(12500)).toBe(`$\xa012.500`);
    expect(formatMoney(12500)).toMatch(/^\$\xa0\d/);
    expect(formatMoney(12500)).not.toMatch(/ /); // ningún espacio común: no se puede partir
  });

  it('PROPIEDAD: nunca «,00», nunca decimales sueltos y nunca «NaN», «Infinity» ni notación científica', () => {
    const azar = (() => {
      let a = 99;
      return () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 4294967296;
      };
    })();
    for (let entero = 0; entero <= 3000; entero += 1) {
      expect(formatMoney(entero)).not.toContain(',');
      expect(formatMoney(entero)).toMatch(/^\$\xa0\d{1,3}(\.\d{3})*$/);
    }
    for (let i = 0; i < 5000; i += 1) {
      const centavos = Math.floor(azar() * 1e9) + 1;
      const valor = centavos / 100;
      const texto = formatMoney(valor);
      expect(texto).not.toMatch(/NaN|Infinity|e\+|e-/i);
      expect(texto).toMatch(centavos % 100 === 0 ? /^\$\xa0\d{1,3}(\.\d{3})*$/ : /^\$\xa0\d{1,3}(\.\d{3})*,\d{2}$/);
      expect(texto).not.toMatch(/,00$/);
    }
  });
});

describe('formatForInput (D3): siempre con coma y sin miles', () => {
  it('coma decimal, sin separador de miles', () => {
    expect(formatForInput(1234.5)).toBe('1234,5');
    expect(formatForInput(12500)).toBe('12500');
    expect(formatForInput(452310.5)).toBe('452310,5');
    expect(formatForInput(40.125)).toBe('40,125');
    expect(formatForInput(0.5)).toBe('0,5');
    expect(formatForInput(0)).toBe('0');
    expect(formatForInput(1234567.89)).toBe('1234567,89');
  });

  it('un cero nunca lleva signo; sin valor, texto vacío', () => {
    expect(formatForInput(-0)).toBe('0');
    expect(formatForInput(null)).toBe('');
    expect(formatForInput(undefined)).toBe('');
    expect(formatForInput(NaN)).toBe('');
    expect(formatForInput(Infinity)).toBe('');
  });

  it('un valor diminuto no sale en notación científica', () => {
    expect(formatForInput(1e-7)).toBe('0');
    expect(formatForInput(-1e-7)).toBe('0'); // un cero nunca lleva signo
    expect(formatForInput(1.2e-7)).toBe('0');
    expect(formatForInput(0.0000012)).toBe('0,0000012');
  });

  it('la coma es la misma con cualquier idioma del teléfono', () => {
    for (const idioma of ['en-US', 'es-MX', 'es-ES', 'es-AR', 'de-DE', '']) {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(idioma);
      expect(formatForInput(1234.5), idioma).toBe('1234,5');
      expect(formatForInput(40.125), idioma).toBe('40,125');
    }
  });

  it('un valor precargado (litros incluidos) vuelve a leerse igual: no cae en «ambiguo» ni en miles', () => {
    expect(validateRequiredNumber(formatForInput(40.125), 'litros')).toEqual({ ok: true, value: 40.125 });
    expect(validateRequiredNumber(formatForInput(1200), 'litros')).toEqual({ ok: true, value: 1200 });
    expect(validateRequiredNumber(formatForInput(12500.5), 'dinero')).toEqual({ ok: true, value: 12500.5 });
    expect(validateRequiredNumber(formatForInput(452310), 'km', { allowZero: true })).toEqual({ ok: true, value: 452310 });
  });
});

describe('los tipos de columna', () => {
  it('no cambiaron', () => {
    const kinds: NumberKind[] = ['dinero', 'litros', 'km', 'precioLitro'];
    expect(kinds.map((kind) => NUMBER_KINDS[kind])).toEqual([
      { precision: 12, scale: 2 },
      { precision: 9, scale: 3 },
      { precision: 9, scale: 1 },
      { precision: 10, scale: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// El aviso «solo números»: UNA fuente para la validación y para el rechazo del campo
// ---------------------------------------------------------------------------

describe('mensajeSoloNumeros', () => {
  it('dinero y km llevan su ejemplo; el resto, el mensaje general', () => {
    expect(mensajeSoloNumeros('dinero')).toBe('Escribe solo números. Ej.: 12500 o 12500,50.');
    expect(mensajeSoloNumeros('km')).toBe('Escribe solo números. Ej.: 45230.');
    expect(mensajeSoloNumeros('litros')).toBe('Escribe solo números, con coma o punto para los decimales.');
    expect(mensajeSoloNumeros('precioLitro')).toBe('Escribe solo números, con coma o punto para los decimales.');
    expect(mensajeSoloNumeros()).toBe('Escribe solo números, con coma o punto para los decimales.');
    expect(mensajeSoloNumeros(undefined)).toBe('Escribe solo números, con coma o punto para los decimales.');
  });

  it('son las mismas constantes que exporta el módulo (dinero y km)', () => {
    expect(mensajeSoloNumeros('dinero')).toBe(DINERO_NO_NUMERICO_MESSAGE);
    expect(mensajeSoloNumeros('km')).toBe(KM_NO_NUMERICO_MESSAGE);
  });

  it.each(['dinero', 'km', 'litros', 'precioLitro'] as const)(
    'la validación y el aviso del campo dicen lo mismo para «%s»: validateRequiredNumber("abc") === mensajeSoloNumeros',
    (kind) => {
      expect(validateRequiredNumber('abc', kind)).toEqual({ ok: false, message: mensajeSoloNumeros(kind) });
      expect(validateRequiredNumber('12a', kind)).toEqual({ ok: false, message: mensajeSoloNumeros(kind) });
      expect(validateRequiredNumber('$', kind)).toEqual({ ok: false, message: mensajeSoloNumeros(kind) });
      expect(validateOptionalNumber('abc', kind)).toEqual({ ok: false, message: mensajeSoloNumeros(kind) });
    },
  );

  it('es español neutro de «tú»: sin voseo', () => {
    for (const kind of [undefined, 'dinero', 'km', 'litros', 'precioLitro'] as const) {
      expect(mensajeSoloNumeros(kind)).toMatch(/^Escribe /);
      expect(mensajeSoloNumeros(kind)).not.toMatch(/\b(escribí|ingresá|usá|tenés|poné)\b/i);
    }
  });

  it('los demás mensajes de validación no cambiaron', () => {
    expect(validateRequiredNumber('', 'dinero')).toEqual({ ok: false, message: 'Escribe el monto.' });
    expect(validateRequiredNumber('', 'litros')).toEqual({ ok: false, message: 'Escribe un número.' });
    expect(validateRequiredNumber('-5', 'dinero')).toEqual({ ok: false, message: 'El número no puede ser negativo.' });
    expect(validateRequiredNumber('1,2,3', 'dinero')).toEqual({
      ok: false,
      message: 'Revisa el número: usa una sola coma o un solo punto para los decimales.',
    });
  });
});
