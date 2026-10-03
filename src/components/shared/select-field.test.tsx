import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectField, type SelectGroup, type SelectOption } from '@/components/shared/select-field';

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

const OPCIONES: SelectOption[] = [
  { value: 'a', label: 'Opción A' },
  { value: 'b', label: 'Opción B', disabled: true },
];
const GRUPOS: SelectGroup[] = [
  { label: 'Primero', options: [{ value: 'g1', label: 'Uno' }, { value: 'g2', label: 'Dos' }] },
  { label: 'Segundo', options: [{ value: 'g3', label: 'Tres' }] },
];

async function render(props: Partial<Parameters<typeof SelectField>[0]> = {}) {
  const onChange = vi.fn();
  await act(async () => {
    root.render(<SelectField id="campo" label="Campo" value="" onChange={onChange} options={OPCIONES} {...props} />);
  });
  return { onChange, select: container.querySelector('select')! };
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

describe('SelectField', () => {
  it('sin grupos es el de siempre: opciones sueltas (con su "disabled"), sin <optgroup>', async () => {
    const { select } = await render({ placeholder: 'Elige' });
    expect(select.querySelectorAll('optgroup')).toHaveLength(0);
    expect([...select.options].map((o) => o.textContent)).toEqual(['Elige', 'Opción A', 'Opción B']);
    expect(select.options[2]!.disabled).toBe(true);
  });

  it('con `groups` agrupa en <optgroup> con su título, en el orden dado', async () => {
    const { select } = await render({ options: [], groups: GRUPOS, placeholder: 'Elige' });
    const grupos = [...select.querySelectorAll('optgroup')];
    expect(grupos.map((g) => g.label)).toEqual(['Primero', 'Segundo']);
    expect(grupos.map((g) => [...g.querySelectorAll('option')].map((o) => o.value))).toEqual([['g1', 'g2'], ['g3']]);
    // El placeholder queda primero, fuera de los grupos.
    expect(select.options[0]!.textContent).toBe('Elige');
    expect(select.options[0]!.parentElement).toBe(select);
  });

  it('las opciones sueltas van antes de los grupos', async () => {
    const { select } = await render({ groups: GRUPOS });
    const hijos = [...select.children].map((el) => el.tagName);
    expect(hijos).toEqual(['OPTION', 'OPTION', 'OPTGROUP', 'OPTGROUP']);
  });

  it('elegir una opción de un grupo llama a onChange con su valor', async () => {
    const { select, onChange } = await render({ options: [], groups: GRUPOS });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'g3');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('g3');
  });

  it('muestra seleccionada la opción de un grupo cuando el valor coincide', async () => {
    const { select } = await render({ options: [], groups: GRUPOS, value: 'g2' });
    expect(select.value).toBe('g2');
    expect(select.selectedOptions[0]!.textContent).toBe('Dos');
  });

  it('un grupo vacío es un <optgroup> sin opciones (quien lo arma no lo debe pasar); no rompe nada', async () => {
    const { select } = await render({ options: [], groups: [{ label: 'Vacío', options: [] }] });
    expect(select.querySelectorAll('optgroup')).toHaveLength(1);
    expect(select.options).toHaveLength(0);
  });

  it('conserva el enlace con la etiqueta, la ayuda y el error', async () => {
    const { select } = await render({ options: [], groups: GRUPOS, hint: 'Una ayuda', error: 'Un error' });
    expect(container.querySelector('label[for="campo"]')!.textContent).toBe('Campo');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')).toBe('campo-hint campo-error');
    expect(container.querySelector('#campo-error')!.textContent).toBe('Un error');
  });
});
