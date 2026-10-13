import { describe, expect, it } from 'vitest';

import {
  ETIQUETAS_GRUPO_GASTO,
  GRUPOS_GASTO,
  MOTIVOS_DESCARTE,
  RESUMEN_ERROR_INESPERADO,
  ResumenParametrosInvalidosError,
  ResumenRespuestaInesperadaError,
  SIN_CAMION,
  SIN_ESPECIFICAR,
  etiquetaCamionResumen,
  etiquetaMetodoPago,
  mensajeErrorResumen,
  textoViajesCortados,
} from '@/features/resumen/resumen-textos';
import { isRetryableDataError } from '@/lib/data-errors';

describe('etiquetas', () => {
  it('un texto por grupo de resumen_gastos', () => {
    expect(GRUPOS_GASTO.map((grupo) => ETIQUETAS_GRUPO_GASTO[grupo])).toEqual(['Total', 'Por categoría', 'Por método de pago', 'Por camión']);
  });

  it('método de pago: el nombre de Gastos, y null = "Sin especificar"', () => {
    expect(etiquetaMetodoPago(null)).toBe(SIN_ESPECIFICAR);
    expect(SIN_ESPECIFICAR).toBe('Sin especificar');
    expect(etiquetaMetodoPago('efectivo')).toBe('Efectivo');
    expect(etiquetaMetodoPago('tarjeta_credito')).toBe('Tarjeta de crédito');
    expect(etiquetaMetodoPago('tarjeta_debito')).toBe('Tarjeta de débito');
    expect(etiquetaMetodoPago('transferencia')).toBe('Transferencia');
  });

  it('camión: "Sin camión", la patente con espacios y "(archivado)"', () => {
    expect(etiquetaCamionResumen({ camionId: null, patente: null, activa: null })).toBe(SIN_CAMION);
    expect(SIN_CAMION).toBe('Sin camión');
    const id = 'c1000000-0000-4000-8000-000000000001';
    expect(etiquetaCamionResumen({ camionId: id, patente: 'AB123CD', activa: true })).toBe('AB 123 CD');
    expect(etiquetaCamionResumen({ camionId: id, patente: 'ABC123', activa: false })).toBe('ABC 123 (archivado)');
    expect(etiquetaCamionResumen({ camionId: id, patente: null, activa: true })).toBe('Camión no disponible');
  });

  it('los tres motivos de descarte, con texto', () => {
    expect(Object.keys(MOTIVOS_DESCARTE).sort()).toEqual(['fueraDeRango', 'retroceso', 'sinAvance']);
    expect(MOTIVOS_DESCARTE.fueraDeRango).toContain('0,5');
    expect(MOTIVOS_DESCARTE.fueraDeRango).toContain('15');
    for (const texto of Object.values(MOTIVOS_DESCARTE)) expect(texto.length).toBeGreaterThan(10);
  });

  it('aviso de la lista de viajes cortada', () => {
    expect(textoViajesCortados(500, 640)).toBe('Hay 640 viajes en este período: se muestran los 500 más nuevos.');
    expect(textoViajesCortados(12, 12)).toBeNull();
    expect(textoViajesCortados(0, 0)).toBeNull();
  });
});

describe('errores propios', () => {
  it('respuesta inesperada: mensaje genérico, reintentable, con el motivo interno', () => {
    const error = new ResumenRespuestaInesperadaError('resumen_viajes', 'viaje repetido');
    expect(mensajeErrorResumen(error)).toBe(RESUMEN_ERROR_INESPERADO);
    expect(isRetryableDataError(error)).toBe(true);
    expect(error.rpc).toBe('resumen_viajes');
    expect(error.motivo).toBe('viaje repetido');
    expect(error.message).not.toContain('viaje repetido'); // el motivo no es el mensaje
  });

  it('parámetros inválidos: el mismo mensaje, sin reintento', () => {
    const error = new ResumenParametrosInvalidosError('resumen_gastos', 'más de 366 días');
    expect(mensajeErrorResumen(error)).toBe(RESUMEN_ERROR_INESPERADO);
    expect(isRetryableDataError(error)).toBe(false);
  });
});
