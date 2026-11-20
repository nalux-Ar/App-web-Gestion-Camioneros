import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MultiChoiceGroup, type MultiChoiceOption } from '@/components/shared/multi-choice-group';

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

const OPCIONES: MultiChoiceOption[] = [
  { value: 'comb', label: 'Combustible' },
  { value: 'varios', label: 'Gastos varios' },
  { value: 'peajes', label: 'Peajes' },
  { value: 'urea', label: 'Urea/AdBlue' },
];

type Props = Parameters<typeof MultiChoiceGroup>[0];

/** El grupo CONTROLADO, como lo usa una pantalla: quien lo usa guarda qué está marcado. */
function Controlado({ inicial = [], ...props }: Partial<Props> & { inicial?: string[] }) {
  const [marcados, setMarcados] = useState<readonly string[]>(inicial);
  return (
    <MultiChoiceGroup
      id="cat"
      legend="Categoría"
      options={OPCIONES}
      {...props}
      value={marcados}
      onToggle={(valor, marcada) => {
        props.onToggle?.(valor, marcada);
        setMarcados((previos) => (marcada ? [...previos, valor] : previos.filter((v) => v !== valor)));
      }}
    />
  );
}

async function render(props: Partial<Props> & { inicial?: string[] } = {}) {
  const onToggle = vi.fn();
  await act(async () => {
    root.render(<Controlado onToggle={onToggle} {...props} />);
  });
  return { onToggle };
}

const cajas = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const caja = (valor: string) => cajas().find((c) => c.value === valor)!;
const textoDe = (c: HTMLInputElement) => c.closest('label')!.textContent;
async function tocar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

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

describe('MultiChoiceGroup: estructura y accesibilidad', () => {
  it('es un fieldset con su legend y una casilla NATIVA por opción (no radios ni botones con ARIA)', async () => {
    await render();
    const grupo = container.querySelector('fieldset')!;
    expect(grupo.querySelector('legend')!.textContent).toBe('Categoría');
    expect(cajas()).toHaveLength(4);
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="checkbox"], [role="radio"], [role="group"]')).toHaveLength(0);
    expect(cajas().map(textoDe)).toEqual(['Combustible', 'Gastos varios', 'Peajes', 'Urea/AdBlue']);
  });

  it('cada casilla es la de su etiqueta (se toca el rótulo entero) y sus ids son ${id}-0, ${id}-1… (el foco de un error va a la primera)', async () => {
    await render();
    expect(cajas().map((c) => c.id)).toEqual(['cat-0', 'cat-1', 'cat-2', 'cat-3']);
    for (const c of cajas()) expect(c.closest('label')!.contains(c)).toBe(true);
  });

  it('NINGUNA viene marcada de entrada', async () => {
    await render();
    expect(cajas().some((c) => c.checked)).toBe(false);
  });

  it('puede venir con algunas marcadas', async () => {
    await render({ inicial: ['peajes', 'comb'] });
    expect(cajas().filter((c) => c.checked).map((c) => c.value)).toEqual(['comb', 'peajes']);
  });

  it('«(opcional)» solo si se pide', async () => {
    await render();
    expect(container.querySelector('legend')!.textContent).toBe('Categoría');
    await render({ optional: true });
    expect(container.querySelector('legend')!.textContent).toBe('Categoría (opcional)');
  });

  it('la ayuda queda enlazada al grupo (aria-describedby)', async () => {
    await render({ hint: 'Puedes marcar más de una.' });
    const grupo = container.querySelector('fieldset')!;
    const ayuda = container.querySelector('#cat-hint')!;
    expect(ayuda.textContent).toBe('Puedes marcar más de una.');
    expect(grupo.getAttribute('aria-describedby')).toBe('cat-hint');
  });

  it('el error lleva ícono + texto, vive en una región aria-live que siempre está, y marca las casillas como inválidas', async () => {
    await render();
    const region = container.querySelector('#cat-error')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    expect(cajas().every((c) => c.getAttribute('aria-invalid') === null)).toBe(true);

    await render({ error: 'Elige una categoría.' });
    const conError = container.querySelector('#cat-error')!;
    expect(conError.textContent).toBe('Elige una categoría.');
    expect(conError.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('fieldset')!.getAttribute('aria-describedby')).toContain('cat-error');
    expect(cajas().every((c) => c.getAttribute('aria-invalid') === 'true')).toBe(true);
  });

  it('con error el borde se pone del color de error (por variable), no solo el texto', async () => {
    await render({ error: 'mal' });
    const rotulo = caja('comb').nextElementSibling!;
    expect(rotulo.className).toContain('border-destructive');
  });
});

describe('MultiChoiceGroup: tamaño, aspecto y foco', () => {
  it('cada opción es un botón grande: 56 px o más de alto, texto de 16 px o más', async () => {
    await render();
    for (const c of cajas()) {
      const rotulo = c.nextElementSibling!;
      expect(rotulo.className).toContain('min-h-14'); // 56 px
      expect(rotulo.className).toContain('text-base'); // 16 px
    }
  });

  it('marcada se distingue por más que el color: borde grueso, TILDE, negrita y fondo', async () => {
    await render({ inicial: ['comb'] });
    const marcada = caja('comb').nextElementSibling!;
    expect(marcada.className).toContain('border-2');
    expect(marcada.className).toContain('peer-checked:font-semibold');
    expect(marcada.className).toContain('peer-checked:border-primary');
    expect(marcada.className).toContain('peer-checked:bg-primary/10');
    expect(marcada.querySelector('svg')).not.toBeNull(); // el tilde
    expect(caja('peajes').nextElementSibling!.querySelector('svg')).toBeNull(); // sin tilde si no está marcada
  });

  it('el foco se ve: un anillo alrededor del botón cuando la casilla (que no se ve) recibe el foco', async () => {
    await render();
    expect(caja('comb').className).toContain('sr-only');
    expect(caja('comb').className).toContain('peer');
    expect(caja('comb').nextElementSibling!.className).toContain('peer-focus-visible:ring-2');
    caja('comb').focus();
    expect(document.activeElement).toBe(caja('comb'));
  });

  it('ningún color escrito a mano: solo clases de las variables del tema', async () => {
    await render({ inicial: ['comb'], error: 'mal', hint: 'ayuda' });
    const html = container.innerHTML;
    expect(html).not.toMatch(/style="/);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/\b(?:bg|text|border|ring)-(?:red|green|blue|gray|slate|zinc|amber|yellow|white|black)(?:-\d+)?\b/);
  });
});

describe('MultiChoiceGroup: marcar y desmarcar', () => {
  it('tocar una casilla avisa cuál y que quedó marcada; tocarla de nuevo, que quedó desmarcada', async () => {
    const { onToggle } = await render();
    await tocar(caja('peajes'));
    expect(onToggle).toHaveBeenLastCalledWith('peajes', true);
    expect(caja('peajes').checked).toBe(true);
    await tocar(caja('peajes'));
    expect(onToggle).toHaveBeenLastCalledWith('peajes', false);
    expect(caja('peajes').checked).toBe(false);
  });

  it('se pueden marcar varias a la vez (no se desmarcan entre sí)', async () => {
    await render();
    await tocar(caja('comb'));
    await tocar(caja('peajes'));
    await tocar(caja('urea'));
    expect(cajas().filter((c) => c.checked).map((c) => c.value)).toEqual(['comb', 'peajes', 'urea']);
  });

  it('tocar el rótulo (no solo la casilla) también marca', async () => {
    await render();
    await tocar(caja('varios').closest('label')!);
    expect(caja('varios').checked).toBe(true);
  });
});

describe('MultiChoiceGroup: deshabilitado', () => {
  it('todo el grupo: el fieldset y todas las casillas quedan sin poder tocarse, y tocar no avisa nada', async () => {
    const { onToggle } = await render({ disabled: true });
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    for (const c of cajas()) expect(c.matches(':disabled')).toBe(true);
    await tocar(caja('comb'));
    expect(onToggle).not.toHaveBeenCalled();
    expect(caja('comb').checked).toBe(false);
  });

  it('una opción sola: esa no se puede tocar y las demás sí', async () => {
    const { onToggle } = await render({ options: [{ value: 'a', label: 'A', disabled: true }, { value: 'b', label: 'B' }] });
    expect(cajas().map((c) => c.disabled)).toEqual([true, false]);
    await tocar(caja('a'));
    expect(onToggle).not.toHaveBeenCalled();
    await tocar(caja('b'));
    expect(onToggle).toHaveBeenCalledWith('b', true);
  });

  it('las apagadas se ven apagadas (opacidad) y con el cursor de «no se puede»', async () => {
    await render({ options: [{ value: 'a', label: 'A', disabled: true }] });
    const rotulo = caja('a').nextElementSibling!;
    expect(rotulo.className).toContain('peer-disabled:opacity-50');
    expect(rotulo.className).toContain('peer-disabled:cursor-not-allowed');
  });
});

describe('MultiChoiceGroup: el tope de opciones marcadas', () => {
  const MUCHAS: MultiChoiceOption[] = Array.from({ length: 5 }, (_, i) => ({ value: `c${i}`, label: `Categoría ${i}` }));

  it('por debajo del tope todas se pueden tocar y no hay aviso', async () => {
    await render({ options: MUCHAS, max: 3, maxMessage: 'Máximo.', inicial: ['c0', 'c1'] });
    expect(cajas().every((c) => !c.disabled)).toBe(true);
    const aviso = container.querySelector('#cat-max')!;
    expect(aviso.textContent).toBe('');
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.className).toContain('sr-only'); // la región existe, pero no se ve ni ocupa lugar
  });

  it('al llegar al tope las que NO están marcadas se apagan; las marcadas siguen activas (para poder desmarcarlas)', async () => {
    await render({ options: MUCHAS, max: 3, maxMessage: 'Máximo.', inicial: ['c0', 'c1', 'c2'] });
    expect(cajas().map((c) => c.disabled)).toEqual([false, false, false, true, true]);
  });

  it('al llegar al tope se muestra el aviso en una región role="status", enlazada al grupo', async () => {
    await render({ options: MUCHAS, max: 3, maxMessage: 'Máximo.', inicial: ['c0', 'c1', 'c2'] });
    const aviso = container.querySelector('#cat-max')!;
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.textContent).toBe('Máximo.');
    expect(aviso.className).not.toContain('sr-only');
    expect(container.querySelector('fieldset')!.getAttribute('aria-describedby')).toContain('cat-max');
  });

  it('marcando de a una: la tercera apaga las otras; desmarcar una las vuelve a encender y el aviso se va', async () => {
    await render({ options: MUCHAS, max: 3, maxMessage: 'Máximo.' });
    await tocar(caja('c0'));
    await tocar(caja('c1'));
    expect(caja('c3').disabled).toBe(false);
    await tocar(caja('c2'));
    expect(caja('c3').disabled).toBe(true);
    expect(container.querySelector('#cat-max')!.textContent).toBe('Máximo.');
    await tocar(caja('c3')); // apagada: no hace nada
    expect(caja('c3').checked).toBe(false);
    await tocar(caja('c1'));
    expect(caja('c3').disabled).toBe(false);
    expect(container.querySelector('#cat-max')!.textContent).toBe('');
  });

  it('sin `max` no hay tope: se pueden marcar todas', async () => {
    await render({ options: MUCHAS });
    for (const c of cajas()) await tocar(c);
    expect(cajas().every((c) => c.checked && !c.disabled)).toBe(true);
  });

  it('con el tope pero sin texto de aviso, las opciones se apagan igual y no queda ningún texto visible', async () => {
    await render({ options: MUCHAS, max: 2, inicial: ['c0', 'c1'] });
    expect(caja('c4').disabled).toBe(true);
    expect(container.querySelector('#cat-max')!.textContent).toBe('');
  });
});
