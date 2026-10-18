import { describe, expect, it } from 'vitest';

import {
  formatMonto,
  nombreDeMes,
  periodoDeComparacion,
  RESUMEN_SIN_CONEXION,
  textoCantidadGastos,
  textoCargandoResumen,
  textoDetalleBarra,
  textoDiferencia,
  textoErrorComparacion,
  textoOtrasCategorias,
  textoPorcentaje,
  textoSinGastosDelMes,
  textoSinGastosParaComparar,
  textoVs,
  etiquetaResultado,
  textoCantidadViajes,
  textoSinResultado,
  textoViajesConIngreso,
  textoViajesSinIngreso,
  formatDecimales,
  PASOS_COMO_SE_CALCULA,
  TEXTO_SIN_RENDIMIENTO,
  textoCantidadCargas,
  textoKm,
  textoKmPorLitro,
  textoLitros,
  textoLitrosCada100,
  textoPrecioPorLitro,
  textoSinCombustible,
  textoTramos,
  TITULO_COMO_SE_CALCULA,
  SIN_INGRESO,
  textoGastosDelViaje,
  textoIngresoDelViaje,
  textoSinViajes,
  ANIO_ANTERIOR,
  ANIO_SIGUIENTE,
  ETIQUETA_SELECTOR_ANIO,
  ETIQUETAS_VISTA,
  nombreDelMes,
  SIN_GASTOS,
  textoPromedioDeMeses,
  textoSinGastosDelAnio,
  SIN_INGRESOS_CARGADOS,
  SIN_VIAJES,
  TEXTO_COMO_SE_CALCULA_RESULTADO_ANIO,
  TEXTO_VIAJES_EN_EL_ANIO,
  textoIngresosYGastos,
  textoSinCombustibleDelAnio,
} from './resumen-pantalla-textos';

/** Los textos usan espacio duro antes del "%" y el signo menos tipográfico: se normalizan para leer las pruebas. */
const plano = (texto: string) => texto.replace(/\u00a0/g, ' ').replace(/\u2212/g, '-');

describe('textos de la pantalla Resumen: números', () => {
  it('formatMonto: siempre 2 decimales, separador de miles, sin símbolo', () => {
    expect(formatMonto(1234.5)).toBe('1.234,50');
    expect(formatMonto(0)).toBe('0,00');
    expect(formatMonto(-1500)).toBe('-1.500,00');
  });

  it('textoCantidadGastos: singular, plural y miles', () => {
    expect(textoCantidadGastos(1)).toBe('1 gasto');
    expect(textoCantidadGastos(0)).toBe('0 gastos');
    expect(textoCantidadGastos(8)).toBe('8 gastos');
    expect(textoCantidadGastos(1234)).toBe('1.234 gastos');
  });

  it('textoCargandoResumen y el aviso sin conexión', () => {
    expect(textoCargandoResumen('octubre 2026')).toBe('Cargando el resumen de octubre 2026…');
    expect(RESUMEN_SIN_CONEXION).toContain('Sin conexión');
  });
});

describe('textos de la pantalla Resumen: comparación', () => {
  it('nombreDeMes: sin año si es el mismo; con año si es otro', () => {
    expect(nombreDeMes({ year: 2026, month: 9 }, 2026)).toBe('septiembre');
    expect(nombreDeMes({ year: 2025, month: 12 }, 2026)).toBe('diciembre 2025');
  });

  it('periodoDeComparacion: "los mismos días de …" en curso; el mes anterior a secas si cerró; enero contra diciembre del año anterior', () => {
    expect(periodoDeComparacion({ year: 2026, month: 10 }, true)).toBe('los mismos días de septiembre');
    expect(periodoDeComparacion({ year: 2026, month: 10 }, false)).toBe('septiembre');
    expect(periodoDeComparacion({ year: 2026, month: 1 }, false)).toBe('diciembre 2025');
    expect(periodoDeComparacion({ year: 2026, month: 1 }, true)).toBe('los mismos días de diciembre 2025');
  });

  it('textoDiferencia: más / menos con el monto y el % con signo; igual = "Lo mismo"', () => {
    expect(plano(textoDiferencia({ sentido: 'mas', diferencia: 2000, porcentaje: 25 }))).toBe('2.000,00 más (+25 %)');
    expect(plano(textoDiferencia({ sentido: 'menos', diferencia: 2000, porcentaje: 25 }))).toBe('2.000,00 menos (-25 %)');
    expect(textoDiferencia({ sentido: 'menos', diferencia: 1, porcentaje: 3 })).toContain('\u22123\u00a0%');
    expect(textoDiferencia({ sentido: 'igual', diferencia: 0, porcentaje: 0 })).toBe('Lo mismo');
  });

  it('textoDiferencia: menos de 1 % se dice así (no "+0 %"); sin % posible, solo el monto; % de miles con separador', () => {
    expect(plano(textoDiferencia({ sentido: 'mas', diferencia: 40, porcentaje: 0 }))).toBe('40,00 más (menos de 1 %)');
    expect(textoDiferencia({ sentido: 'mas', diferencia: 5000, porcentaje: null })).toBe('5.000,00 más');
    expect(plano(textoDiferencia({ sentido: 'mas', diferencia: 99000, porcentaje: 9900 }))).toBe('99.000,00 más (+9.900 %)');
  });

  it('textoVs, sin gastos para comparar y el prefijo del error', () => {
    expect(textoVs('los mismos días de septiembre', 8000)).toBe('vs. los mismos días de septiembre (8.000,00)');
    expect(textoVs('septiembre', 8000)).toBe('vs. septiembre (8.000,00)');
    expect(textoSinGastosParaComparar('septiembre')).toBe('Sin gastos en septiembre para comparar');
    expect(textoErrorComparacion('septiembre')).toBe('No pudimos comparar con septiembre.');
  });

  it('textoSinGastosDelMes: "este mes" en curso; el mes por nombre si ya cerró', () => {
    expect(textoSinGastosDelMes({ year: 2026, month: 10 }, true)).toBe('Todavía no cargaste gastos este mes');
    expect(textoSinGastosDelMes({ year: 2026, month: 8 }, false)).toBe('No cargaste gastos en agosto 2026');
  });
});

describe('textos de la pantalla Resumen: barras', () => {
  it('textoPorcentaje: entero con espacio duro; 0 con monto = "menos de 1 %"; 0 sin monto = "0 %"', () => {
    expect(textoPorcentaje(70, 7000)).toBe('70\u00a0%');
    expect(plano(textoPorcentaje(0, 5))).toBe('menos de 1 %');
    expect(plano(textoPorcentaje(0, 0))).toBe('0 %');
    expect(plano(textoPorcentaje(100, 1))).toBe('100 %');
  });

  it('textoOtrasCategorias y textoDetalleBarra', () => {
    expect(textoOtrasCategorias(3)).toBe('Otras (3 categorías)');
    expect(plano(textoDetalleBarra({ cantidad: 3, porcentaje: 70, monto: 7000 }))).toBe('3 gastos · 70 % del total');
    expect(plano(textoDetalleBarra({ cantidad: 1, porcentaje: 0, monto: 1 }))).toBe('1 gasto · menos de 1 % del total');
  });
});

describe('textos de la pantalla Resumen: ingresos y resultado', () => {
  it('textoCantidadViajes y textoViajesConIngreso', () => {
    expect(textoCantidadViajes(1)).toBe('1 viaje');
    expect(textoCantidadViajes(1500)).toBe('1.500 viajes');
    expect(textoViajesConIngreso(3, 3)).toBe('3 viajes con ingreso');
    expect(textoViajesConIngreso(1, 1)).toBe('1 viaje con ingreso');
    expect(textoViajesConIngreso(2, 3)).toBe('2 de 3 viajes con ingreso');
  });

  it('etiquetaResultado: Ganancia / Pérdida / Resultado (0)', () => {
    expect(etiquetaResultado(0.01)).toBe('Ganancia');
    expect(etiquetaResultado(-0.01)).toBe('Pérdida');
    expect(etiquetaResultado(0)).toBe('Resultado');
  });

  it('textoSinResultado: sin viajes, uno o varios', () => {
    expect(textoSinResultado(0)).toBe('No hay viajes en el mes. Carga tus viajes con su ingreso para ver si el mes dio ganancia o pérdida.');
    expect(textoSinResultado(1)).toBe('Tu viaje del mes no tiene el ingreso cargado. Cárgalo para ver si el mes dio ganancia o pérdida.');
    expect(textoSinResultado(1200)).toBe('Ninguno de tus 1.200 viajes del mes tiene el ingreso cargado. Cárgalo para ver si el mes dio ganancia o pérdida.');
  });

  it('textoViajesSinIngreso: singular y plural', () => {
    expect(textoViajesSinIngreso(1)).toBe('1 viaje sin ingreso cargado: el resultado puede estar incompleto.');
    expect(textoViajesSinIngreso(4)).toBe('4 viajes sin ingreso cargado: el resultado puede estar incompleto.');
  });
});

describe('textos de la pantalla Resumen: combustible', () => {
  const sinDescartes = { retroceso: 0, sinAvance: 0, fueraDeRango: 0 };

  it('formatDecimales: entre min y max decimales', () => {
    expect(formatDecimales(3, 1, 2)).toBe('3,0');
    expect(formatDecimales(2.849, 1, 2)).toBe('2,85');
    expect(formatDecimales(2.8, 1, 2)).toBe('2,8');
    expect(formatDecimales(2.999, 1, 2)).toBe('3,0');
    expect(formatDecimales(40.125, 1, 3)).toBe('40,125');
    expect(formatDecimales(40.12549, 1, 3)).toBe('40,125');
    expect(formatDecimales(1234.5, 1, 3)).toBe('1.234,5');
  });

  it('unidades: litros, km, km/L, L/100 km, precio por litro, cargas', () => {
    expect(textoLitros(300)).toBe('300,0 L');
    expect(textoLitros(300.5)).toBe('300,5 L');
    expect(textoKm(900)).toBe('900 km');
    expect(textoKm(1234.56)).toBe('1.234,6 km');
    expect(textoKmPorLitro(3)).toBe('3,0 km/L');
    expect(textoKmPorLitro(2.851)).toBe('2,85 km/L');
    expect(textoLitrosCada100(33.333)).toBe('33,3 L/100 km');
    expect(textoLitrosCada100(35)).toBe('35,0 L/100 km');
    expect(textoPrecioPorLitro(23.29)).toBe('23,29 por litro');
    expect(textoCantidadCargas(1)).toBe('1 carga');
    expect(textoCantidadCargas(12)).toBe('12 cargas');
  });

  it('textoTramos: null sin tramos ni descartes', () => {
    expect(textoTramos({ usados: 0, km: null, litros: null }, sinDescartes)).toBeNull();
  });

  it('textoTramos: usados con km y litros, ninguno descartado', () => {
    expect(textoTramos({ usados: 2, km: 900, litros: 300 }, sinDescartes)).toBe('2 tramos usados (900 km, 300,0 L), ninguno descartado.');
    expect(textoTramos({ usados: 1, km: 450.5, litros: 150.25 }, sinDescartes)).toBe('1 tramo usado (450,5 km, 150,25 L), ninguno descartado.');
  });

  it('textoTramos: un solo motivo, sin contar; varios motivos, con cuántos por cada uno (en el orden de MOTIVOS_DESCARTE)', () => {
    expect(textoTramos({ usados: 1, km: 450, litros: 150 }, { ...sinDescartes, fueraDeRango: 2 })).toBe(
      '1 tramo usado (450 km, 150,0 L), 2 descartados: dio menos de 0,5 o más de 15 km por litro: casi siempre es un odómetro mal escrito.',
    );
    expect(textoTramos({ usados: 0, km: null, litros: null }, { retroceso: 1, sinAvance: 2, fueraDeRango: 0 })).toBe(
      'Ningún tramo usado, 3 descartados: el odómetro bajó respecto de la carga llena anterior (1); el odómetro no avanzó desde la carga llena anterior (2).',
    );
    expect(textoTramos({ usados: 0, km: null, litros: null }, { ...sinDescartes, retroceso: 1 })).toBe(
      'Ningún tramo usado, 1 descartado: el odómetro bajó respecto de la carga llena anterior.',
    );
  });

  it('textoSinCombustible y los pasos de "¿Cómo se calcula?"', () => {
    expect(textoSinCombustible({ year: 2026, month: 10 }, true)).toBe('Todavía no cargaste combustible este mes');
    expect(textoSinCombustible({ year: 2026, month: 8 }, false)).toBe('No cargaste combustible en agosto 2026');
    expect(TITULO_COMO_SE_CALCULA).toBe('¿Cómo se calcula?');
    expect(PASOS_COMO_SE_CALCULA).toHaveLength(5);
    expect(TEXTO_SIN_RENDIMIENTO).toBe('Todavía no hay rendimiento para este camión: carga el odómetro en cargas con tanque lleno');
  });
});

describe('textos de la pantalla Resumen: viajes', () => {
  it('textoSinViajes, ingreso y gastos del viaje', () => {
    expect(textoSinViajes({ year: 2026, month: 10 }, true)).toBe('Todavía no hay viajes este mes');
    expect(textoSinViajes({ year: 2026, month: 8 }, false)).toBe('No hubo viajes en agosto 2026');
    expect(textoIngresoDelViaje(null)).toBeNull();
    expect(textoIngresoDelViaje(0)).toBe('Ingreso 0,00');
    expect(textoIngresoDelViaje(15000)).toBe('Ingreso 15.000,00');
    expect(textoGastosDelViaje(0, 0)).toBe('Sin gastos');
    expect(textoGastosDelViaje(1, 500)).toBe('1 gasto: 500,00');
    expect(textoGastosDelViaje(2, 3000)).toBe('2 gastos: 3.000,00');
    expect(SIN_INGRESO).toBe('Sin ingreso');
  });
});

describe('textos de la pantalla Resumen: vista Año (gastos)', () => {
  it('textoSinGastosDelAnio: "Todavía…" en el año en curso, el año a secas si ya pasó', () => {
    expect(textoSinGastosDelAnio(2026, true)).toBe('Todavía no cargaste gastos en 2026');
    expect(textoSinGastosDelAnio(2025, false)).toBe('No cargaste gastos en 2025');
  });

  it('textoPromedioDeMeses: sobre cuántos meses se promedia', () => {
    expect(textoPromedioDeMeses(10, true)).toBe('promedio de los 10 meses transcurridos');
    expect(textoPromedioDeMeses(1, true)).toBe('promedio del único mes transcurrido');
    expect(textoPromedioDeMeses(12, false)).toBe('promedio de los 12 meses del año');
  });

  it('nombreDelMes: el mes sin el año', () => {
    expect(nombreDelMes({ year: 2025, month: 1 })).toBe('enero');
    expect(nombreDelMes({ year: 2026, month: 12 })).toBe('diciembre');
  });

  it('etiquetas de las vistas y del selector de año', () => {
    expect(ETIQUETAS_VISTA).toEqual({ mes: 'Mes', anio: 'Año' });
    expect([ETIQUETA_SELECTOR_ANIO, ANIO_ANTERIOR, ANIO_SIGUIENTE]).toEqual(['Año', 'Año anterior', 'Año siguiente']);
    expect(SIN_GASTOS).toBe('Sin gastos');
  });
});

describe('textos de la pantalla Resumen: vista Año (resultado)', () => {
  it('textoSinResultado del año: los mismos textos que el Mes, con "año"', () => {
    expect(textoSinResultado(0, 'año')).toBe('No hay viajes en el año. Carga tus viajes con su ingreso para ver si el año dio ganancia o pérdida.');
    expect(textoSinResultado(1, 'año')).toBe('Tu viaje del año no tiene el ingreso cargado. Cárgalo para ver si el año dio ganancia o pérdida.');
    expect(textoSinResultado(20, 'año')).toBe('Ninguno de tus 20 viajes del año tiene el ingreso cargado. Cárgalo para ver si el año dio ganancia o pérdida.');
    // Sin período: el del Mes (los textos del paso 2 no cambiaron).
    expect(textoSinResultado(3)).toBe('Ninguno de tus 3 viajes del mes tiene el ingreso cargado. Cárgalo para ver si el mes dio ganancia o pérdida.');
  });

  it('textoIngresosYGastos y los textos fijos del Año', () => {
    expect(textoIngresosYGastos(1500, 1000)).toBe('Ingresos 1.500,00 · Gastos 1.000,00');
    expect(textoIngresosYGastos(0, 0)).toBe('Ingresos 0,00 · Gastos 0,00');
    expect(SIN_INGRESOS_CARGADOS).toBe('Sin ingresos cargados');
    expect(SIN_VIAJES).toBe('Sin viajes');
    expect(TEXTO_COMO_SE_CALCULA_RESULTADO_ANIO).toContain('del año menos todos los gastos del año');
    expect(TEXTO_VIAJES_EN_EL_ANIO).toContain('mes a mes');
  });
});

describe('textos de la pantalla Resumen: vista Año (combustible)', () => {
  it('textoSinCombustibleDelAnio: en curso / pasado', () => {
    expect(textoSinCombustibleDelAnio(2026, true)).toBe('Todavía no cargaste combustible en 2026');
    expect(textoSinCombustibleDelAnio(2025, false)).toBe('No cargaste combustible en 2025');
  });
});
