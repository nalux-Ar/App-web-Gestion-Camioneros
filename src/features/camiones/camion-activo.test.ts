import { describe, expect, it } from 'vitest';

import type { CamionDeLista } from '@/features/camiones/camion';
import { resolverCamionActivo } from '@/features/camiones/camion-activo';

const c = (id: string, patente: string, activa = true): CamionDeLista => ({ id, patente, marca: null, modelo: null, anio: null, activa });
const A = c('a', 'AA111AA');
const B = c('b', 'BB222BB');
const X = c('x', 'XX999XX', false); // archivado

describe('resolverCamionActivo (el puntero guardado, validado contra la lista)', () => {
  it('sin camión activo guardado: ninguno y no es obsoleto', () => {
    expect(resolverCamionActivo({ camiones: [A, B], camionActivoId: null })).toEqual({ camion: null, obsoleto: false });
    expect(resolverCamionActivo({ camiones: [], camionActivoId: null })).toEqual({ camion: null, obsoleto: false });
  });

  it('guardado, en la lista y activo: ese camión (el objeto de la lista)', () => {
    const r = resolverCamionActivo({ camiones: [A, B], camionActivoId: 'b' });
    expect(r).toEqual({ camion: B, obsoleto: false });
    expect(r.camion).toBe(B);
  });

  it('guardado pero ARCHIVADO: obsoleto (se comporta como "no hay")', () => {
    expect(resolverCamionActivo({ camiones: [A, B, X], camionActivoId: 'x' })).toEqual({ camion: null, obsoleto: true });
  });

  it('guardado pero NO está en la lista (borrado, o de la lista vieja): obsoleto', () => {
    expect(resolverCamionActivo({ camiones: [A, B], camionActivoId: 'z' })).toEqual({ camion: null, obsoleto: true });
    expect(resolverCamionActivo({ camiones: [], camionActivoId: 'a' })).toEqual({ camion: null, obsoleto: true });
  });

  it('un id vacío cuenta como "sin camión activo" (no como obsoleto)', () => {
    expect(resolverCamionActivo({ camiones: [A], camionActivoId: '' })).toEqual({ camion: null, obsoleto: false });
  });

  it('con un solo camión activo, igual exige que sea ESE: otro guardado es obsoleto', () => {
    expect(resolverCamionActivo({ camiones: [A, X], camionActivoId: 'a' })).toEqual({ camion: A, obsoleto: false });
    expect(resolverCamionActivo({ camiones: [A, X], camionActivoId: 'x' })).toEqual({ camion: null, obsoleto: true });
  });

  it('no modifica la lista', () => {
    const lista = [B, A];
    resolverCamionActivo({ camiones: lista, camionActivoId: 'a' });
    expect(lista).toEqual([B, A]);
  });
});
