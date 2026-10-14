import { Link } from 'react-router';
import { AlertTriangle, ChevronRight } from 'lucide-react';

import { filtroToSearch } from '@/features/viajes/viajes-filters';
import type { YearMonth } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { BloqueResumen, type ConsultaDeBloque } from './resumen-bloque';
import {
  ETIQUETA_GASTOS_DEL_MES,
  ETIQUETA_INGRESOS,
  etiquetaResultado,
  formatMonto,
  TEXTO_COMO_SE_CALCULA_RESULTADO,
  TEXTO_VER_VIAJES_DEL_MES,
  textoSinResultado,
  textoViajesConIngreso,
  textoViajesSinIngreso,
  TITULO_RESULTADO,
} from './resumen-pantalla-textos';
import type { ResumenDelMes } from './resumen-parse';

/**
 * Ingresos y resultado del mes (la fila de `resumen_mensual`). El resultado lo calcula la base: ingresos de los viajes
 * del mes − todos los gastos del mes, y es null si NINGÚN viaje del mes tiene ingreso. Reglas de la pantalla:
 *  - null: no se muestra ningún resultado (sería solo "gastos" con signo menos, y engañaría); se invita a cargar el ingreso;
 *  - con viajes sin ingreso: el resultado se muestra CON el aviso de que puede estar incompleto;
 *  - negativo: se dice "Pérdida" (con la palabra; el color es un extra) y el monto va sin signo.
 */
export function ResultadoDelMes({ mes, mensual }: { mes: YearMonth; mensual: ConsultaDeBloque<ResumenDelMes[]> }) {
  return (
    <BloqueResumen id="resumen-resultado" titulo={TITULO_RESULTADO} consulta={mensual} filasCargando={3}>
      {(filas) => <ContenidoDelResultado mes={mes} fila={filas[0]!} />}
    </BloqueResumen>
  );
}

function ContenidoDelResultado({ mes, fila }: { mes: YearMonth; fila: ResumenDelMes }) {
  const { resultado } = fila;
  return (
    <>
      {resultado === null ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">{textoSinResultado(fila.viajesCantidad)}</p>
          <Link
            to={`/viajes${filtroToSearch({ mes, vista: 'viajes' })}`}
            className="-mx-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {TEXTO_VER_VIAJES_DEL_MES}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div data-resultado="">
          <p className="text-sm font-medium text-muted-foreground">{etiquetaResultado(resultado)}</p>
          <p className={cn('text-3xl font-semibold tabular-nums [overflow-wrap:anywhere]', resultado < 0 && 'text-destructive-text')}>
            {formatMonto(Math.abs(resultado))}
          </p>
          {fila.viajesSinIngreso > 0 ? (
            <p className="mt-2 flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {textoViajesSinIngreso(fila.viajesSinIngreso)}
            </p>
          ) : null}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-sm text-muted-foreground">{ETIQUETA_INGRESOS}</dt>
          <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(fila.viajesIngreso)}</dd>
          {fila.viajesCantidad > 0 ? (
            <dd className="text-sm text-muted-foreground">{textoViajesConIngreso(fila.viajesConIngreso, fila.viajesCantidad)}</dd>
          ) : null}
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{ETIQUETA_GASTOS_DEL_MES}</dt>
          <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(fila.gastosMonto)}</dd>
        </div>
      </dl>
      {resultado === null ? null : <p className="text-sm text-muted-foreground">{TEXTO_COMO_SE_CALCULA_RESULTADO}</p>}
    </>
  );
}
