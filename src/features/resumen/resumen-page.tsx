import { useSearchParams } from 'react-router';

import { MonthPicker } from '@/components/shared/month-picker';
import { PageHeader } from '@/components/shared/page-header';
import { AYUDA_RESUMEN } from '@/features/ayuda/ayuda-pantallas';
import { formatMonthLabel, todayLocal, type YearMonth } from '@/lib/dates';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { ResumenDelAnio } from './resumen-anio';
import { EstadoDeCarga } from './resumen-bloque';
import { CombustibleDelPeriodo } from './resumen-combustible';
import { esMesEnCurso } from './resumen-fechas';
import { readResumenFiltro, resumenFiltroToParams, type ResumenFiltro } from './resumen-filtros';
import { GastosDelMes } from './resumen-gastos';
import { RESUMEN_TITULO, textoSinCombustible } from './resumen-pantalla-textos';
import { ResultadoDelMes } from './resumen-resultado';
import { SelectorDeAnio, SelectorDeVista } from './resumen-selectores';
import { ViajesDelMes } from './resumen-viajes';
import { useResumenDelMes } from './use-resumen';

/**
 * Pantalla Resumen (`/resumen`) con dos vistas, "Mes" y "Año" (`SelectorDeVista`). La vista y el período viven en la URL
 * (`?mes=2026-08`, `?vista=anio&anio=2025`), validados con `readResumenFiltro`: lo inválido se ignora y se usa el valor
 * por defecto (la vista Mes, el mes actual o el año actual), que no se escribe.
 *
 * - Mes: el gasto del mes (con la comparación y los desgloses), los ingresos y el resultado, el combustible por camión y
 *   los viajes.
 * - Año: el gasto del año (con el promedio por mes, el gasto mes a mes y los desgloses), los ingresos y el resultado (con
 *   el resultado de cada mes) y el combustible por camión. Sin lista de viajes (ver `ResumenDelAnio`).
 *
 * Cada bloque usa SU consulta con su propio estado: uno que carga, falla o está vacío no tapa a los demás, y su
 * "Reintentar" vuelve a pedir solo lo suyo.
 */
export function ResumenPage() {
  useScrollToTopOnMount();
  const [searchParams, setSearchParams] = useSearchParams();
  const filtro = readResumenFiltro(searchParams);

  // Lo que es el valor por defecto (el mes actual, el año actual) no se escribe en la URL (`resumenFiltroToParams`).
  // `replace`: cambiar de período no apila historial ("atrás" sale de la pantalla), como en Viajes y Gastos.
  function cambiarFiltro(siguiente: ResumenFiltro) {
    setSearchParams(resumenFiltroToParams(siguiente), { replace: true });
  }

  return (
    <div className="space-y-5">
      <PageHeader title={RESUMEN_TITULO} ayuda={AYUDA_RESUMEN} />
      <SelectorDeVista filtro={filtro} />
      {/* `key`: al cambiar de período los bloques se arman de nuevo (sin estados de despliegue del período anterior). */}
      {filtro.vista === 'mes' ? (
        <>
          <MonthPicker value={filtro.mes} onChange={(mes) => cambiarFiltro({ vista: 'mes', mes })} />
          <ResumenDelMes key={`${filtro.mes.year}-${filtro.mes.month}`} mes={filtro.mes} />
        </>
      ) : (
        <>
          <SelectorDeAnio value={filtro.anio} onChange={(anio) => cambiarFiltro({ vista: 'anio', anio })} />
          <ResumenDelAnio key={filtro.anio} anio={filtro.anio} />
        </>
      )}
    </div>
  );
}

/** Los bloques del mes. Componente aparte: al cambiar de mes se arma con las consultas de ESE mes. */
function ResumenDelMes({ mes }: { mes: YearMonth }) {
  // "Hoy" una sola vez para todo el mes: decide si está en curso (contra qué se compara, qué texto de vacío).
  const hoy = todayLocal();
  const enCurso = esMesEnCurso(mes, hoy);
  const resumen = useResumenDelMes(mes, hoy);

  return (
    <>
      <EstadoDeCarga
        consultas={[resumen.gastos, resumen.comparacion, resumen.mensual, resumen.combustible, resumen.viajes]}
        periodo={formatMonthLabel(mes)}
      />
      <GastosDelMes mes={mes} enCurso={enCurso} gastos={resumen.gastos} comparacion={resumen.comparacion} />
      <ResultadoDelMes mes={mes} mensual={resumen.mensual} />
      <CombustibleDelPeriodo vacio={textoSinCombustible(mes, enCurso)} combustible={resumen.combustible} />
      <ViajesDelMes mes={mes} enCurso={enCurso} viajes={resumen.viajes} />
    </>
  );
}
