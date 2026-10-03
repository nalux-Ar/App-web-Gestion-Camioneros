import { describe, expect, it } from 'vitest';

import {
  DESCRIPCION_COUNTER_FROM,
  LIST_LIMIT,
  MAX_DESCRIPCION,
  MOTIVO_LABELS,
  MOTIVO_ORDER,
} from '@/features/devoluciones/constants';
import {
  CLIENTE_FALTA_MESSAGE,
  DESCRIPCION_LARGA_MESSAGE,
  DESCRIPCION_OBLIGATORIA_MESSAGE,
  DEVOLUCION_FIELD_ORDER,
  MOTIVO_FALTA_MESSAGE,
  buildInsertRow,
  emptyDevolucionValues,
  esMotivoOtro,
  fingerprintOf,
  validateDevolucionForm,
  valuesFromDevolucion,
  type DevolucionColumns,
  type DevolucionFormValues,
} from '@/features/devoluciones/devolucion-form';

const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const OTRO_VIAJE = 'b0000000-0000-4000-8000-000000000002';
const C_1 = 'a0000000-0000-4000-8000-000000000001';
const C_2 = 'a0000000-0000-4000-8000-000000000002';
const REF = '55555555-5555-4555-8555-555555555555';
const CLIENTES = [{ id: C_1 }, { id: C_2 }];

const values = (over: Partial<DevolucionFormValues> = {}): DevolucionFormValues => ({
  motivo: 'rotura_danio',
  clienteId: C_1,
  descripcion: '',
  ...over,
});
const validar = (over: Partial<DevolucionFormValues> = {}, clientes = CLIENTES) => validateDevolucionForm(values(over), { clientes });

describe('motivos y etiquetas', () => {
  it('son los cuatro del enum, en este orden', () => {
    expect([...MOTIVO_ORDER]).toEqual(['rotura_danio', 'vencimiento', 'mercaderia_incorrecta', 'otro']);
  });

  it('cada motivo tiene su etiqueta exacta en español', () => {
    expect(MOTIVO_LABELS).toEqual({
      rotura_danio: 'Rotura o daño',
      vencimiento: 'Vencimiento',
      mercaderia_incorrecta: 'Mercadería incorrecta',
      otro: 'Otro',
    });
    expect(MOTIVO_ORDER.map((m) => MOTIVO_LABELS[m])).toEqual(['Rotura o daño', 'Vencimiento', 'Mercadería incorrecta', 'Otro']);
  });

  it('los topes: descripción de 2000 (como el check de la base), contador desde 1800 y 200 devoluciones en el detalle', () => {
    expect(MAX_DESCRIPCION).toBe(2000);
    expect(DESCRIPCION_COUNTER_FROM).toBe(1800);
    expect(LIST_LIMIT).toBe(200);
  });

  it('esMotivoOtro: solo "otro"', () => {
    expect(esMotivoOtro('otro')).toBe(true);
    for (const m of ['rotura_danio', 'vencimiento', 'mercaderia_incorrecta', ''] as const) expect(esMotivoOtro(m)).toBe(false);
  });
});

describe('valores iniciales', () => {
  it('una devolución nueva arranca vacía: no se preselecciona ni motivo ni cliente', () => {
    expect(emptyDevolucionValues()).toEqual({ motivo: '', clienteId: '', descripcion: '' });
  });

  it('valuesFromDevolucion: motivo, cliente y descripción (null = texto vacío)', () => {
    expect(valuesFromDevolucion({ motivo: 'vencimiento', cliente_id: C_2, descripcion: 'Latas vencidas' })).toEqual({
      motivo: 'vencimiento',
      clienteId: C_2,
      descripcion: 'Latas vencidas',
    });
    expect(valuesFromDevolucion({ motivo: 'otro', cliente_id: C_1, descripcion: null }).descripcion).toBe('');
  });
});

describe('validateDevolucionForm', () => {
  it('un formulario correcto da las tres columnas (y nada más: ni viaje, ni client_ref, ni transportista_id)', () => {
    const r = validar({ descripcion: 'Dos pallets rotos' });
    expect(r).toEqual({ ok: true, columns: { motivo: 'rotura_danio', cliente_id: C_1, descripcion: 'Dos pallets rotos' } });
  });

  it('el motivo es obligatorio: vacío o un valor que no es del enum dan "Elige un motivo."', () => {
    for (const motivo of ['', 'devolucion', 'ROTURA_DANIO', 'toString'] as const) {
      const r = validar({ motivo: motivo as DevolucionFormValues['motivo'] });
      expect(r.ok, motivo).toBe(false);
      if (!r.ok) {
        expect(r.errors.motivo, motivo).toBe(MOTIVO_FALTA_MESSAGE);
        expect(r.firstField).toBe('motivo');
      }
    }
    expect(MOTIVO_FALTA_MESSAGE).toBe('Elige un motivo.');
  });

  it('cada uno de los cuatro motivos es válido', () => {
    for (const motivo of MOTIVO_ORDER) {
      const r = validar({ motivo, descripcion: 'algo' });
      expect(r.ok, motivo).toBe(true);
    }
  });

  it('el cliente es obligatorio ("Elige un cliente.") y tiene que ser uno de los conocidos', () => {
    expect(CLIENTE_FALTA_MESSAGE).toBe('Elige un cliente.');
    const vacio = validar({ clienteId: '' });
    expect(vacio.ok).toBe(false);
    if (!vacio.ok) expect(vacio.errors.clienteId).toBe('Elige un cliente.');

    const desconocido = validar({ clienteId: 'a0000000-0000-4000-8000-0000000000ff' });
    expect(desconocido.ok).toBe(false);
    if (!desconocido.ok) {
      expect(desconocido.errors.clienteId).toBe('Elige un cliente.');
      expect(desconocido.firstField).toBe('clienteId');
    }
  });

  it('sin ningún cliente conocido no hay nada que elegir: el cliente guardado tampoco vale', () => {
    const r = validar({ clienteId: C_1 }, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.clienteId).toBe('Elige un cliente.');
  });

  it('la descripción es opcional: vacía o solo espacios = null explícito (no se omite)', () => {
    for (const descripcion of ['', '   ', '\n\t ']) {
      const r = validar({ descripcion });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(Object.prototype.hasOwnProperty.call(r.columns, 'descripcion')).toBe(true);
        expect(r.columns.descripcion).toBeNull();
      }
    }
  });

  it('la descripción se manda recortada', () => {
    const r = validar({ descripcion: '  Cajas golpeadas \n' });
    expect(r.ok && r.columns.descripcion).toBe('Cajas golpeadas');
  });

  it('hasta 2000 caracteres es válida; 2001 no ("La descripción puede tener hasta 2000 caracteres.")', () => {
    expect(validar({ descripcion: 'a'.repeat(2000) }).ok).toBe(true);
    const r = validar({ descripcion: 'a'.repeat(2001) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.descripcion).toBe('La descripción puede tener hasta 2000 caracteres.');
      expect(r.errors.descripcion).toBe(DESCRIPCION_LARGA_MESSAGE);
    }
  });

  it('se cuenta como la base (code points): 2000 emojis entran, aunque ocupen 4000 unidades UTF-16; 2001 no', () => {
    expect(validar({ descripcion: '😀'.repeat(2000) }).ok).toBe(true);
    expect(validar({ descripcion: '😀'.repeat(2001) }).ok).toBe(false);
  });

  it('el largo se mide sobre el texto RECORTADO: 2000 caracteres con espacios alrededor entran', () => {
    expect(validar({ descripcion: `  ${'a'.repeat(2000)}  ` }).ok).toBe(true);
  });

  describe('motivo "Otro": la descripción es obligatoria (regla solo del front)', () => {
    it('vacía o solo espacios: "Escribe qué pasó con esta devolución." y el foco va a la descripción', () => {
      expect(DESCRIPCION_OBLIGATORIA_MESSAGE).toBe('Escribe qué pasó con esta devolución.');
      for (const descripcion of ['', '   ', '\n']) {
        const r = validar({ motivo: 'otro', descripcion });
        expect(r.ok, JSON.stringify(descripcion)).toBe(false);
        if (!r.ok) {
          expect(r.errors.descripcion).toBe('Escribe qué pasó con esta devolución.');
          expect(r.firstField).toBe('descripcion');
        }
      }
    });

    it('con texto es válida', () => {
      const r = validar({ motivo: 'otro', descripcion: 'El cliente cerró antes' });
      expect(r).toEqual({ ok: true, columns: { motivo: 'otro', cliente_id: C_1, descripcion: 'El cliente cerró antes' } });
    });

    it('con cualquier OTRO motivo la descripción vacía es válida', () => {
      for (const motivo of ['rotura_danio', 'vencimiento', 'mercaderia_incorrecta'] as const) {
        expect(validar({ motivo, descripcion: '' }).ok, motivo).toBe(true);
      }
    });

    it('con "Otro" y más de 2000 caracteres el error es el del largo, no el de obligatoria', () => {
      const r = validar({ motivo: 'otro', descripcion: 'a'.repeat(2001) });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.descripcion).toBe(DESCRIPCION_LARGA_MESSAGE);
    });
  });

  it('con todo mal: un error por campo, en el orden de la pantalla (Motivo, Cliente, Descripción) y el foco al primero', () => {
    expect(DEVOLUCION_FIELD_ORDER).toEqual(['motivo', 'clienteId', 'descripcion']);

    const todo = validar({ motivo: '', clienteId: '', descripcion: 'a'.repeat(2001) });
    expect(todo.ok).toBe(false);
    if (!todo.ok) {
      expect(Object.keys(todo.errors).sort()).toEqual(['clienteId', 'descripcion', 'motivo']);
      expect(todo.firstField).toBe('motivo');
    }

    const sinCliente = validar({ clienteId: '', descripcion: 'a'.repeat(2001) });
    if (!sinCliente.ok) expect(sinCliente.firstField).toBe('clienteId');

    const soloDescripcion = validar({ motivo: 'otro', descripcion: '' });
    if (!soloDescripcion.ok) expect(soloDescripcion.firstField).toBe('descripcion');
  });
});

describe('lo que se manda al crear', () => {
  const columns: DevolucionColumns = { motivo: 'vencimiento', cliente_id: C_2, descripcion: 'Yogures' };

  it('buildInsertRow: el viaje, las tres columnas y el client_ref; nunca id ni transportista_id', () => {
    const row = buildInsertRow(VIAJE, columns, REF);
    expect(row).toEqual({ viaje_id: VIAJE, motivo: 'vencimiento', cliente_id: C_2, descripcion: 'Yogures', client_ref: REF });
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('transportista_id');
  });

  it('con descripción null la manda en null explícito', () => {
    const row = buildInsertRow(VIAJE, { ...columns, descripcion: null }, REF);
    expect(Object.prototype.hasOwnProperty.call(row, 'descripcion')).toBe(true);
    expect(row.descripcion).toBeNull();
  });
});

describe('fingerprintOf: la huella incluye TODO lo que se manda', () => {
  const base: DevolucionColumns = { motivo: 'vencimiento', cliente_id: C_2, descripcion: 'Yogures' };
  const huella = fingerprintOf(VIAJE, base);

  it('es estable: lo mismo da la misma huella', () => {
    expect(fingerprintOf(VIAJE, { ...base })).toBe(huella);
  });

  it('cambia con el viaje', () => {
    expect(fingerprintOf(OTRO_VIAJE, base)).not.toBe(huella);
  });

  it('cambia con el motivo', () => {
    expect(fingerprintOf(VIAJE, { ...base, motivo: 'otro' })).not.toBe(huella);
  });

  it('cambia con el cliente', () => {
    expect(fingerprintOf(VIAJE, { ...base, cliente_id: C_1 })).not.toBe(huella);
  });

  it('cambia con la descripción (también de texto a null y de null a texto)', () => {
    expect(fingerprintOf(VIAJE, { ...base, descripcion: 'Otra cosa' })).not.toBe(huella);
    expect(fingerprintOf(VIAJE, { ...base, descripcion: null })).not.toBe(huella);
    expect(fingerprintOf(VIAJE, { ...base, descripcion: null })).not.toBe(fingerprintOf(VIAJE, { ...base, descripcion: '' }));
  });

  it('no confunde campos entre sí (el cliente en el lugar del viaje, etc.)', () => {
    expect(fingerprintOf(C_2, { motivo: 'vencimiento', cliente_id: VIAJE, descripcion: 'Yogures' })).not.toBe(huella);
  });
});
