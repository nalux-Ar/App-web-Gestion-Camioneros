import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AVISO_AUTOCIERRE_MS } from './avisos';

/** Todos los .tsx de una carpeta (y sus subcarpetas) que no son pruebas. */
function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) return fuentes(ruta);
    return ruta.endsWith('.tsx') && !ruta.endsWith('.test.tsx') ? [ruta] : [];
  });
}

describe('avisos de "guardado" / "eliminado"', () => {
  it('se cierran solos a los 10 segundos (tiempo de sobra para leerlos; también tienen "Cerrar aviso")', () => {
    expect(AVISO_AUTOCIERRE_MS).toBe(10_000);
  });

  it('todas las pantallas usan ESE valor: ninguna define su propia duración', () => {
    const carpeta = path.join(import.meta.dirname, '..', 'features');
    const conAviso = fuentes(carpeta)
      .map((ruta) => ({ ruta: path.relative(carpeta, ruta).split(path.sep).join('/'), texto: readFileSync(ruta, 'utf8') }))
      .filter(({ texto }) => texto.includes('AVISO_AUTOCIERRE_MS'));

    // Gastos, Viajes, detalle del viaje, Clientes, detalle del cliente y Camiones.
    expect(conAviso.map(({ ruta }) => ruta).sort()).toEqual([
      'camiones/camiones-page.tsx',
      'clientes/cliente-detalle-page.tsx',
      'clientes/clientes-page.tsx',
      'gastos/gastos-page.tsx',
      'viajes/viaje-detalle-page.tsx',
      'viajes/viajes-page.tsx',
    ]);
    for (const { ruta, texto } of conAviso) {
      expect(texto, ruta).toContain("import { AVISO_AUTOCIERRE_MS } from '@/lib/avisos';");
      expect(texto, ruta).not.toMatch(/const AVISO_AUTOCIERRE_MS\s*=/);
      expect(texto, ruta).toContain('window.setTimeout(cerrarAviso, AVISO_AUTOCIERRE_MS)');
    }
  });
});
