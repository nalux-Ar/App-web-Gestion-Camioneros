import { Link } from 'react-router';
import { ChevronRight, Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { filtroToSearch } from '@/features/viajes/viajes-filters';
import { formatDateShort, type YearMonth } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { BloqueResumen, type ConsultaDeBloque } from './resumen-bloque';
import {
  etiquetaResultado,
  formatMonto,
  SIN_INGRESO,
  textoCantidadViajes,
  textoGastosDelViaje,
  textoIngresoDelViaje,
  textoKm,
  textoSinViajes,
  TITULO_VIAJES,
} from './resumen-pantalla-textos';
import type { ResumenViajes, ViajeDelResumen } from './resumen-parse';
import { etiquetaCamionResumen, textoViajesCortados } from './resumen-textos';

interface ViajesDelMesProps {
  mes: YearMonth;
  enCurso: boolean;
  viajes: ConsultaDeBloque<ResumenViajes>;
}

/**
 * Los viajes del mes (`resumen_viajes`) con su ganancia, en el orden en que los manda la base (del más nuevo al más
 * viejo). Si la base cortó la lista, se avisa. Cada fila abre el detalle del viaje; su "volver" lleva a la lista de
 * Viajes de ESE mes (la navegación del detalle es la de Viajes).
 */
export function ViajesDelMes({ mes, enCurso, viajes }: ViajesDelMesProps) {
  const volver = filtroToSearch({ mes, vista: 'viajes' });
  return (
    <BloqueResumen id="resumen-viajes" titulo={TITULO_VIAJES} consulta={viajes} filasCargando={3}>
      {(datos) => {
        if (datos.viajes.length === 0) return <p className="text-muted-foreground">{textoSinViajes(mes, enCurso)}</p>;
        const cortados = textoViajesCortados(datos.viajes.length, datos.total);
        return (
          <>
            <p className="text-sm text-muted-foreground">{textoCantidadViajes(datos.total)}</p>
            {/* `role="note"`: es información fija de la lista, no un aviso urgente (el `Alert` por defecto es `role="alert"`). */}
            {cortados ? (
              <Alert role="note" data-cortada="">
                <Info aria-hidden="true" />
                <AlertDescription>{cortados}</AlertDescription>
              </Alert>
            ) : null}
            <ul className="space-y-2">
              {datos.viajes.map((viaje) => (
                <ViajeDelResumenItem key={viaje.viajeId} viaje={viaje} volver={volver} />
              ))}
            </ul>
          </>
        );
      }}
    </BloqueResumen>
  );
}

/**
 * Una fila: toda es un enlace al detalle (≥ 64 px de alto). Arriba el recorrido y, a la derecha, la ganancia ("Ganancia" /
 * "Pérdida" con la palabra, o "Sin ingreso"); debajo la fecha, el camión y los km; y el ingreso y los gastos del viaje.
 */
function ViajeDelResumenItem({ viaje, volver }: { viaje: ViajeDelResumen; volver: string }) {
  const detalle = [
    formatDateShort(viaje.fecha),
    viaje.camionId !== null ? etiquetaCamionResumen({ camionId: viaje.camionId, patente: viaje.patente, activa: null }) : null,
    viaje.km !== null ? textoKm(viaje.km) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const plata = [textoIngresoDelViaje(viaje.ingreso), textoGastosDelViaje(viaje.gastosCantidad, viaje.gastosMonto)].filter(Boolean).join(' · ');
  const { ganancia } = viaje;

  return (
    <li data-viaje={viaje.viajeId}>
      <Link
        to={`/viajes/${viaje.viajeId}`}
        state={{ volver }}
        className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <p className="line-clamp-2 min-w-0 break-words font-medium">
              {viaje.origen} <span aria-hidden="true">→</span>
              <span className="sr-only"> a </span> {viaje.destino}
            </p>
            {ganancia === null ? (
              <p data-ganancia="" className="shrink-0 text-right text-sm text-muted-foreground">
                {SIN_INGRESO}
              </p>
            ) : (
              <p data-ganancia="" className="shrink-0 text-right">
                <span className="block text-xs text-muted-foreground">{etiquetaResultado(ganancia)}</span>{' '}
                <span className={cn('block font-semibold tabular-nums', ganancia < 0 && 'text-destructive-text')}>
                  {formatMonto(Math.abs(ganancia))}
                </span>
              </p>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{detalle}</p>
          <p className="text-sm text-muted-foreground">{plata}</p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}
