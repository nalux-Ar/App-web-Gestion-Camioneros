import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La pantalla "Reportar un problema". Mock de supabase: registra cada método que se llama sobre cada tabla y responde según
// `h.responder`. TODO lo demás (la pantalla, la mutación, TanStack Query, el contexto, la última pantalla) es código REAL.
const h = vi.hoisted(() => {
  const llamadas: Array<{ tabla: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const estado = { responder: (() => ({ data: null, error: null, status: 201 })) as () => unknown };
  function from(tabla: string) {
    const llamada = { tabla, ops: [] as Array<{ m: string; args: unknown[] }> };
    llamadas.push(llamada);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'maybeSingle', 'single', 'abortSignal']) {
      b[m] = (...args: unknown[]) => {
        llamada.ops.push({ m, args });
        return b;
      };
    }
    b.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => estado.responder())
        .then(onF, onR);
    return b;
  }
  return { llamadas, estado, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { NETWORK_ERROR_MESSAGE } from '@/features/auth/auth-errors';
import { erroresRecientes, limpiarErroresRecientes, registrarErrorDeDatos } from '@/lib/errores-recientes';
import { queryClient } from '@/lib/query-client';
import { ReportarPage } from './reportar-page';
import { MAX_MENSAJE, MENSAJE_VACIO, PROBLEMA_DE_LA_APP, QUE_SE_ENVIA, textoMensajeLargo, TOPE_ALCANZADO } from './reportar-textos';
import { limpiarUltimaPantalla, registrarPantalla } from './ultima-pantalla';

type Resp = { data: unknown; error: unknown; status: number };
const ok = (): Resp => ({ data: null, error: null, status: 201 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
const yaEstaba = (): Resp => ({
  data: null,
  error: { code: '23505', message: 'duplicate key value violates unique constraint "reportes_transportista_client_ref_uidx"' },
  status: 409,
});
const tope = (): Resp => ({ data: null, error: { code: 'PT429', message: 'Llegaste al límite de 30 reportes en 24 horas (texto interno)' }, status: 429 });
const checkDeContexto = (): Resp => ({
  data: null,
  error: { code: '23514', message: 'new row for relation "reportes" violates check constraint "reportes_contexto_chk"' },
  status: 400,
});

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

function Ubicacion() {
  const location = useLocation();
  return <div id="ubicacion" data-ruta={`${location.pathname}${location.search}`} />;
}

async function settle(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reportar']}>
          <Routes>
            <Route path="/reportar" element={<ReportarPage />} />
            <Route path="*" element={<p id="otra-pantalla">otra</p>} />
          </Routes>
          <Ubicacion />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const byId = (id: string) => document.getElementById(id);
const campo = () => byId('reporte-mensaje') as HTMLTextAreaElement;
const boton = () => [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => /Enviar|Enviando|Reintentar/.test(b.textContent ?? ''));
const enviarBoton = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Enviar reporte') || b.textContent?.includes('Enviando'));
const reintentar = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Reintentar');
const contador = () => document.querySelector<HTMLElement>('[data-contador]')!;
const inserts = () => h.llamadas.filter((l) => l.tabla === 'reportes');
const enviado = (i = 0) => inserts()[i]!.ops.find((op) => op.m === 'insert')!.args[0] as Record<string, unknown>;
const textoPagina = () => container.textContent ?? '';

async function escribir(valor: string) {
  const el = campo();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle();
}

beforeEach(() => {
  h.llamadas.length = 0;
  h.estado.responder = ok;
  limpiarErroresRecientes();
  limpiarUltimaPantalla();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = (() => {}) as never;
  Element.prototype.scrollIntoView = (() => {}) as never;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  queryClient.clear();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('Reportar un problema: la pantalla', () => {
  it('título, frase, campo obligatorio con su ayuda y contador, qué se envía y el botón', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Reportar un problema');
    expect(textoPagina()).toContain('Cuéntanos qué pasó o qué se ve raro. Lo leemos nosotros.');
    expect(document.querySelector('label[for="reporte-mensaje"]')!.textContent).toBe('¿Qué pasó?');
    expect(campo().getAttribute('aria-required')).toBe('true');
    expect(campo().tagName).toBe('TEXTAREA');
    const ayuda = byId(campo().getAttribute('aria-describedby')!.split(' ')[0]!)!;
    expect(ayuda.textContent).toContain('No escribas contraseñas ni datos de otras personas.');
    expect(ayuda.textContent).toContain('0 de 2000 caracteres');
    expect(textoPagina()).toContain(QUE_SE_ENVIA);
    expect(enviarBoton()!.textContent).toBe('Enviar reporte');
    expect(enviarBoton()!.type).toBe('submit');
  });

  it('el contador cuenta lo que se va a enviar (sin los espacios de los extremos) y se marca al pasarse', async () => {
    await mount();
    await escribir('  hola  ');
    expect(contador().textContent).toBe('4 de 2000 caracteres');
    expect(contador().className).not.toContain('text-destructive-text');
    await escribir('a'.repeat(MAX_MENSAJE + 1));
    expect(contador().textContent).toBe('2001 de 2000 caracteres');
    expect(contador().className).toContain('text-destructive-text');
  });

  it('vacío: no se envía; el error en el campo y el foco ahí', async () => {
    await mount();
    await click(enviarBoton());
    expect(inserts()).toHaveLength(0);
    expect(textoPagina()).toContain(MENSAJE_VACIO);
    expect(campo().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(campo());
  });

  it('solo espacios y saltos de línea: tampoco', async () => {
    await mount();
    await escribir('   \n\n  ');
    await click(enviarBoton());
    expect(inserts()).toHaveLength(0);
    expect(textoPagina()).toContain(MENSAJE_VACIO);
  });

  it(`${MAX_MENSAJE + 1} caracteres: no se envía y dice cuántos tiene; con ${MAX_MENSAJE}, sí`, async () => {
    await mount();
    await escribir('a'.repeat(MAX_MENSAJE + 1));
    await click(enviarBoton());
    expect(inserts()).toHaveLength(0);
    expect(textoPagina()).toContain(textoMensajeLargo(MAX_MENSAJE + 1));
    expect(campo().value).toHaveLength(MAX_MENSAJE + 1); // no se recorta lo escrito
    await escribir('a'.repeat(MAX_MENSAJE));
    expect(textoPagina()).not.toContain(textoMensajeLargo(MAX_MENSAJE + 1)); // escribir borra el error del campo
    await click(enviarBoton());
    expect(inserts()).toHaveLength(1);
    expect(enviado().mensaje).toHaveLength(MAX_MENSAJE);
  });
});

describe('Reportar un problema: el envío', () => {
  it('manda el mensaje recortado, la última pantalla, el contexto y un client_ref; sin `.select()`', async () => {
    registrarPantalla('/gastos', '?mes=2026-08');
    await mount();
    await escribir('  No me deja guardar el gasto \n');
    await click(enviarBoton());
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]!.ops.map((op) => op.m)).toEqual(['insert', 'abortSignal']);
    const datos = enviado();
    expect(Object.keys(datos).sort()).toEqual(['client_ref', 'contexto', 'mensaje', 'pantalla']);
    expect(datos.mensaje).toBe('No me deja guardar el gasto');
    expect(datos.pantalla).toBe('/gastos'); // solo el nombre de la pantalla: la búsqueda no viaja
    expect(datos.client_ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Object.keys(datos.contexto as object).sort()).toEqual(['en_linea', 'errores_recientes', 'idioma', 'navegador', 'pantalla_tamano', 'version']);
  });

  it('nunca se lee la tabla de reportes (ni antes ni después de enviar)', async () => {
    await mount();
    expect(h.llamadas).toHaveLength(0);
    await escribir('algo raro');
    await click(enviarBoton());
    expect(h.llamadas.every((l) => l.ops.every((op) => op.m !== 'select'))).toBe(true);
    expect(h.llamadas.map((l) => l.tabla)).toEqual(['reportes']);
  });

  it('al servidor va la pantalla LIMPIA (sin búsqueda ni ids); el "Volver" conserva la ruta completa', async () => {
    const UUID = '7d1f0000-0000-4000-8000-000000000001';
    registrarPantalla(`/clientes/${UUID}`, '?q=Transportes%20Ejemplo');
    await mount();
    await escribir('algo raro con este cliente');
    await click(enviarBoton());
    expect(enviado().pantalla).toBe('/clientes/:id');
    expect(JSON.stringify(enviado())).not.toMatch(/Ejemplo|7d1f0000/);
    const volver = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent === 'Volver')!;
    expect(volver.getAttribute('href')).toBe(`/clientes/${UUID}?q=Transportes%20Ejemplo`);
  });

  it('el aviso de qué se envía es fiel: el nombre de la pantalla sin los datos, y que queda asociado a la cuenta', async () => {
    await mount();
    expect(textoPagina()).toContain(
      'Con tu mensaje enviamos el nombre de la pantalla en la que estabas (sin los datos que tenías cargados), qué versión de la app usas, tu navegador y los últimos errores técnicos que vio la app. El reporte queda asociado a tu cuenta.',
    );
  });

  it('sin última pantalla: pantalla null', async () => {
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    expect(enviado().pantalla).toBeNull();
  });

  it('el contexto lleva los errores recientes de la app (en lista blanca), sin textos del servidor', async () => {
    registrarErrorDeDatos({ code: '23514', message: 'new row for relation "gastos" violates check constraint "gastos_monto_chk"', details: 'Failing row contains (987654)' }, 'crear-gasto');
    await mount();
    await escribir('No guarda');
    await click(enviarBoton());
    const contexto = enviado().contexto as { errores_recientes: unknown[] };
    expect(contexto.errores_recientes).toEqual([{ tipo: 'invalid-data', sqlstate: '23514', constraint: 'gastos_monto_chk', operacion: 'crear-gasto', hace_s: expect.any(Number) }]);
    expect(JSON.stringify(enviado())).not.toContain('987654');
  });

  it('mientras envía: botón deshabilitado con "Enviando…"; un segundo toque no manda otro', async () => {
    let soltar: (r: Resp) => void = () => {};
    h.estado.responder = () => new Promise<Resp>((resolver) => (soltar = resolver));
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    expect(enviarBoton()!.disabled).toBe(true);
    expect(enviarBoton()!.textContent).toContain('Enviando…');
    await act(async () => {
      document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(inserts()).toHaveLength(1);
    await act(async () => soltar(ok()));
    await settle();
    expect(textoPagina()).toContain('Gracias, lo recibimos');
  });
});

describe('Reportar un problema: errores y reintento', () => {
  it('sin red: el error con "Reintentar", lo escrito INTACTO; el reintento manda el MISMO client_ref y sale', async () => {
    h.estado.responder = sinRed;
    await mount();
    await escribir('Se cuelga al guardar');
    await click(enviarBoton());
    expect(textoPagina()).toContain(NETWORK_ERROR_MESSAGE);
    expect(campo().value).toBe('Se cuelga al guardar');
    expect(reintentar()).toBeDefined();
    h.estado.responder = ok;
    await click(reintentar());
    expect(inserts()).toHaveLength(2);
    expect(enviado(1).client_ref).toBe(enviado(0).client_ref);
    expect(enviado(1).mensaje).toBe('Se cuelga al guardar');
    expect(textoPagina()).toContain('Gracias, lo recibimos');
  });

  it('si se cambia el texto después de un error, es OTRO reporte: otro client_ref', async () => {
    h.estado.responder = sinRed;
    await mount();
    await escribir('Primero');
    await click(enviarBoton());
    await escribir('Primero, con más detalle');
    await click(enviarBoton());
    expect(inserts()).toHaveLength(2);
    expect(enviado(1).client_ref).not.toBe(enviado(0).client_ref);
  });

  it('23505 del client_ref (el intento anterior había llegado): es ÉXITO', async () => {
    h.estado.responder = sinRed;
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    h.estado.responder = yaEstaba;
    await click(reintentar());
    expect(textoPagina()).toContain('Gracias, lo recibimos');
  });

  it('el tope de la base: su mensaje, SIN "Reintentar", y lo escrito queda', async () => {
    h.estado.responder = tope;
    await mount();
    await escribir('otro reporte más');
    await click(enviarBoton());
    expect(textoPagina()).toContain(TOPE_ALCANZADO);
    expect(textoPagina()).not.toContain('texto interno');
    expect(reintentar()).toBeUndefined();
    expect(campo().value).toBe('otro reporte más');
  });

  it('un check de la base (contexto): mensaje propio, sin "Reintentar" y sin el texto de la base', async () => {
    h.estado.responder = checkDeContexto;
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    expect(textoPagina()).toContain(PROBLEMA_DE_LA_APP);
    expect(textoPagina()).not.toContain('reportes_contexto_chk');
    expect(reintentar()).toBeUndefined();
  });

  it('se envía el texto LIMPIO: sin caracteres de control (salvo saltos de línea y tabs) y sin los extremos', async () => {
    const NUL = String.fromCharCode(0);
    const BEL = String.fromCharCode(7);
    const CR = String.fromCharCode(13);
    await mount();
    await escribir(`  Primera${NUL} línea${CR}\nSegunda${BEL}\tcon tab  `);
    await click(enviarBoton());
    expect(enviado().mensaje).toBe('Primera línea\nSegunda\tcon tab');
  });

  it('solo caracteres de control: es como vacío (no se envía)', async () => {
    await mount();
    await escribir(String.fromCharCode(0, 7, 27, 9, 10));
    await click(enviarBoton());
    expect(inserts()).toHaveLength(0);
    expect(textoPagina()).toContain(MENSAJE_VACIO);
  });

  it('sin conexión: se avisa antes de enviar; el envío falla en el momento (sin reintentarse solo)', async () => {
    h.estado.responder = sinRed;
    await mount();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(textoPagina()).toContain('No hay conexión');
    await escribir('sin señal');
    await click(enviarBoton());
    await settle(10);
    expect(inserts()).toHaveLength(1);
    expect(reintentar()).toBeDefined();
    expect(campo().value).toBe('sin señal');
  });

  it('los errores del propio envío NO van a los errores recientes', async () => {
    h.estado.responder = sinRed;
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    expect(erroresRecientes()).toEqual([]);
  });

  it('la mutación: scope propio, meta sin registro, y sin reintentos ni pausa propios (los del proyecto)', async () => {
    h.estado.responder = sinRed;
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    const [mutacion] = queryClient.getMutationCache().getAll();
    expect(mutacion!.options.scope).toEqual({ id: 'enviar-reporte' });
    expect(mutacion!.options.meta).toEqual({ sinRegistroDeErrores: true });
    expect(mutacion!.options.retry).toBe(0);
    expect(mutacion!.options.networkMode).toBe('always');
  });

  it('si la persona se va mientras se envía, no pasa nada raro al volver la respuesta', async () => {
    let soltar: (r: Resp) => void = () => {};
    h.estado.responder = () => new Promise<Resp>((resolver) => (soltar = resolver));
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    await act(async () => root.unmount());
    await act(async () => soltar(ok()));
    await settle();
  });
});

describe('Reportar un problema: "Gracias" y "Volver"', () => {
  it('el título del éxito recibe el foco; el formulario ya no está', async () => {
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    const titulo = [...document.querySelectorAll('h2')].find((t) => t.textContent === 'Gracias, lo recibimos')!;
    expect(document.activeElement).toBe(titulo);
    expect(document.querySelector('form')).toBeNull();
    expect(boton()).toBeUndefined();
  });

  it('"Volver" lleva a la pantalla de origen (con su búsqueda)', async () => {
    registrarPantalla('/resumen', '?vista=anio&anio=2025');
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    const volver = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent === 'Volver')!;
    expect(volver.getAttribute('href')).toBe('/resumen?vista=anio&anio=2025');
    await click(volver);
    expect(byId('ubicacion')!.dataset.ruta).toBe('/resumen?vista=anio&anio=2025');
  });

  it('sin origen, o con uno fuera de la lista blanca: "Volver" va a Inicio', async () => {
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    expect([...document.querySelectorAll('a')].find((a) => a.textContent === 'Volver')!.getAttribute('href')).toBe('/');
    await act(async () => root.unmount());
    container.remove();
    registrarPantalla('/admin/x', '');
    await mount();
    await escribir('algo');
    await click(enviarBoton());
    expect([...document.querySelectorAll('a')].find((a) => a.textContent === 'Volver')!.getAttribute('href')).toBe('/');
  });
});
