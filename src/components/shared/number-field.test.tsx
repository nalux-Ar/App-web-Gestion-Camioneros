import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LITROS_HINT, type NumberKind } from '@/lib/numbers';
import { NumberField } from './number-field';

// «Se lee: …»: debajo de un campo de dinero o de kilómetros, la confirmación de CÓMO se leyó lo escrito. Texto visible (no una región
// aria-live), asociado al campo con aria-describedby, a 16 px y en el color de apoyo de siempre.

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

interface CampoProps {
  kind?: NumberKind;
  allowZero?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  inicial?: string;
  unit?: string;
  /** Todo lo que el campo le pasa al «formulario» (su `onChange`), en orden. */
  recibidos?: string[];
}

/** El campo con su estado, como lo usan los formularios (el texto vive afuera). */
function Campo({ kind, allowZero, optional, hint, error, inicial = '', unit, recibidos }: CampoProps) {
  const [value, setValue] = useState(inicial);
  return (
    <NumberField
      id="campo"
      label="Monto"
      kind={kind}
      allowZero={allowZero}
      optional={optional}
      hint={hint}
      error={error}
      unit={unit}
      value={value}
      onChange={(texto) => {
        recibidos?.push(texto);
        setValue(texto);
      }}
    />
  );
}

let montajes = 0;

/** Cada llamada monta un campo NUEVO (con otra `key`): su estado y su «ya salió del campo» arrancan de cero. */
async function montar(props: CampoProps) {
  montajes += 1;
  await act(async () => {
    root.render(<Campo key={montajes} {...props} />);
  });
}

const input = () => container.querySelector<HTMLInputElement>('#campo')!;
const lectura = () => container.querySelector<HTMLElement>('#campo-lectura');
const textoLectura = () => lectura()?.textContent?.replace(/\xa0/g, ' ') ?? null;
const error = () => container.querySelector('#campo-error')!.textContent ?? '';

async function escribir(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), valor);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function salir() {
  await act(async () => {
    input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

const describedBy = () => (input().getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);

describe('NumberField: línea «Se lee» de dinero', () => {
  it('aparece apenas hay un número que se lee bien, con el formato de pesos', async () => {
    await montar({ kind: 'dinero' });
    expect(lectura()).toBeNull();
    await escribir('12500');
    expect(textoLectura()).toBe('Se lee: $ 12.500');
    await escribir('12500,5');
    expect(textoLectura()).toBe('Se lee: $ 12.500,50');
    await escribir('12,5');
    expect(textoLectura()).toBe('Se lee: $ 12,50');
  });

  it('«12.500» (punto de miles) se lee como 12500 y el texto del campo no se toca', async () => {
    await montar({ kind: 'dinero' });
    await escribir('12.500');
    expect(textoLectura()).toBe('Se lee: $ 12.500');
    expect(input().value).toBe('12.500');
    await escribir('1.234.567');
    expect(textoLectura()).toBe('Se lee: $ 1.234.567');
    await escribir('12.5');
    expect(textoLectura()).toBe('Se lee: $ 12,50');
  });

  it('desaparece cuando el campo queda vacío o lo escrito no se lee bien', async () => {
    await montar({ kind: 'dinero' });
    await escribir('12500');
    expect(lectura()).not.toBeNull();
    await escribir('');
    expect(lectura()).toBeNull();
    await escribir('12,505'); // 3 decimales
    expect(lectura()).toBeNull();
    await escribir('1.23.456'); // ambiguo
    expect(lectura()).toBeNull();
    await escribir('10000000000'); // no entra en la columna
    expect(lectura()).toBeNull();
    await escribir('0'); // el monto tiene que ser mayor que 0
    expect(lectura()).toBeNull();
    await escribir('5');
    expect(textoLectura()).toBe('Se lee: $ 5');
  });

  it('con `allowZero`, el 0 se lee («Se lee: $ 0»); sin él, no', async () => {
    await montar({ kind: 'dinero', allowZero: true, optional: true });
    await escribir('0');
    expect(textoLectura()).toBe('Se lee: $ 0');
  });

  it('el espacio entre el «$» y la cifra no corta línea', async () => {
    await montar({ kind: 'dinero' });
    await escribir('12500');
    expect(lectura()!.textContent).toBe('Se lee: $\xa012.500');
  });
});

describe('NumberField: línea «Se lee» de kilómetros', () => {
  it('«Se lee: 452.310 km», sin «$»', async () => {
    await montar({ kind: 'km', allowZero: true, optional: true, unit: 'km' });
    await escribir('452.310');
    expect(textoLectura()).toBe('Se lee: 452.310 km');
    await escribir('452310,5');
    expect(textoLectura()).toBe('Se lee: 452.310,5 km');
    expect(lectura()!.textContent).not.toContain('$');
    await escribir('45,55'); // 2 decimales: no se lee
    expect(lectura()).toBeNull();
  });

  it('con `allowZero` el 0 se lee; sin él, no', async () => {
    await montar({ kind: 'km', allowZero: true, optional: true });
    await escribir('0');
    expect(textoLectura()).toBe('Se lee: 0 km');
    await montar({ kind: 'km', inicial: '0' });
    expect(lectura()).toBeNull();
  });
});

describe('NumberField: sin línea en litros ni sin `kind`', () => {
  it('litros: nada, y la ayuda de siempre', async () => {
    await montar({ kind: 'litros', unit: 'L' });
    await escribir('40,5');
    expect(lectura()).toBeNull();
    await escribir('1200');
    expect(lectura()).toBeNull();
    expect(container.textContent).toContain(LITROS_HINT);
    expect(container.textContent).not.toContain('Se lee');
    expect(describedBy()).toEqual(['campo-hint']);
  });

  it('precio por litro y campos sin `kind`: nada', async () => {
    await montar({ kind: 'precioLitro' });
    await escribir('23,5');
    expect(lectura()).toBeNull();
    await montar({});
    await escribir('23,5');
    expect(lectura()).toBeNull();
    expect(describedBy()).toEqual([]);
  });

  it('en litros «1.200» sigue dando el aviso de siempre (no es miles)', async () => {
    await montar({ kind: 'litros', unit: 'L' });
    await escribir('1.200');
    await salir();
    expect(error()).toContain('Escribe los litros con coma');
    expect(lectura()).toBeNull();
  });
});

describe('NumberField: accesibilidad de la línea', () => {
  it('el campo apunta a la línea con aria-describedby (y solo cuando hay línea)', async () => {
    await montar({ kind: 'dinero' });
    expect(describedBy()).toEqual([]);
    await escribir('12500');
    expect(lectura()!.id).toBe('campo-lectura');
    expect(describedBy()).toEqual(['campo-lectura']);
    await escribir('12,505');
    expect(describedBy()).toEqual([]);
  });

  it('es texto normal: no es una región aria-live ni está dentro de una', async () => {
    await montar({ kind: 'dinero' });
    await escribir('12500');
    const linea = lectura()!;
    expect(linea.tagName).toBe('P');
    expect(linea.getAttribute('aria-live')).toBeNull();
    expect(linea.getAttribute('role')).toBeNull();
    expect(linea.closest('[aria-live]')).toBeNull();
    expect(linea.querySelector('[aria-live]')).toBeNull();
    // La única región viva del campo sigue siendo la del error.
    expect(Array.from(container.querySelectorAll('[aria-live]')).map((el) => el.id)).toEqual(['campo-error']);
  });

  it('16 px (text-base) y el color de apoyo de siempre', async () => {
    await montar({ kind: 'dinero' });
    await escribir('12500');
    const clases = lectura()!.className;
    expect(clases).toContain('text-base');
    expect(clases).not.toMatch(/\btext-(xs|sm)\b/);
    expect(clases).toContain('text-muted-foreground');
    // Ningún color nuevo: solo variables del tema.
    expect(clases).not.toMatch(/#|rgb|\[(?:color|#)/);
  });

  it('va pegada al campo: después del control y antes de la ayuda y del error', async () => {
    await montar({ kind: 'km', allowZero: true, optional: true, hint: 'Los km totales que marca el tablero.' });
    await escribir('452310');
    const orden = Array.from(container.querySelectorAll('#campo, #campo-lectura, #campo-hint, #campo-error')).map((el) => el.id);
    expect(orden).toEqual(['campo', 'campo-lectura', 'campo-hint', 'campo-error']);
    expect(describedBy()).toEqual(['campo-lectura', 'campo-hint']);
  });
});

describe('NumberField: convive con el error sin taparlo', () => {
  it('lo escrito mal: el error (al salir) y NINGUNA línea', async () => {
    await montar({ kind: 'dinero' });
    await escribir('12,505');
    expect(lectura()).toBeNull();
    expect(error()).toBe(''); // todavía no salió del campo
    await salir();
    expect(error()).toContain('Usa hasta 2 decimales.');
    expect(lectura()).toBeNull();
    expect(describedBy()).toEqual(['campo-error']);
    // Se corrige: el error se va y aparece la línea.
    await escribir('12500');
    expect(error()).toBe('');
    expect(textoLectura()).toBe('Se lee: $ 12.500');
    expect(describedBy()).toEqual(['campo-lectura']);
  });

  it('el campo obligatorio vacío, al salir: «Escribe el monto.» (y los km: «Escribe los kilómetros.»)', async () => {
    await montar({ kind: 'dinero' });
    await salir();
    expect(error()).toContain('Escribe el monto.');
    expect(lectura()).toBeNull();
    await montar({ kind: 'km', allowZero: true });
    await salir();
    expect(error()).toContain('Escribe los kilómetros.');
  });

  it('un error de AFUERA (p. ej. al enviar) convive con la línea: la línea, primero; el error, después', async () => {
    await montar({ kind: 'dinero', error: 'Revisa este monto.', inicial: '12500' });
    expect(textoLectura()).toBe('Se lee: $ 12.500');
    expect(error()).toContain('Revisa este monto.');
    expect(describedBy()).toEqual(['campo-lectura', 'campo-error']);
    const orden = Array.from(container.querySelectorAll('#campo-lectura, #campo-error')).map((el) => el.id);
    expect(orden).toEqual(['campo-lectura', 'campo-error']);
  });

  it('el «$» y los espacios se quitan: «$ 12.500,00» queda como «12.500,00»', async () => {
    await montar({ kind: 'dinero' });
    await escribir('$ 12.500,00');
    expect(input().value).toBe('12.500,00');
    expect(textoLectura()).toBe('Se lee: $ 12.500');
  });
});

// Lo que no es un número se RECHAZA con aviso (antes se descartaba en silencio: «IVA 21% $ 1500» quedaba como «211500»).
// Se toleran el «$» y los espacios (también el que no corta línea). El formulario nunca recibe el texto rechazado.
describe('NumberField: rechaza lo que no es número y avisa «solo números»', () => {
  const MENSAJE_DINERO = 'Escribe solo números. Ej.: 12500 o 12500,50.';
  const MENSAJE_KM = 'Escribe solo números. Ej.: 45230.';
  const MENSAJE_GENERAL = 'Escribe solo números, con coma o punto para los decimales.';
  const invalido = () => input().getAttribute('aria-invalid');

  it('(a) pegar «IVA 21% $ 1500» en dinero: el campo no cambia, avisa exactamente y el formulario no recibe nada', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    await escribir('IVA 21% $ 1500');
    expect(input().value).toBe('');
    expect(error()).toBe(MENSAJE_DINERO);
    expect(invalido()).toBe('true');
    expect(describedBy()).toEqual(['campo-error']);
    expect(lectura()).toBeNull();
    expect(recibidos).toEqual([]);
    // En especial: no queda «211500» (los dígitos pegados) ni en el campo ni en lo que recibió el formulario.
    expect(input().value).not.toContain('211500');
  });

  it('(a) escrito de a un carácter: la primera letra ya se rechaza y lo que sigue no entra mientras haya letras', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    await escribir('I');
    expect(input().value).toBe('');
    expect(error()).toBe(MENSAJE_DINERO);
    expect(invalido()).toBe('true');
    await escribir('IV');
    await escribir('IVA');
    await escribir('IVA 2');
    expect(input().value).toBe('');
    expect(recibidos).toEqual([]);
    expect(error()).toBe(MENSAJE_DINERO);
  });

  it('(b) kilómetros: el ejemplo de los km', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'km', allowZero: true, optional: true, unit: 'km', recibidos });
    await escribir('45.230 km');
    expect(input().value).toBe('');
    expect(error()).toBe(MENSAJE_KM);
    expect(invalido()).toBe('true');
    expect(recibidos).toEqual([]);
  });

  it('(b) litros, precio por litro y campo sin tipo: el mensaje general', async () => {
    for (const kind of ['litros', 'precioLitro', undefined] as const) {
      const recibidos: string[] = [];
      await montar({ kind, unit: 'L', recibidos });
      await escribir('40 litros');
      expect(input().value, String(kind)).toBe('');
      expect(error(), String(kind)).toBe(MENSAJE_GENERAL);
      expect(invalido(), String(kind)).toBe('true');
      expect(recibidos, String(kind)).toEqual([]);
    }
  });

  it('(c) «$ 1.500,50» y «$ 12.500» se aceptan y llegan limpios al formulario', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    await escribir('$ 1.500,50');
    expect(input().value).toBe('1.500,50');
    expect(error()).toBe('');
    expect(invalido()).toBeNull();
    expect(textoLectura()).toBe('Se lee: $ 1.500,50');
    await escribir('$ 12.500');
    expect(input().value).toBe('12.500');
    expect(textoLectura()).toBe('Se lee: $ 12.500');
    expect(recibidos).toEqual(['1.500,50', '12.500']);
  });

  it('(c) el espacio que no corta línea (el que arma formatMoney) y los espacios de cualquier lado se quitan', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    await escribir('$\xa012.500');
    await escribir(' 12.500 ');
    await escribir('12 500');
    await escribir('$\xa0 1 234,5\n');
    await escribir('\t$');
    expect(recibidos).toEqual(['12.500', '12.500', '12500', '1234,5', '']);
    expect(error()).toBe('');
  });

  it('(c) también en km: «452.310» con espacios alrededor se limpia igual', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'km', allowZero: true, optional: true, recibidos });
    await escribir(' 452.310 ');
    expect(recibidos).toEqual(['452.310']);
    expect(textoLectura()).toBe('Se lee: 452.310 km');
  });

  it('(c) las marcas invisibles de un texto copiado de WhatsApp o de una web (ancho cero, dirección) se quitan y no cuentan como «no es número»', async () => {
    const marcas = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069].map((codigo) =>
      String.fromCharCode(codigo),
    );
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    for (const marca of marcas) {
      await escribir(`${marca}$ 12.500${marca}`);
      expect(error(), `U+${marca.charCodeAt(0).toString(16)}`).toBe('');
    }
    expect(recibidos).toEqual(marcas.map(() => '12.500'));
    // Con una marca invisible y una letra de verdad, igual se rechaza.
    await escribir(`${marcas[1]}IVA 21%`);
    expect(error()).toBe(MENSAJE_DINERO);
    expect(input().value).toBe('12.500');
  });

  it('(c) los separadores de línea y de párrafo, el espacio ideográfico, el angosto y la marca de orden de bytes son espacios: se quitan', async () => {
    const espacios = [0x2028, 0x2029, 0x3000, 0x202f, 0xfeff].map((codigo) => String.fromCharCode(codigo));
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    for (const espacio of espacios) {
      await escribir(`${espacio}$${espacio}12.500${espacio}`);
      expect(error(), `U+${espacio.charCodeAt(0).toString(16)}`).toBe('');
    }
    expect(recibidos).toEqual(espacios.map(() => '12.500'));
  });

  it('(c) no se cuelan como adorno los guiones, el signo menos ni otros invisibles que no son marcas de dirección: se rechazan', async () => {
    const rechazados = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe63, 0xff0d, 0x180e, 0x0085, 0x00ad, 0x2061, 0x2062, 0x2063, 0x2064].map(
      (codigo) => String.fromCharCode(codigo),
    );
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    await escribir('12.500');
    for (const caracter of rechazados) {
      await escribir(`12${caracter}500`);
      expect(error(), `U+${caracter.charCodeAt(0).toString(16)}`).toBe(MENSAJE_DINERO);
      expect(input().value).toBe('12.500');
    }
    expect(recibidos).toEqual(['12.500']);
  });

  it('(d) el aviso se va con el siguiente cambio válido', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    await escribir('abc');
    expect(error()).toBe(MENSAJE_DINERO);
    await escribir('1');
    expect(error()).toBe('');
    expect(invalido()).toBeNull();
    expect(describedBy()).toEqual(['campo-lectura']);
    expect(recibidos).toEqual(['1']);
  });

  it('(d) también se va al salir del campo, aunque lo escrito siga igual', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', inicial: '12.500', recibidos });
    await escribir('12.500%');
    expect(error()).toBe(MENSAJE_DINERO);
    await salir();
    expect(error()).toBe('');
    expect(invalido()).toBeNull();
    expect(input().value).toBe('12.500');
    expect(recibidos).toEqual([]);
  });

  it('(d) un cambio vacío (borrar todo) es válido y también limpia el aviso', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', inicial: '12', recibidos });
    await escribir('12a');
    expect(error()).toBe(MENSAJE_DINERO);
    await escribir('');
    expect(recibidos).toEqual(['']);
    expect(error()).toBe('');
  });

  it('(e) con un error del formulario presente, el aviso de rechazo GANA; al limpiarse vuelve a verse el del formulario', async () => {
    await montar({ kind: 'dinero', error: 'Revisa este monto.', inicial: '12500' });
    expect(error()).toContain('Revisa este monto.');
    await escribir('12500x');
    expect(error()).toBe(MENSAJE_DINERO);
    expect(error()).not.toContain('Revisa este monto.');
    expect(invalido()).toBe('true');
    expect(describedBy()).toEqual(['campo-lectura', 'campo-error']);
    // Un cambio válido (otro texto: con el mismo el navegador no avisa nada): vuelve el error de afuera.
    await escribir('1250');
    expect(error()).toContain('Revisa este monto.');
    expect(error()).not.toContain('solo números');
    // Y al salir del campo también.
    await escribir('1250x');
    expect(error()).toBe(MENSAJE_DINERO);
    await salir();
    expect(error()).toContain('Revisa este monto.');
  });

  it('(e) también gana sobre el error propio del campo (el de «Usa hasta 2 decimales»)', async () => {
    await montar({ kind: 'dinero', inicial: '12,505' });
    await salir();
    expect(error()).toContain('Usa hasta 2 decimales.');
    await escribir('12,505x');
    expect(error()).toBe(MENSAJE_DINERO);
    await salir();
    expect(error()).toContain('Usa hasta 2 decimales.');
  });

  it('(f) «-12.500», «−12.500» (menos tipográfico), «1e3», «٣» (dígito árabe), «１２» (ancho completo) y otros símbolos se rechazan', async () => {
    const recibidos: string[] = [];
    const casos = [
      '-12.500',
      `${String.fromCharCode(0x2212)}12.500`,
      '1e3',
      String.fromCharCode(0x663),
      String.fromCharCode(0xff11, 0xff12),
      '12%',
      '12,5 pesos',
      '+5',
      '1_000',
      '12/5',
      '(500)',
      '€ 500',
    ];
    await montar({ kind: 'dinero', recibidos });
    for (const caso of casos) {
      await escribir(caso);
      expect(input().value, caso).toBe('');
      expect(error(), caso).toBe(MENSAJE_DINERO);
      expect(invalido(), caso).toBe('true');
    }
    expect(recibidos).toEqual([]);
  });

  it('(g) con texto ya escrito («12.500»), pegar algo que no es número NO lo pisa ni lo borra', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', inicial: '12.500', recibidos });
    await escribir('IVA 21% $ 1500');
    expect(input().value).toBe('12.500');
    await escribir('12.500abc');
    expect(input().value).toBe('12.500');
    await escribir('abc');
    expect(input().value).toBe('12.500');
    await escribir('-12.500');
    expect(input().value).toBe('12.500');
    expect(recibidos).toEqual([]);
    expect(error()).toBe(MENSAJE_DINERO);
    // Y lo escrito sigue leyéndose igual.
    expect(textoLectura()).toBe('Se lee: $ 12.500');
  });

  it('(g) la letra en el medio de un número ya escrito tampoco lo cambia', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'km', allowZero: true, optional: true, inicial: '452310', recibidos });
    await escribir('452x310');
    expect(input().value).toBe('452310');
    expect(recibidos).toEqual([]);
    expect(textoLectura()).toBe('Se lee: 452.310 km');
  });

  it('el tope de 20 caracteres sigue cortando en silencio los dígitos de más (sin aviso)', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    await escribir('1'.repeat(25));
    expect(input().value).toBe('1'.repeat(20));
    expect(recibidos).toEqual(['1'.repeat(20)]);
    expect(error()).toBe('');
    expect(invalido()).toBeNull();
  });

  it('el tope se cuenta DESPUÉS de sacar el «$» y los espacios (no se pierden dígitos al pegar «$ 9.999.999.999,99»)', async () => {
    const recibidos: string[] = [];
    await montar({ kind: 'dinero', recibidos });
    await escribir('$ 9.999.999.999,99');
    expect(recibidos).toEqual(['9.999.999.999,99']);
    // Más de 20 caracteres CRUDOS pero menos de 20 ya sin espacios: no se pierde ningún dígito.
    await escribir(' 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 ');
    expect(recibidos).toEqual(['9.999.999.999,99', '123456789012345']);
    expect(input().value).toBe('123456789012345');
  });

  it('el aviso no depende de haber salido del campo ni de que el campo sea obligatorio', async () => {
    await montar({ kind: 'dinero', optional: true });
    await escribir('abc');
    expect(error()).toBe(MENSAJE_DINERO);
    await escribir('12');
    expect(error()).toBe('');
  });
});
