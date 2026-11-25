import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChoiceGroup, type ChoiceOption } from '@/components/shared/choice-group';

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

const OPCIONES: ChoiceOption[] = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'credito', label: 'Tarjeta de crédito' },
  { value: 'debito', label: 'Tarjeta de débito' },
  { value: 'transferencia', label: 'Transferencia' },
];

type Props = Parameters<typeof ChoiceGroup>[0];

/** El grupo CONTROLADO, como lo usa una pantalla. */
function Controlado(props: Partial<Props>) {
  const [valor, setValor] = useState('');
  return <ChoiceGroup id="pago" legend="¿Cómo pagaste?" options={OPCIONES} {...props} value={valor} onChange={setValor} />;
}

async function render(props: Partial<Props> = {}) {
  await act(async () => {
    root.render(<Controlado {...props} />);
  });
}

const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
/** El contenedor de los botones (el que lleva la cuadrícula) y sus clases, una por una. */
const cuadricula = () => radios()[0]!.closest('label')!.parentElement!;
const clasesDeLaCuadricula = () => cuadricula().className.split(/\s+/);

/**
 * La cuadrícula de `apilarEnAngosto` con 2 columnas, clase por clase: columnas automáticas de MÍNIMO 9,75 rem (si no entran 2, queda una;
 * `rem` crece con la letra del teléfono, así que con letra grande también se apila) y, desde 480 px, 2 columnas fijas (para que `auto-fit`
 * nunca arme 3 + 1 en pantallas anchas). jsdom no mide layout: se fijan las clases.
 */
const CUADRICULA_ADAPTABLE = ['grid', 'gap-2', 'grid-cols-[repeat(auto-fit,minmax(9.75rem,1fr))]', 'min-[480px]:grid-cols-2'];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('ChoiceGroup: la cuadrícula de siempre (sin apilarEnAngosto)', () => {
  it('por defecto (sin columns) son 2 columnas pegadas, desde cualquier ancho: grid-cols-2 pelado', async () => {
    await render();
    expect(clasesDeLaCuadricula()).toEqual(['grid', 'gap-2', 'grid-cols-2']);
  });

  it.each([
    [1, 'grid-cols-1'],
    [2, 'grid-cols-2'],
    [3, 'grid-cols-3'],
  ] as const)('columns=%i: exactamente «grid gap-2 %s», sin ninguna clase responsiva', async (columns, clase) => {
    await render({ columns });
    expect(clasesDeLaCuadricula()).toEqual(['grid', 'gap-2', clase]);
    expect(cuadricula().className).not.toContain('min-[');
    expect(cuadricula().className).not.toContain('auto-fit');
  });

  it('apilarEnAngosto={false} explícito es lo mismo que no pasarlo', async () => {
    await render({ columns: 2, apilarEnAngosto: false });
    expect(clasesDeLaCuadricula()).toEqual(['grid', 'gap-2', 'grid-cols-2']);
  });
});

describe('ChoiceGroup: apilarEnAngosto', () => {
  it('con columns=2: columnas automáticas de mínimo 9,75 rem (2×2 si entran, una columna si no) y 2 fijas desde 480 px, sin grid-cols-2 ni grid-cols-1 pelados', async () => {
    await render({ columns: 2, apilarEnAngosto: true });
    expect(clasesDeLaCuadricula()).toEqual(CUADRICULA_ADAPTABLE);
    expect(clasesDeLaCuadricula()).not.toContain('grid-cols-2');
    expect(clasesDeLaCuadricula()).not.toContain('grid-cols-1');
  });

  it('el mínimo está en rem (crece con la letra del teléfono), no en px: con letra grande también se apila', async () => {
    await render({ columns: 2, apilarEnAngosto: true });
    const columnas = clasesDeLaCuadricula().find((clase) => clase.startsWith('grid-cols-['))!;
    expect(columnas).toMatch(/^grid-cols-\[repeat\(auto-fit,minmax\(9\.75rem,1fr\)\)\]$/);
    expect(columnas).not.toMatch(/px/);
    // Sin espacios ni guiones bajos dentro de los corchetes: la clase se genera tal cual.
    expect(columnas).not.toMatch(/[\s_]/);
  });

  it('con columns omitido (que vale 2) también usa la cuadrícula que se acomoda sola', async () => {
    await render({ apilarEnAngosto: true });
    expect(clasesDeLaCuadricula()).toEqual(CUADRICULA_ADAPTABLE);
  });

  // Decisión de borde: la prop solo habla de la cuadrícula de 2. Con 1 columna ya está apilada; con 3 son rótulos cortos
  // (Sí / No / Sin indicar) y apilarlos agrandaría el formulario sin necesidad. Se ignora, sin avisos ni errores.
  it.each([
    [1, 'grid-cols-1'],
    [3, 'grid-cols-3'],
  ] as const)('con columns=%i la prop NO cambia nada: queda «grid gap-2 %s»', async (columns, clase) => {
    await render({ columns, apilarEnAngosto: true });
    expect(clasesDeLaCuadricula()).toEqual(['grid', 'gap-2', clase]);
  });

  it('lo único que cambia es la clase de la cuadrícula: botones, ids, estilo de cada botón y ARIA quedan idénticos', async () => {
    // `name` de los radios sale de useId (distinto en cada render): se normaliza. La clase de la cuadrícula se normaliza a un marcador.
    const normalizado = () =>
      container.innerHTML.replace(/ name="[^"]*"/g, '').replace(/class="grid gap-2 [^"]*"/, 'class="CUADRICULA"');
    await render({ columns: 2 });
    const sinProp = normalizado();
    await render({ columns: 2, apilarEnAngosto: true });
    const conProp = normalizado();
    expect(sinProp).toContain('class="CUADRICULA"');
    expect(conProp).toBe(sinProp);
  });

  it('cada botón sigue con su alto mínimo de 56 px, sin salirse de su columna y con el rótulo partible, también apilado', async () => {
    await render({ columns: 2, apilarEnAngosto: true });
    expect(radios()).toHaveLength(4);
    for (const radio of radios()) {
      const etiqueta = radio.closest('label')!;
      expect(etiqueta.className).toContain('min-w-0');
      expect(etiqueta.querySelector('span')!.className).toContain('min-h-14');
      expect(etiqueta.querySelector('span span')!.className).toContain('break-words');
    }
    expect(radios().map((radio) => radio.id)).toEqual(['pago-0', 'pago-1', 'pago-2', 'pago-3']);
  });

  it('elegir un botón sigue funcionando (un solo marcado a la vez)', async () => {
    await render({ columns: 2, apilarEnAngosto: true });
    await act(async () => {
      radios()[3]!.click();
    });
    expect(radios().map((radio) => radio.checked)).toEqual([false, false, false, true]);
    await act(async () => {
      radios()[0]!.click();
    });
    expect(radios().map((radio) => radio.checked)).toEqual([true, false, false, false]);
  });
});
