import { describe, expect, it } from 'vitest';

import {
  CREAR_CLIENTE_CONTEXT,
  MAX_NOMBRE_CLIENTE,
  NOMBRE_CLIENTE_LARGO_MESSAGE,
  NOMBRE_CLIENTE_VACIO_MESSAGE,
  buscarDuplicado,
  combinarClientes,
  normalizarNombre,
  ordenarClientes,
  validateNombreCliente,
} from '@/features/clientes/cliente-nombre';
import { mapDataError } from '@/lib/data-errors';

// Caracteres invisibles armados con su codigo: escritos literales no se distinguen en el codigo.
const NBSP = String.fromCharCode(0xa0); // espacio duro
const ACENTO_COMBINADO = String.fromCharCode(0x301); // acento agudo combinado (NFD)

describe('validateNombreCliente', () => {
  it('constante del tope = 200 (mismo valor que clientes_nombre_chk)', () => {
    expect(MAX_NOMBRE_CLIENTE).toBe(200);
  });

  it('vacío o solo espacios (incluido NBSP, tabs y saltos) -> mensaje de "escribe el nombre"', () => {
    for (const raw of ['', '   ', '\t', ' \n ', NBSP, `${NBSP} ${NBSP}`]) {
      expect(validateNombreCliente(raw)).toEqual({ ok: false, message: NOMBRE_CLIENTE_VACIO_MESSAGE });
    }
  });

  it('recorta los costados y conserva el interior tal cual', () => {
    expect(validateNombreCliente('  Cooperativa   Agrícola \n')).toEqual({ ok: true, value: 'Cooperativa   Agrícola' });
  });

  it('1 carácter es válido', () => {
    expect(validateNombreCliente('A')).toEqual({ ok: true, value: 'A' });
  });

  it('200 exactos -> válido; 201 -> mensaje de largo', () => {
    expect(validateNombreCliente('a'.repeat(200))).toEqual({ ok: true, value: 'a'.repeat(200) });
    expect(validateNombreCliente('a'.repeat(201))).toEqual({ ok: false, message: NOMBRE_CLIENTE_LARGO_MESSAGE });
  });

  it('el espacio de los costados no cuenta para el tope', () => {
    expect(validateNombreCliente(`  ${'a'.repeat(200)}  `).ok).toBe(true);
    expect(validateNombreCliente(`  ${'a'.repeat(201)}  `).ok).toBe(false);
  });

  it('cuenta code points como Postgres: 100 emojis (200 unidades UTF-16) son válidos; 201 no', () => {
    expect(validateNombreCliente('😀'.repeat(200)).ok).toBe(true);
    expect(validateNombreCliente('😀'.repeat(201)).ok).toBe(false);
  });

  it('un pegado enorme se rechaza sin recorrerlo entero', () => {
    expect(validateNombreCliente('x'.repeat(5_000_000))).toEqual({ ok: false, message: NOMBRE_CLIENTE_LARGO_MESSAGE });
  });

  it('mensajes en español, con "tú" y sin voseo', () => {
    expect(NOMBRE_CLIENTE_VACIO_MESSAGE).toBe('Escribe el nombre del cliente.');
    expect(NOMBRE_CLIENTE_LARGO_MESSAGE).toBe('El nombre puede tener hasta 200 caracteres.');
  });
});

describe('normalizarNombre', () => {
  it('recorta, reduce espacios múltiples a uno, pasa a minúsculas y quita tildes', () => {
    expect(normalizarNombre('  Cooperativa   ÁGRÍCOLA  ')).toBe('cooperativa agricola');
  });

  it('tabs, saltos y espacios duros cuentan como espacio', () => {
    expect(normalizarNombre(`Transportes\t\nDel Litoral${NBSP}${NBSP}SRL`)).toBe('transportes del litoral srl');
  });

  it('la ñ y la diéresis pierden la marca (Cañuelas = Canuelas, Pingüino = Pinguino)', () => {
    expect(normalizarNombre('Cañuelas')).toBe('canuelas');
    expect(normalizarNombre('Pingüino')).toBe('pinguino');
  });

  it('es estable con texto ya normalizado y con vacío', () => {
    expect(normalizarNombre(normalizarNombre('Él  Ñandú'))).toBe('el nandu');
    expect(normalizarNombre('   ')).toBe('');
  });

  it('descompuesto (NFD) y compuesto (NFC) dan lo mismo', () => {
    expect(normalizarNombre(`Cafe${ACENTO_COMBINADO}`)).toBe(normalizarNombre('Café'));
    expect(normalizarNombre(`Cafe${ACENTO_COMBINADO}`)).toBe('cafe');
  });

  it('no mezcla nombres distintos', () => {
    expect(normalizarNombre('Almacén Hnos')).not.toBe(normalizarNombre('Almacen Hermanos'));
  });
});

describe('buscarDuplicado', () => {
  const clientes = [
    { id: 'c1', nombre: 'Cooperativa Agrícola' },
    { id: 'c2', nombre: 'Frigorífico Sur' },
    { id: 'c3', nombre: 'cooperativa  agricola' },
  ];

  it('encuentra el homónimo ignorando mayúsculas, tildes y espacios; devuelve el primero de la lista', () => {
    expect(buscarDuplicado('COOPERATIVA AGRICOLA', clientes)).toEqual(clientes[0]);
    expect(buscarDuplicado('  frigorifico   sur ', clientes)).toEqual(clientes[1]);
  });

  it('sin coincidencia -> null', () => {
    expect(buscarDuplicado('Frigorífico Norte', clientes)).toBeNull();
    expect(buscarDuplicado('Cooperativa', clientes)).toBeNull(); // un prefijo no es un duplicado
  });

  it('un nombre vacío no tiene duplicado', () => {
    expect(buscarDuplicado('   ', [{ id: 'x', nombre: '   ' }])).toBeNull();
    expect(buscarDuplicado('', clientes)).toBeNull();
  });

  it('lista vacía -> null', () => {
    expect(buscarDuplicado('Algo', [])).toBeNull();
  });

  it('`ignorar` saltea a los homónimos ya aceptados y encuentra al siguiente', () => {
    expect(buscarDuplicado('Cooperativa Agrícola', clientes, new Set(['c1']))).toEqual(clientes[2]);
    expect(buscarDuplicado('Cooperativa Agrícola', clientes, new Set(['c1', 'c3']))).toBeNull();
  });
});

describe('ordenarClientes y combinarClientes', () => {
  it('ordena por nombre en español sin distinguir mayúsculas ni tildes', () => {
    const orden = ordenarClientes([
      { id: '1', nombre: 'zeta' },
      { id: '2', nombre: 'Ámbar' },
      { id: '3', nombre: 'álamo' },
      { id: '4', nombre: 'Beta' },
    ]).map((c) => c.nombre);
    expect(orden).toEqual(['álamo', 'Ámbar', 'Beta', 'zeta']);
  });

  it('con el mismo nombre desempata por id (orden estable) y no muta la entrada', () => {
    const entrada = [
      { id: 'b', nombre: 'Igual' },
      { id: 'a', nombre: 'igual' },
    ];
    expect(ordenarClientes(entrada).map((c) => c.id)).toEqual(['a', 'b']);
    expect(entrada.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('combinarClientes suma los creados que la lista no trae, sin repetir por id y ordenado', () => {
    const cargados = [
      { id: '1', nombre: 'Beta' },
      { id: '3', nombre: 'Delta' },
    ];
    const creados = [
      { id: '3', nombre: 'Delta' }, // ya está en la lista: no se repite
      { id: '2', nombre: 'Alfa' },
    ];
    expect(combinarClientes(cargados, creados).map((c) => c.id)).toEqual(['2', '1', '3']);
    expect(combinarClientes(cargados, [])).toEqual(cargados);
  });
});

describe('CREAR_CLIENTE_CONTEXT', () => {
  it('un check de la base (23514) se muestra como mensaje de nombre inválido, sin nombres internos', () => {
    const mensaje = mapDataError({ code: '23514', message: 'violates check constraint "clientes_nombre_chk"' }, CREAR_CLIENTE_CONTEXT);
    expect(mensaje).toBe('Revisa el nombre del cliente: tiene que tener entre 1 y 200 caracteres.');
    expect(mensaje).not.toContain('clientes_nombre_chk');
  });
});
