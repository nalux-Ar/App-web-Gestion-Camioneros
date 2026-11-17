import { act, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatNumber } from '@/lib/numbers';
import type { Categoria } from './categorias';
import type { GastoDeFila } from './gastos-api';
import { GastosParaElegir, GastosQueNoSeEligen } from './gastos-para-elegir';

// Las filas de gastos que se eligen (casillas) y las que NO se pueden elegir (con su motivo). Piezas sueltas, sin pantalla: reciben
// qué está marcado y avisan qué casilla se tocó; sirven a «Sumar gastos que ya cargué» y servirán a «Quitar».

const A = 'e1000000-0000-4000-8000-00000000000a';
const B = 'e1000000-0000-4000-8000-00000000000b';
const C = 'e1000000-0000-4000-8000-00000000000c';
const PEAJES = 'a1000000-0000-4000-8000-000000000001';
const LAVADO = 'a1000000-0000-4000-8000-000000000002';

const CATEGORIAS = new Map<string, Categoria>([
  [PEAJES, { id: PEAJES, nombre: 'Peajes', activa: true, transportista_id: null }],
  [LAVADO, { id: LAVADO, nombre: 'Lavado', activa: false, transportista_id: 'tenant-a' }],
]);

const gasto = (id: string, over: Partial<GastoDeFila> = {}): GastoDeFila => ({
  id,
  categoria_id: PEAJES,
  fecha: '2026-06-15',
  monto: 1000,
  descripcion: null,
  litros: null,
  camion_id: null,
  created_at: '2026-11-01T10:00:00+00:00',
  ...over,
});

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

async function dibujar(elemento: ReactElement) {
  await act(async () => {
    root.render(elemento);
  });
}

const casillas = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const filaDe = (c: HTMLInputElement) => c.closest('label')!.querySelector('span')!;
const recuadroDe = (c: HTMLInputElement) => c.closest('label')!.querySelector<HTMLElement>('span > span[aria-hidden="true"]')!;

describe('GastosParaElegir', () => {
  const props = (over: Partial<ComponentProps<typeof GastosParaElegir>> = {}): ComponentProps<typeof GastosParaElegir> => ({
    gastos: [gasto(A), gasto(B, { monto: 2500.5, descripcion: 'peaje norte' }), gasto(C, { categoria_id: LAVADO })],
    categoriasPorId: CATEGORIAS,
    marcados: new Set<string>(),
    onAlternar: () => {},
    etiqueta: 'Gastos sin viaje',
    ...over,
  });

  it('una casilla por gasto, en el orden recibido, y NINGUNA marcada si no se marcó ninguna', async () => {
    await dibujar(<GastosParaElegir {...props()} />);
    expect(casillas()).toHaveLength(3);
    expect(casillas().every((c) => !c.checked)).toBe(true);
    expect(casillas().map((c) => c.closest('label')!.textContent)).toEqual([
      `Peajes15 jun 2026${formatNumber(1000, { decimales: 2 })}`,
      `Peajes15 jun 2026peaje norte${formatNumber(2500.5, { decimales: 2 })}`,
      `Lavado (inactiva)15 jun 2026${formatNumber(1000, { decimales: 2 })}`,
    ]);
  });

  it('lo que está en `marcados` sale marcado, y se ve el tilde, el borde y el fondo del tema (no solo el color)', async () => {
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([B]) })} />);
    expect(casillas().map((c) => c.checked)).toEqual([false, true, false]);
    expect(recuadroDe(casillas()[1]!).querySelector('svg')).not.toBeNull();
    expect(recuadroDe(casillas()[0]!).querySelector('svg')).toBeNull();
    expect(filaDe(casillas()[1]!).className).toContain('border-primary');
    expect(filaDe(casillas()[1]!).className).toContain('bg-primary/10');
    expect(filaDe(casillas()[0]!).className).toContain('border-border');
  });

  it('es controlado: lo que se ve sigue a `marcados` (no guarda su propio estado)', async () => {
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([A]) })} />);
    expect(casillas().map((c) => c.checked)).toEqual([true, false, false]);
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([C]) })} />);
    expect(casillas().map((c) => c.checked)).toEqual([false, false, true]);
    await dibujar(<GastosParaElegir {...props()} />);
    expect(casillas().every((c) => !c.checked)).toBe(true);
  });

  it('tocar una casilla avisa con el id de SU gasto, una sola vez', async () => {
    const onAlternar = vi.fn();
    await dibujar(<GastosParaElegir {...props({ onAlternar })} />);
    await act(async () => {
      casillas()[1]!.click();
    });
    expect(onAlternar).toHaveBeenCalledTimes(1);
    expect(onAlternar).toHaveBeenCalledWith(B);
  });

  it('TODA la fila es la zona que se toca: tocar el texto de la fila también marca', async () => {
    const onAlternar = vi.fn();
    await dibujar(<GastosParaElegir {...props({ onAlternar })} />);
    const texto = [...casillas()[2]!.closest('label')!.querySelectorAll('span')].find((s) => s.textContent === 'Lavado (inactiva)')!;
    await act(async () => {
      texto.click();
    });
    expect(onAlternar).toHaveBeenCalledTimes(1);
    expect(onAlternar).toHaveBeenCalledWith(C);
  });

  it('deshabilitado: ninguna casilla se puede tocar y no avisa nada', async () => {
    const onAlternar = vi.fn();
    await dibujar(<GastosParaElegir {...props({ onAlternar, deshabilitado: true })} />);
    expect(casillas().every((c) => c.disabled)).toBe(true);
    await act(async () => {
      casillas()[0]!.click();
    });
    expect(onAlternar).not.toHaveBeenCalled();
    expect(filaDe(casillas()[0]!).className).toContain('peer-disabled:opacity-50');
  });

  it('habilitado por defecto', async () => {
    await dibujar(<GastosParaElegir {...props()} />);
    expect(casillas().every((c) => !c.disabled)).toBe(true);
  });

  it('sin cupo (se llegó al tope por vez): se apagan SOLO las casillas sin marcar; las marcadas siguen activas y se pueden desmarcar', async () => {
    const onAlternar = vi.fn();
    await dibujar(<GastosParaElegir {...props({ onAlternar, marcados: new Set([B]), sinCupo: true })} />);
    expect(casillas().map((c) => c.disabled)).toEqual([true, false, true]);
    // la apagada se ve apagada (opacidad y cursor de «no se puede») y tocarla no avisa nada
    expect(filaDe(casillas()[0]!).className).toContain('peer-disabled:opacity-50');
    expect(filaDe(casillas()[0]!).className).toContain('peer-disabled:cursor-not-allowed');
    await act(async () => {
      casillas()[0]!.click();
    });
    expect(onAlternar).not.toHaveBeenCalled();
    // la marcada se puede desmarcar
    await act(async () => {
      casillas()[1]!.click();
    });
    expect(onAlternar).toHaveBeenCalledTimes(1);
    expect(onAlternar).toHaveBeenCalledWith(B);
  });

  it('sin cupo y sin ninguna marcada (un tope de 0): todas apagadas', async () => {
    await dibujar(<GastosParaElegir {...props({ sinCupo: true })} />);
    expect(casillas().every((c) => c.disabled)).toBe(true);
  });

  it('con cupo (por defecto y con `sinCupo: false`) no se apaga ninguna por esto, tenga o no marcadas', async () => {
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([A, B]), sinCupo: false })} />);
    expect(casillas().every((c) => !c.disabled)).toBe(true);
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([A, B]) })} />);
    expect(casillas().every((c) => !c.disabled)).toBe(true);
  });

  it('deshabilitado (mientras se envía) apaga TAMBIÉN las marcadas aunque haya cupo; con `sinCupo` a la vez, todas', async () => {
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([B]), deshabilitado: true })} />);
    expect(casillas().every((c) => c.disabled)).toBe(true);
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([B]), deshabilitado: true, sinCupo: true })} />);
    expect(casillas().every((c) => c.disabled)).toBe(true);
  });

  it('es un grupo con nombre: `fieldset` + `legend` solo para el lector de pantalla', async () => {
    await dibujar(<GastosParaElegir {...props({ etiqueta: 'Gastos del viaje' })} />);
    const grupo = container.querySelector('fieldset')!;
    expect(grupo.className).toContain('min-w-0'); // un `fieldset` no se achica solo: sin esto empuja el ancho a 360 px
    expect(grupo.querySelector('legend')!.textContent).toBe('Gastos del viaje');
    expect(grupo.querySelector('legend')!.className).toContain('sr-only');
  });

  it('la categoría que no está en el mapa se ve como «Gasto»; una inactiva, con «(inactiva)»', async () => {
    await dibujar(<GastosParaElegir {...props({ gastos: [gasto(A, { categoria_id: 'a1000000-0000-4000-8000-0000000000ff' }), gasto(B, { categoria_id: LAVADO })] })} />);
    expect(casillas()[0]!.closest('label')!.textContent).toMatch(/^Gasto15 jun 2026/);
    expect(casillas()[1]!.closest('label')!.textContent).toMatch(/^Lavado \(inactiva\)/);
  });

  it('la fecha lleva el año; con `infinity`, `-infinity` o un año de cinco cifras se ve tal cual y NO rompe el dibujo', async () => {
    await dibujar(
      <GastosParaElegir
        {...props({
          gastos: [gasto(A, { fecha: 'infinity' }), gasto(B, { fecha: '-infinity' }), gasto(C, { fecha: '10000-01-01' }), gasto('e1000000-0000-4000-8000-00000000000d', { fecha: '2025-01-02' })],
        })}
      />,
    );
    const textos = casillas().map((c) => c.closest('label')!.textContent);
    expect(textos[0]).toContain('infinity');
    expect(textos[1]).toContain('-infinity');
    expect(textos[2]).toContain('10000-01-01');
    expect(textos[3]).toContain('2 ene 2025');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('el monto va sin símbolo de moneda, con decimales y en cifras alineadas (`tabular-nums`)', async () => {
    await dibujar(<GastosParaElegir {...props({ gastos: [gasto(A, { monto: 12345.5 })] })} />);
    const monto = [...container.querySelectorAll('label span')].find((s) => s.textContent === formatNumber(12345.5, { decimales: 2 }))!;
    expect(monto.textContent).not.toContain('$');
    expect(monto.className).toContain('tabular-nums');
    expect(monto.className).toContain('shrink-0'); // el monto no se parte: lo que cede es el texto de al lado
  });

  it('la descripción: a dos líneas, partida donde haga falta (`[overflow-wrap:anywhere]`) y sin `block` (que desharía el `line-clamp`); sin descripción no hay línea', async () => {
    await dibujar(<GastosParaElegir {...props({ gastos: [gasto(A, { descripcion: 'x'.repeat(500) }), gasto(B)] })} />);
    const descripcion = [...container.querySelectorAll<HTMLElement>('label span')].find((s) => s.textContent === 'x'.repeat(500))!;
    expect(descripcion.className).toContain('line-clamp-2');
    expect(descripcion.className).toContain('[overflow-wrap:anywhere]');
    expect(descripcion.className.split(/\s+/)).not.toContain('block');
    expect(casillas()[1]!.closest('label')!.querySelectorAll('.line-clamp-2')).toHaveLength(0);
  });

  it('una descripción con HTML se muestra como texto', async () => {
    await dibujar(<GastosParaElegir {...props({ gastos: [gasto(A, { descripcion: '<img src=x onerror=alert(1)>' })] })} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('tamaños: la fila mide 64 px o más, la casilla se ve de 28 px y el texto es de 16 px (nada de `text-sm` ni `text-xs`)', async () => {
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([A]) })} />);
    for (const c of casillas()) {
      expect(filaDe(c).className).toContain('min-h-16');
      expect(recuadroDe(c).className).toContain('size-7');
    }
    expect(container.querySelectorAll('[class*="text-sm"], [class*="text-xs"]')).toHaveLength(0);
  });

  it('la casilla de verdad está fuera de la vista (`sr-only`) pero es nativa: tiene teclado, foco con anillo visible y nombre accesible', async () => {
    await dibujar(<GastosParaElegir {...props()} />);
    const casilla = casillas()[1]!;
    expect(casilla.type).toBe('checkbox');
    expect(casilla.className).toContain('sr-only');
    expect(casilla.className).toContain('peer');
    expect(filaDe(casilla).className).toContain('peer-focus-visible:ring-2');
    expect(casilla.closest('label')!.textContent).toContain('peaje norte'); // el nombre accesible sale de la etiqueta que cubre la fila
  });

  it('sin gastos: un grupo vacío, sin romper', async () => {
    await dibujar(<GastosParaElegir {...props({ gastos: [] })} />);
    expect(casillas()).toHaveLength(0);
    expect(container.querySelector('fieldset')).not.toBeNull();
  });

  it('solo clases del tema: ningún color de la paleta de Tailwind ni en hexadecimal', async () => {
    await dibujar(<GastosParaElegir {...props({ marcados: new Set([A]), deshabilitado: true })} />);
    const clases = [...container.querySelectorAll('[class]')].flatMap((el) => el.getAttribute('class')!.split(/\s+/));
    const paleta = /^(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|accent|outline|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d+)?(?:\/\d+)?$/;
    expect(clases.filter((c) => paleta.test(c) || /#[0-9a-f]{3,8}/i.test(c))).toEqual([]);
  });
});

describe('GastosQueNoSeEligen', () => {
  const gastos = [gasto(A, { descripcion: 'del otro camión', camion_id: 'c0000000-0000-4000-8000-000000000002' }), gasto(B, { categoria_id: LAVADO, monto: 77 })];

  it('sin casillas: cada gasto con su categoría, fecha, monto y el MOTIVO debajo', async () => {
    await dibujar(<GastosQueNoSeEligen gastos={gastos} categoriasPorId={CATEGORIAS} motivoDe={(g) => `Motivo de ${g.id.slice(-1)}`} />);
    expect(container.querySelectorAll('input')).toHaveLength(0);
    const items = [...container.querySelectorAll('li')];
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Peajes');
    expect(items[0]!.textContent).toContain('15 jun 2026');
    expect(items[0]!.textContent).toContain('del otro camión');
    expect(items[0]!.textContent).toContain(formatNumber(1000, { decimales: 2 }));
    expect(items[0]!.querySelector('p')!.textContent).toBe('Motivo de a');
    expect(items[1]!.textContent).toContain('Lavado (inactiva)');
    expect(items[1]!.querySelector('p')!.textContent).toBe('Motivo de b');
  });

  it('pide el motivo de cada gasto con ESE gasto', async () => {
    const motivoDe = vi.fn((g: GastoDeFila) => `M ${g.id}`);
    await dibujar(<GastosQueNoSeEligen gastos={gastos} categoriasPorId={CATEGORIAS} motivoDe={motivoDe} />);
    expect(motivoDe.mock.calls.map((c) => c[0].id)).toEqual([A, B]);
  });

  it('el motivo se parte donde haga falta y la fila mide 64 px o más', async () => {
    await dibujar(<GastosQueNoSeEligen gastos={gastos} categoriasPorId={CATEGORIAS} motivoDe={() => 'x'.repeat(300)} />);
    const motivo = container.querySelector('li p')!;
    expect(motivo.className).toContain('[overflow-wrap:anywhere]');
    expect(container.querySelector('li')!.className).toContain('min-h-16');
  });

  it('con una fecha rara se ve tal cual y no rompe', async () => {
    await dibujar(<GastosQueNoSeEligen gastos={[gasto(A, { fecha: 'infinity' })]} categoriasPorId={CATEGORIAS} motivoDe={() => 'x'} />);
    expect(container.textContent).toContain('infinity');
  });

  it('sin gastos: una lista vacía', async () => {
    await dibujar(<GastosQueNoSeEligen gastos={[]} categoriasPorId={CATEGORIAS} motivoDe={() => 'x'} />);
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
