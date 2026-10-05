import { describe, expect, it } from 'vitest';

import {
  CLIENTE_FIELD_ORDER,
  DIRECCION_LARGA_MESSAGE,
  EMAIL_INVALIDO_MESSAGE,
  EMAIL_LARGO_MESSAGE,
  TELEFONO_LARGO_MESSAGE,
  buildInsertRow,
  emptyClienteValues,
  fingerprintOf,
  validateClienteForm,
  valuesFromCliente,
  type ClienteFormValues,
} from '@/features/clientes/cliente-form';
import { NOMBRE_CLIENTE_LARGO_MESSAGE, NOMBRE_CLIENTE_VACIO_MESSAGE } from '@/features/clientes/cliente-nombre';
import { MAX_DIRECCION, MAX_EMAIL, MAX_TELEFONO } from '@/features/clientes/constants';

const REF = '55555555-5555-4555-8555-555555555555';
const valores = (over: Partial<ClienteFormValues> = {}): ClienteFormValues => ({ ...emptyClienteValues(), nombre: 'Almacén Central', ...over });

describe('valores del formulario de cliente', () => {
  it('un cliente nuevo arranca vacío', () => {
    expect(emptyClienteValues()).toEqual({ nombre: '', telefono: '', email: '', direccion: '' });
  });

  it('al editar, los datos guardados pasan a texto (los null, a vacío)', () => {
    expect(
      valuesFromCliente({ nombre: 'Bodega Norte', contacto_telefono: '351 555-1234', contacto_email: null, direccion: null }),
    ).toEqual({ nombre: 'Bodega Norte', telefono: '351 555-1234', email: '', direccion: '' });
    expect(
      valuesFromCliente({ nombre: 'X', contacto_telefono: null, contacto_email: 'ventas@bodega.test', direccion: 'Ruta 9 km 12' }),
    ).toEqual({ nombre: 'X', telefono: '', email: 'ventas@bodega.test', direccion: 'Ruta 9 km 12' });
  });

  it('el orden de los campos es el de la pantalla', () => {
    expect(CLIENTE_FIELD_ORDER).toEqual(['nombre', 'telefono', 'email', 'direccion']);
  });
});

describe('validateClienteForm', () => {
  it('solo el nombre: las cuatro columnas explícitas, con null en los datos de contacto vacíos', () => {
    const r = validateClienteForm(valores());
    expect(r).toEqual({
      ok: true,
      columns: { nombre: 'Almacén Central', contacto_telefono: null, contacto_email: null, direccion: null },
    });
  });

  it('todo cargado: recorta los costados y guarda lo tipeado (sin cambiar mayúsculas ni el formato del teléfono)', () => {
    const r = validateClienteForm({
      nombre: '  Bodega Norte ',
      telefono: ' +54 9 351 555-1234 ',
      email: ' Ventas@Bodega.test.ar ',
      direccion: '  Ruta 9 km 12, Pilar ',
    });
    expect(r).toEqual({
      ok: true,
      columns: {
        nombre: 'Bodega Norte',
        contacto_telefono: '+54 9 351 555-1234',
        contacto_email: 'Ventas@Bodega.test.ar',
        direccion: 'Ruta 9 km 12, Pilar',
      },
    });
  });

  it('un dato de contacto de solo espacios cuenta como vacío (null)', () => {
    const r = validateClienteForm(valores({ telefono: '   ', email: '\t', direccion: ' \n ' }));
    expect(r.ok && r.columns).toEqual({ nombre: 'Almacén Central', contacto_telefono: null, contacto_email: null, direccion: null });
  });

  it('nombre vacío o de solo espacios: error en el nombre y foco ahí', () => {
    for (const nombre of ['', '   ', '\t\n']) {
      const r = validateClienteForm(valores({ nombre }));
      expect(r.ok, JSON.stringify(nombre)).toBe(false);
      if (!r.ok) {
        expect(r.errors.nombre).toBe(NOMBRE_CLIENTE_VACIO_MESSAGE);
        expect(r.firstField).toBe('nombre');
      }
    }
  });

  it('nombre de 200 caracteres pasa; de 201, no (cuenta caracteres como la base: un emoji es 1)', () => {
    expect(validateClienteForm(valores({ nombre: 'a'.repeat(200) })).ok).toBe(true);
    expect(validateClienteForm(valores({ nombre: '🚚'.repeat(200) })).ok).toBe(true);
    const r = validateClienteForm(valores({ nombre: 'a'.repeat(201) }));
    expect(!r.ok && r.errors.nombre).toBe(NOMBRE_CLIENTE_LARGO_MESSAGE);
  });

  it(`teléfono: hasta ${MAX_TELEFONO} caracteres; texto libre (se puede anotar a quién llamar)`, () => {
    expect(validateClienteForm(valores({ telefono: '1'.repeat(MAX_TELEFONO) })).ok).toBe(true);
    expect(validateClienteForm(valores({ telefono: '351 555-1234 (pedir por Depósito)' })).ok).toBe(true);
    const r = validateClienteForm(valores({ telefono: '1'.repeat(MAX_TELEFONO + 1) }));
    expect(!r.ok && r.errors.telefono).toBe(TELEFONO_LARGO_MESSAGE);
    expect(TELEFONO_LARGO_MESSAGE).toBe('El teléfono puede tener hasta 50 caracteres.');
  });

  it(`dirección: hasta ${MAX_DIRECCION} caracteres`, () => {
    expect(validateClienteForm(valores({ direccion: 'a'.repeat(MAX_DIRECCION) })).ok).toBe(true);
    const r = validateClienteForm(valores({ direccion: 'a'.repeat(MAX_DIRECCION + 1) }));
    expect(!r.ok && r.errors.direccion).toBe(DIRECCION_LARGA_MESSAGE);
    expect(DIRECCION_LARGA_MESSAGE).toBe('La dirección puede tener hasta 300 caracteres.');
  });

  it('email: con la forma mínima (algo@algo.algo, sin espacios) pasa; lo que claramente no es un email, no', () => {
    for (const email of ['ventas@bodega.test', 'a.b+c@sub.dominio.test.ar', 'ventas@almacén.test.ar', 'X@Y.ZZ']) {
      expect(validateClienteForm(valores({ email })).ok, email).toBe(true);
    }
    for (const email of ['no tiene', 'ventas@bodega', '@bodega.test', 'ventas@', 'ventas bodega@x.test', 'a@b@c.test', '351 555-1234']) {
      const r = validateClienteForm(valores({ email }));
      expect(!r.ok && r.errors.email, email).toBe(EMAIL_INVALIDO_MESSAGE);
    }
  });

  it(`email: hasta ${MAX_EMAIL} caracteres (el largo se avisa antes que la forma)`, () => {
    const largo = `${'a'.repeat(MAX_EMAIL - 10)}@empresa.test`; // 254 + 3
    const r = validateClienteForm(valores({ email: largo }));
    expect(!r.ok && r.errors.email).toBe(EMAIL_LARGO_MESSAGE);
    const justo = `${'a'.repeat(64)}@${'b'.repeat(MAX_EMAIL - 64 - 1 - 5)}.test`; // 64 + @ + 184 + ".test" (5) = 254
    expect(Array.from(justo).length).toBe(MAX_EMAIL);
    expect(validateClienteForm(valores({ email: justo })).ok).toBe(true);
  });

  it('con varios errores marca todos y el foco va al PRIMERO en el orden de la pantalla', () => {
    const r = validateClienteForm({ nombre: 'Ok', telefono: '1'.repeat(51), email: 'mal', direccion: 'a'.repeat(301) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(['direccion', 'email', 'telefono']);
      expect(r.firstField).toBe('telefono');
    }
    const r2 = validateClienteForm({ nombre: '', telefono: '', email: 'mal', direccion: '' });
    expect(!r2.ok && r2.firstField).toBe('nombre');
  });

  it('un texto enorme pegado no se recorre entero ni rompe: da el error de largo', () => {
    const r = validateClienteForm(valores({ direccion: 'x'.repeat(2_000_000) }));
    expect(!r.ok && r.errors.direccion).toBe(DIRECCION_LARGA_MESSAGE);
  });
});

describe('lo que se manda a la base al crear', () => {
  it('buildInsertRow: los datos + el client_ref (nada de id ni transportista_id)', () => {
    expect(buildInsertRow({ nombre: 'A' }, REF)).toEqual({ nombre: 'A', client_ref: REF });
    expect(
      buildInsertRow({ nombre: 'A', contacto_telefono: null, contacto_email: 'a@b.co', direccion: null }, REF),
    ).toEqual({ nombre: 'A', contacto_telefono: null, contacto_email: 'a@b.co', direccion: null, client_ref: REF });
  });

  it('fingerprintOf: un dato de contacto que no viene cuenta como null (el alta al vuelo y el formulario dan lo mismo)', () => {
    expect(fingerprintOf({ nombre: 'A' })).toBe(
      fingerprintOf({ nombre: 'A', contacto_telefono: null, contacto_email: null, direccion: null }),
    );
  });

  it('fingerprintOf: cambia si cambia cualquier dato, y no incluye el client_ref', () => {
    const base = { nombre: 'A', contacto_telefono: '1', contacto_email: 'a@b.co', direccion: 'x' };
    const huella = fingerprintOf(base);
    for (const cambio of [{ nombre: 'B' }, { contacto_telefono: '2' }, { contacto_email: null }, { direccion: 'y' }]) {
      expect(fingerprintOf({ ...base, ...cambio }), JSON.stringify(cambio)).not.toBe(huella);
    }
    expect(huella).not.toContain(REF);
    expect(fingerprintOf({ ...base })).toBe(huella);
  });
});
