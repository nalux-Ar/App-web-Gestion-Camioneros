import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ChoiceGroup } from './choice-group';
import { FieldShell } from './field-shell';

// Etiquetas, ayudas, errores y descripciones de los componentes comunes: 16 px (text-base), no 14 px. Un solo cambio acá llega a
// todas las pantallas. Los COLORES no cambian: la ayuda sigue en el color de apoyo y el error en el de error.

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

const sinTextoChico = (el: Element | null) => {
  expect(el, 'el elemento existe').not.toBeNull();
  expect(el!.className).toContain('text-base');
  expect(el!.className).not.toMatch(/\btext-(xs|sm)\b/);
};

describe('texto de apoyo de los componentes comunes: 16 px', () => {
  it('Label, CardDescription y Alert con su descripción', async () => {
    await act(async () => {
      root.render(
        <div>
          <Label>Nombre</Label>
          <CardDescription>Una descripción</CardDescription>
          <Alert>
            <AlertDescription>Gasto guardado.</AlertDescription>
          </Alert>
        </div>,
      );
    });
    sinTextoChico(container.querySelector('[data-slot="label"]'));
    sinTextoChico(container.querySelector('[data-slot="card-description"]'));
    sinTextoChico(container.querySelector('[data-slot="alert"]'));
    sinTextoChico(container.querySelector('[data-slot="alert-description"]'));
    // El color de la descripción no cambió.
    expect(container.querySelector('[data-slot="card-description"]')!.className).toContain('text-muted-foreground');
  });

  it('FieldShell: etiqueta, ayuda y error (cada uno en su color de siempre)', async () => {
    await act(async () => {
      root.render(
        <FieldShell id="campo" label="Kilometraje" optional hint="Sin puntos ni comas." error="Escribe un número.">
          {(control) => <input {...control} />}
        </FieldShell>,
      );
    });
    sinTextoChico(container.querySelector('label'));
    const ayuda = container.querySelector('#campo-hint');
    sinTextoChico(ayuda);
    expect(ayuda!.className).toContain('text-muted-foreground');
    const error = container.querySelector('#campo-error p');
    sinTextoChico(error);
    expect(error!.className).toContain('text-destructive-text');
    // El ícono del error (16 px) queda centrado con la primera línea de 24 px.
    expect(error!.querySelector('svg')!.getAttribute('class')).toContain('mt-1');
  });

  it('ChoiceGroup: leyenda, ayuda y error', async () => {
    await act(async () => {
      root.render(
        <ChoiceGroup
          id="tipo"
          legend="Método de pago"
          value=""
          onChange={() => {}}
          options={[
            { value: 'efectivo', label: 'Efectivo' },
            { value: 'tarjeta', label: 'Tarjeta' },
          ]}
          hint="Elige uno."
          error="Elige un método."
        />,
      );
    });
    sinTextoChico(container.querySelector('legend'));
    const ayuda = container.querySelector('#tipo-hint');
    sinTextoChico(ayuda);
    expect(ayuda!.className).toContain('text-muted-foreground');
    const error = container.querySelector('#tipo-error p');
    sinTextoChico(error);
    expect(error!.className).toContain('text-destructive-text');
    // Las opciones ya eran de 16 px y siguen igual.
    expect(container.querySelector('label span')!.className).toContain('text-base');
  });
});
