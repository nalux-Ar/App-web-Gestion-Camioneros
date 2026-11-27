import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ChevronRight } from 'lucide-react';

import { filtroToSearch } from '@/features/viajes/viajes-filters';
import type { YearMonth } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { BloqueResumen, type ConsultaDeBloque } from './resumen-bloque';
import {
  ETIQUETA_COBRASTE,
  ETIQUETA_GASTASTE,
  etiquetaDeLoQueQuedo,
  formatMonto,
  formatResultado,
  TEXTO_COMO_SE_CALCULA_RESULTADO,
  TEXTO_VER_VIAJES_DEL_MES,
  textoSinResultado,
  textoViajesConIngreso,
  textoViajesSinIngreso,
  TITULO_RESULTADO,
} from './resumen-pantalla-textos';
import type { ResumenDelMes } from './resumen-parse';

/**
 * La primera tarjeta del Mes: lo que cobraste, lo que gastaste y cuánto te quedó (la fila de `resumen_mensual`). El
 * resultado lo calcula la base: ingresos de los viajes del mes − todos los gastos del mes, y es null si NINGÚN viaje del
 * mes tiene ingreso. Las reglas de la pantalla están en `ContenidoDelResultado` (las mismas para el Año).
 */
export function ResultadoDelMes({ mes, mensual }: { mes: YearMonth; mensual: ConsultaDeBloque<ResumenDelMes[]> }) {
  return (
    <BloqueResumen id="resumen-resultado" titulo={TITULO_RESULTADO} consulta={mensual} filasCargando={3}>
      {(filas) => (
        <ContenidoDelResultado
          datos={filas[0]!}
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
  /** Qué es el resultado (se muestra solo si hay resultado). */
  comoSeCalcula: string;
  /** El texto que invita a cargar los ingresos cuando no hay resultado. */
  sinResultado: string;
  /** Debajo de ese texto: a dónde ir a cargarlos (el Mes: sus viajes). */
  accionSinResultado?: ReactNode;
}

/** Un renglón de la cuenta: el rótulo a la izquierda y el monto a la derecha; si no entran, el monto baja. */
function Renglon({ etiqueta, monto, detalle }: { etiqueta: string; monto: number; detalle?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-base text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 text-xl font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(monto)}</dd>
      {detalle ? <dd className="basis-full text-base text-muted-foreground">{detalle}</dd> : null}
    </div>
  );
}

/**
 * "Cobraste", "Gastaste" y, tras un separador, el resultado de un período. Reglas:
 *  - resultado null: no se muestra ningún resultado (sería solo "gastos" con signo menos, y engañaría); se invita a
 *    cargar el ingreso;
 *  - con viajes sin ingreso: el resultado se muestra CON el aviso de que puede estar incompleto;
 *  - negativo: se dice "Perdiste" (con la palabra), el monto lleva "−" delante y además va en el color de error: tres
 *    señales, ninguna es la única (`formatResultado`). Las filas de viajes y de "Resultado por mes" hacen lo mismo con
 *    "Pérdida".
 */
export function ContenidoDelResultado({ datos, comoSeCalcula, sinResultado, accionSinResultado }: ContenidoDelResultadoProps) {
  const { resultado } = datos;
  return (
    <>
      <dl className="space-y-3">
        <Renglon
          etiqueta={ETIQUETA_COBRASTE}
          monto={datos.viajesIngreso}
          detalle={datos.viajesCantidad > 0 ? textoViajesConIngreso(datos.viajesConIngreso, datos.viajesCantidad) : undefined}
        />
        <Renglon etiqueta={ETIQUETA_GASTASTE} monto={datos.gastosMonto} />
      </dl>
      <hr className="border-border" />
      {resultado === null ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">{sinResultado}</p>
          {accionSinResultado}
        </div>
      ) : (
        <>
          <div data-resultado="">
            <p className="text-lg font-semibold">{etiquetaDeLoQueQuedo(resultado)}</p>
            <p className={cn('text-3xl font-semibold tabular-nums [overflow-wrap:anywhere]', resultado < 0 && 'text-destructive-text')}>
              {formatResultado(resultado)}
            </p>
            {datos.viajesSinIngreso > 0 ? (
              <p className="mt-2 flex items-start gap-2 text-base">
                <AlertTriangle className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {textoViajesSinIngreso(datos.viajesSinIngreso)}
              </p>
            ) : null}
          </div>
          <p className="text-base text-muted-foreground">{comoSeCalcula}</p>
        </>
      )}
    </>
  );
}
