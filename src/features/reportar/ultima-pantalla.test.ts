import { beforeEach, describe, expect, it } from 'vitest';

import { rutaDeVuelta } from './ruta-de-vuelta';
import { leerUltimaPantalla, limpiarUltimaPantalla, MAX_PANTALLA, pantallaParaElReporte, registrarPantalla, sanearPantalla } from './ultima-pantalla';

const UUID = '7d1f0000-0000-4000-8000-000000000001';
const UUID2 = 'a1000000-0000-4000-8000-000000000002';

beforeEach(() => {
  limpiarUltimaPantalla();
});

describe('sanearPantalla', () => {
  it('acepta rutas internas con su búsqueda', () => {
    expect(sanearPantalla('/')).toBe('/');
    expect(sanearPantalla('/gastos?mes=2026-08')).toBe('/gastos?mes=2026-08');
    expect(sanearPantalla(`/viajes/${UUID}`)).toBe(`/viajes/${UUID}`);
  });

  it.each([
    ['//evil.example', 'protocol-relative'],
    ['/\\evil.example', 'barra invertida'],
    ['javascript:alert(1)', 'esquema'],
    ['https://evil.example/', 'URL absoluta'],
    ['gastos', 'sin barra inicial'],
    ['', 'vacía'],
    ['/gastos\n/otra', 'salto de línea'],
    ['/gastos\t', 'tabulación'],
    ['/gas tos', 'espacio'],
    ['/gastos\u0000', 'NUL'],
    ['/gastos\u007f', 'DEL'],
    ['/gastos\u0085', 'control C1'],
    ['/gastos\u2028', 'separador de línea'],
  ])('rechaza %j (%s)', (valor) => {
    expect(sanearPantalla(valor)).toBeNull();
  });

  it(`hasta ${MAX_PANTALLA} caracteres`, () => {
    const justo = `/${'a'.repeat(MAX_PANTALLA - 1)}`;
    expect(sanearPantalla(justo)).toBe(justo);
    expect(sanearPantalla(`${justo}a`)).toBeNull();
  });

  it('lo que no es texto: null', () => {
    for (const valor of [null, undefined, 42, {}, ['/gastos']]) expect(sanearPantalla(valor)).toBeNull();
  });
});

describe('registrarPantalla / leerUltimaPantalla / limpiarUltimaPantalla', () => {
  it('guarda pathname + search', () => {
    registrarPantalla('/gastos', '?mes=2026-08');
    expect(leerUltimaPantalla()).toBe('/gastos?mes=2026-08');
    registrarPantalla('/viajes', '');
    expect(leerUltimaPantalla()).toBe('/viajes');
  });

  it('IGNORA /reportar y /configuracion: queda la pantalla de trabajo anterior', () => {
    registrarPantalla('/gastos', '');
    registrarPantalla('/configuracion', '');
    registrarPantalla('/reportar', '');
    expect(leerUltimaPantalla()).toBe('/gastos');
  });

  it('una ubicación que no pasa el saneo no pisa la anterior', () => {
    registrarPantalla('/resumen', '?vista=anio');
    registrarPantalla('//evil.example', '');
    registrarPantalla('/gastos', `?q=${'x'.repeat(400)}`);
    expect(leerUltimaPantalla()).toBe('/resumen?vista=anio');
  });

  it('limpiar (al cerrar sesión) la borra', () => {
    registrarPantalla('/gastos', '');
    limpiarUltimaPantalla();
    expect(leerUltimaPantalla()).toBeNull();
  });
});

describe('rutaDeVuelta: lista blanca de rutas de la app, o Inicio', () => {
  it.each([
    ['/', '/'],
    ['/viajes', '/viajes'],
    ['/viajes?mes=2026-08&vista=devoluciones', '/viajes?mes=2026-08&vista=devoluciones'],
    [`/viajes/${UUID}`, `/viajes/${UUID}`],
    [`/viajes/${UUID}/editar`, `/viajes/${UUID}/editar`],
    [`/viajes/${UUID}/devoluciones/nueva`, `/viajes/${UUID}/devoluciones/nueva`],
    [`/viajes/${UUID}/devoluciones/${UUID2}/editar`, `/viajes/${UUID}/devoluciones/${UUID2}/editar`],
    ['/gastos/nuevo', '/gastos/nuevo'],
    [`/gastos/${UUID}/editar`, `/gastos/${UUID}/editar`],
    [`/clientes/${UUID}`, `/clientes/${UUID}`],
    // La búsqueda sirve para el "Volver" (se queda en el dispositivo); al servidor NO viaja (ver `pantallaParaElReporte`).
    ['/clientes?q=alma', '/clientes?q=alma'],
    ['/camiones/nuevo', '/camiones/nuevo'],
    ['/resumen?vista=anio&anio=2025', '/resumen?vista=anio&anio=2025'],
    ['/configuracion', '/configuracion'],
  ])('%s → %s', (pantalla, esperado) => {
    expect(rutaDeVuelta(pantalla)).toBe(esperado);
  });

  it.each([
    null,
    '//evil.example',
    'javascript:alert(1)',
    '/reportar',
    '/reportes',
    '/ingresar',
    '/viajes/no-es-uuid',
    `/viajes/${UUID}/borrar`,
    '/gastos/123/editar',
    '/admin',
    `/clientes/${UUID}/editar/x`,
  ])('%j → Inicio', (pantalla) => {
    expect(rutaDeVuelta(pantalla)).toBe('/');
  });

  it('una búsqueda con caracteres raros se descarta (se vuelve a la ruta sin búsqueda)', () => {
    expect(rutaDeVuelta('/gastos?mes=<script>')).toBe('/gastos');
    expect(rutaDeVuelta('/clientes?q="x"')).toBe('/clientes');
  });
});

describe('pantallaParaElReporte: lo que viaja al servidor (solo el nombre de la pantalla)', () => {
  it('null → null', () => {
    expect(pantallaParaElReporte(null)).toBeNull();
  });

  it('la búsqueda NO viaja (puede traer lo que la persona tipeó, p. ej. el nombre de un cliente)', () => {
    expect(pantallaParaElReporte('/clientes?q=Transportes%20Ejemplo')).toBe('/clientes');
    expect(pantallaParaElReporte('/gastos?mes=2026-08')).toBe('/gastos');
    expect(pantallaParaElReporte('/resumen?vista=anio&anio=2025')).toBe('/resumen');
  });

  it('el fragmento (#) tampoco, y se corta en el PRIMERO de `?` o `#`', () => {
    expect(pantallaParaElReporte('/resumen#algo')).toBe('/resumen');
    expect(pantallaParaElReporte('/resumen#a?q=Ejemplo')).toBe('/resumen');
    expect(pantallaParaElReporte('/clientes?q=Ejemplo#x')).toBe('/clientes');
  });

  it('cada uuid de la ruta se cambia por :id (uno o varios)', () => {
    expect(pantallaParaElReporte(`/viajes/${UUID}`)).toBe('/viajes/:id');
    expect(pantallaParaElReporte(`/viajes/${UUID}/editar`)).toBe('/viajes/:id/editar');
    expect(pantallaParaElReporte(`/viajes/${UUID}/devoluciones/${UUID2}/editar`)).toBe('/viajes/:id/devoluciones/:id/editar');
    expect(pantallaParaElReporte(`/clientes/${UUID}?q=Ejemplo`)).toBe('/clientes/:id');
  });

  it('también uuids en mayúsculas', () => {
    expect(pantallaParaElReporte(`/gastos/${UUID.toUpperCase()}/editar`)).toBe('/gastos/:id/editar');
  });

  it('una ruta sin uuid queda intacta', () => {
    for (const ruta of ['/', '/viajes', '/resumen', '/gastos/nuevo', '/configuracion']) expect(pantallaParaElReporte(ruta)).toBe(ruta);
  });

  it('si no queda nada, null', () => {
    expect(pantallaParaElReporte('')).toBeNull();
    expect(pantallaParaElReporte('?q=Ejemplo')).toBeNull();
    expect(pantallaParaElReporte('#x')).toBeNull();
  });

  it('con lo registrado: al servidor el nombre; el "Volver" conserva la ruta completa', () => {
    registrarPantalla(`/clientes/${UUID}`, '?q=Transportes%20Ejemplo');
    const pantalla = leerUltimaPantalla();
    expect(pantalla).toBe(`/clientes/${UUID}?q=Transportes%20Ejemplo`);
    expect(pantallaParaElReporte(pantalla)).toBe('/clientes/:id');
    expect(rutaDeVuelta(pantalla)).toBe(`/clientes/${UUID}?q=Transportes%20Ejemplo`);
  });
});
