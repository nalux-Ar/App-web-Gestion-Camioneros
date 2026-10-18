import type { ReactNode } from 'react';
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
 * del mes − todos los gastos del mes, y es null si NINGÚN viaje del mes tiene ingreso. Las reglas de la pantalla están en
 * `ContenidoDelResultado` (las mismas para el Año).
 */
export function ResultadoDelMes({ mes, mensual }: { mes: YearMonth; mensual: ConsultaDeBloque<ResumenDelMes[]> }) {
  return (
    <BloqueResumen id="resumen-resultado" titulo={TITULO_RESULTADO} consulta={mensual} filasCargando={3}>
      {(filas) => (
        <ContenidoDelResultado
          datos={filas[0]!}
          etiquetaGastos={ETIQUETA_GASTOS_DEL_MES}
          comoSeCalcula={TEXTO_COMO_SE_CALCULA_RESULTADO}
          sinResultado={textoSinResultado(filas[0]!.viajesCantidad)}
          accionSinResultado={
            <Link
              to={`/viajes${filtroToSearch({ mes, vista: 'viajes' })}`}
              className="-mx-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {TEXTO_VER_VIAJES_DEL_MES}
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          }
        />
      )}
    </BloqueResumen>
  );
}

/** Lo que se muestra del resultado de un período: la fila del mes, o la suma de los 12 meses del año (`totalesDelAnio`). */
export interface DatosDelResultado {
  resultado: number | null;
  viajesCantidad: number;
  viajesConIngreso: number;
  viajesSinIngreso: number;
  viajesIngreso: number;
  gastosMonto: number;
}

interface ContenidoDelResultadoProps {
  datos: DatosDelResultado;
  /** "Gastos del mes" / "Gastos del año". */
  etiquetaGastos: string;
  /** Qué es el resultado (se muestra solo si hay resultado). */
  comoSeCalcula: string;
  /** El texto que invita a cargar los ingresos cuando no hay resultado. */
  sinResultado: string;
  /** Debajo de ese texto: a dónde ir a cargarlos (el Mes: sus viajes). */
  accionSinResultado?: ReactNode;
  /** Datos de más, después de ingresos y gastos (el Año: los viajes y los km). */
  extras?: ReadonlyArray<{ etiqueta: string; valor: string }>;
}

/**
 * Ingresos y resultado de un período. Reglas:
 *  - resultado null: no se muestra ningún resultado (sería solo "gastos" con signo menos, y engañaría); se invita a
 *    cargar el ingreso;
 *  - con viajes sin ingreso: el resultado se muestra CON el aviso de que puede estar incompleto;
 *  - negativo: se dice "Pérdida" (con la palabra; el color es un extra) y el monto va sin signo.
 */
export function ContenidoDelResultado({ datos, etiquetaGastos, comoSeCalcula, sinResultado, accionSinResultado, extras = [] }: ContenidoDelResultadoProps) {
  const { resultado } = datos;
  return (
    <>
      {resultado === null ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">{sinResultado}</p>
          {accionSinResultado}
        </div>
      ) : (
        <div data-resultado="">
          <p className="text-sm font-medium text-muted-foreground">{etiquetaResultado(resultado)}</p>
          <p className={cn('text-3xl font-semibold tabular-nums [overflow-wrap:anywhere]', resultado < 0 && 'text-destructive-text')}>
            {formatMonto(Math.abs(resultado))}
          </p>
          {datos.viajesSinIngreso > 0 ? (
            <p className="mt-2 flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {textoViajesSinIngreso(datos.viajesSinIngreso)}
            </p>
          ) : null}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-sm text-muted-foreground">{ETIQUETA_INGRESOS}</dt>
          <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(datos.viajesIngreso)}</dd>
          {datos.viajesCantidad > 0 ? (
            <dd className="text-sm text-muted-foreground">{textoViajesConIngreso(datos.viajesConIngreso, datos.viajesCantidad)}</dd>
          ) : null}
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{etiquetaGastos}</dt>
          <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(datos.gastosMonto)}</dd>
        </div>
        {extras.map(({ etiqueta, valor }) => (
          <div key={etiqueta}>
            <dt className="text-sm text-muted-foreground">{etiqueta}</dt>
            <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{valor}</dd>
          </div>
        ))}
      </dl>
      {resultado === null ? null : <p className="text-sm text-muted-foreground">{comoSeCalcula}</p>}
    </>
  );
}
