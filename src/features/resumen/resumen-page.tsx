import { useSearchParams } from 'react-router';
import { WifiOff } from 'lucide-react';

import { MonthPicker } from '@/components/shared/month-picker';
import { PageHeader } from '@/components/shared/page-header';
import { currentMonth, formatMonthLabel, todayLocal, type YearMonth } from '@/lib/dates';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { CombustibleDelMes } from './resumen-combustible';
import { esMesEnCurso } from './resumen-fechas';
import { filtroEnVista, readResumenFiltro, resumenFiltroToParams } from './resumen-filtros';
import { GastosDelMes } from './resumen-gastos';
import { RESUMEN_SIN_CONEXION, RESUMEN_TITULO, textoCargandoResumen } from './resumen-pantalla-textos';
import { ResultadoDelMes } from './resumen-resultado';
import { ViajesDelMes } from './resumen-viajes';
import { useResumenDelMes } from './use-resumen';

/**
 * Pantalla Resumen (`/resumen`), vista Mes: el gasto del mes (con la comparación y los desgloses), los ingresos y el
 * resultado, el combustible por camión y los viajes. El mes vive en la URL (`?mes=2026-08`, validado con
 * `readResumenFiltro`: lo inválido se ignora y se usa el mes actual, que no se escribe).
 *
 * Por ahora la pantalla tiene solo la vista Mes: si llega `?vista=anio&anio=…` (la vista Año llega después), se muestra el
 * mes que corresponde a ese año (`filtroEnVista`: el mes actual en el año en curso, diciembre en uno pasado).
 *
 * Cada bloque usa SU consulta (`useResumenDelMes`) con su propio estado: uno que carga, falla o está vacío no tapa a los
 * demás, y su "Reintentar" vuelve a pedir solo lo suyo.
 */
export function ResumenPage() {
  useScrollToTopOnMount();
  const [searchParams, setSearchParams] = useSearchParams();
  const filtro = filtroEnVista(readResumenFiltro(searchParams), 'mes');
  const mes = filtro.vista === 'mes' ? filtro.mes : currentMonth();

  // El mes actual no se escribe en la URL (`resumenFiltroToParams`); un `?vista=anio` se reemplaza por el mes elegido.
  function cambiarMes(siguiente: YearMonth) {
    setSearchParams(resumenFiltroToParams({ vista: 'mes', mes: siguiente }), { replace: true });
  }

  return (
    <div className="space-y-5">
      <PageHeader title={RESUMEN_TITULO} />
      <MonthPicker value={mes} onChange={cambiarMes} />
      {/* `key`: al cambiar de mes los bloques se arman de nuevo (sin estados de despliegue del mes anterior). */}
      <ResumenDelMes key={`${mes.year}-${mes.month}`} mes={mes} />
    </div>
  );
}

/** Los bloques del mes. Componente aparte: al cambiar de mes se arma con las consultas de ESE mes. */
function ResumenDelMes({ mes }: { mes: YearMonth }) {
  // "Hoy" una sola vez para todo el mes: decide si está en curso (contra qué se compara, qué texto de vacío).
  const hoy = todayLocal();
  const enCurso = esMesEnCurso(mes, hoy);
  const resumen = useResumenDelMes(mes, hoy);
  const mesLabel = formatMonthLabel(mes);
  const consultas = [resumen.gastos, resumen.comparacion, resumen.mensual, resumen.combustible, resumen.viajes];
  const cargando = consultas.some((query) => query.isPending && query.fetchStatus === 'fetching');
  // Sin red, una consulta sin datos queda EN PAUSA (`networkMode: 'online'`): sin error y sin terminar. Se avisa.
  const enPausa = consultas.some((query) => query.isPending && query.fetchStatus === 'paused');

  return (
    <>
      {/* Un solo aviso para lectores de pantalla (cada bloque solo marca `aria-busy`): "cargando…" (oculto) o sin conexión (visible). */}
      <p role="status" className={enPausa ? 'flex items-center gap-2 text-sm text-muted-foreground' : 'sr-only'}>
        {enPausa ? (
          <>
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            {RESUMEN_SIN_CONEXION}
          </>
        ) : cargando ? (
          textoCargandoResumen(mesLabel)
        ) : (
          ''
        )}
      </p>
      <GastosDelMes mes={mes} enCurso={enCurso} gastos={resumen.gastos} comparacion={resumen.comparacion} />
      <ResultadoDelMes mes={mes} mensual={resumen.mensual} />
      <CombustibleDelMes mes={mes} enCurso={enCurso} combustible={resumen.combustible} />
      <ViajesDelMes mes={mes} enCurso={enCurso} viajes={resumen.viajes} />
    </>
  );
}
