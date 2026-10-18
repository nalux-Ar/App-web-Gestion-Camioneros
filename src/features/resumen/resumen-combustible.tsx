import { ChevronDown } from 'lucide-react';

import { BloqueResumen, type ConsultaDeBloque } from './resumen-bloque';
import {
  ETIQUETAS_COMBUSTIBLE,
  formatMonto,
  PASOS_COMO_SE_CALCULA,
  TEXTO_SIN_RENDIMIENTO,
  textoCantidadCargas,
  textoKmPorLitro,
  textoLitros,
  textoLitrosCada100,
  textoPrecioPorLitro,
  textoTramos,
  TITULO_COMBUSTIBLE,
  TITULO_COMO_SE_CALCULA,
} from './resumen-pantalla-textos';
import type { CombustibleDelCamion } from './resumen-parse';
import { etiquetaCamionResumen } from './resumen-textos';

interface CombustibleDelPeriodoProps {
  /** El texto cuando el período no tiene cargas ("Todavía no cargaste combustible este mes", "… en 2025"). */
  vacio: string;
  combustible: ConsultaDeBloque<CombustibleDelCamion[]>;
}

/**
 * Combustible por camión (`resumen_combustible`) de un período, el mes o el año: las cargas del período y, si hay tramos
 * válidos que cierran en él, el rendimiento ponderado del período. Todo lo calcula la base; acá solo se muestra y se
 * explica ("¿Cómo se calcula?").
 */
export function CombustibleDelPeriodo({ vacio, combustible }: CombustibleDelPeriodoProps) {
  return (
    <BloqueResumen id="resumen-combustible" titulo={TITULO_COMBUSTIBLE} consulta={combustible} filasCargando={3}>
      {(camiones) => (
        <>
          {camiones.length === 0 ? (
            <p className="text-muted-foreground">{vacio}</p>
          ) : (
            <div className="space-y-4 divide-y divide-border">
              {camiones.map((camion) => (
                <CombustibleDeUnCamion key={camion.camionId} camion={camion} />
              ))}
            </div>
          )}
          <ComoSeCalcula />
        </>
      )}
    </BloqueResumen>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{etiqueta}</dt>
      <dd className="font-semibold tabular-nums [overflow-wrap:anywhere]">{valor}</dd>
    </div>
  );
}

/** Un camión: sus cargas, su rendimiento (o qué falta para tenerlo) y UNA línea con los tramos usados y descartados. */
function CombustibleDeUnCamion({ camion }: { camion: CombustibleDelCamion }) {
  const tituloId = `resumen-combustible-${camion.camionId}`;
  const tramos = textoTramos({ usados: camion.tramos, km: camion.tramosKm, litros: camion.tramosLitros }, camion.descartados);
  const { kmPorLitro, litros100km, costoPorKm } = camion;

  return (
    <article aria-labelledby={tituloId} data-camion={camion.camionId} className="space-y-3 pt-4 first:pt-0">
      <h3 id={tituloId} className="font-semibold">
        {etiquetaCamionResumen(camion)}
      </h3>
      <dl className="grid grid-cols-2 gap-3">
        <Dato etiqueta={ETIQUETAS_COMBUSTIBLE.cargas} valor={textoCantidadCargas(camion.cargas)} />
        <Dato etiqueta={ETIQUETAS_COMBUSTIBLE.litros} valor={textoLitros(camion.litros)} />
        <Dato etiqueta={ETIQUETAS_COMBUSTIBLE.gasto} valor={formatMonto(camion.monto)} />
        {camion.precioPromedio !== null ? <Dato etiqueta={ETIQUETAS_COMBUSTIBLE.precio} valor={textoPrecioPorLitro(camion.precioPromedio)} /> : null}
      </dl>
      {camion.tramos > 0 && kmPorLitro !== null && litros100km !== null && costoPorKm !== null ? (
        <dl data-rendimiento="" className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
          <Dato etiqueta={ETIQUETAS_COMBUSTIBLE.rendimiento} valor={textoKmPorLitro(kmPorLitro)} />
          <Dato etiqueta={ETIQUETAS_COMBUSTIBLE.consumo} valor={textoLitrosCada100(litros100km)} />
          <Dato etiqueta={ETIQUETAS_COMBUSTIBLE.costoPorKm} valor={formatMonto(costoPorKm)} />
        </dl>
      ) : (
        <p data-sin-rendimiento="" className="text-sm text-muted-foreground">
          {TEXTO_SIN_RENDIMIENTO}
        </p>
      )}
      {tramos ? (
        <p data-tramos="" className="text-sm text-muted-foreground">
          {tramos}
        </p>
      ) : null}
    </article>
  );
}

/** La explicación del rendimiento, plegada (un `<details>` nativo: teclado y lector de pantalla sin nada extra). */
function ComoSeCalcula() {
  return (
    <details className="group rounded-md border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {TITULO_COMO_SE_CALCULA}
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <ul className="list-disc space-y-1 px-3 pb-3 pl-8 text-sm text-muted-foreground">
        {PASOS_COMO_SE_CALCULA.map((paso) => (
          <li key={paso}>{paso}</li>
        ))}
      </ul>
    </details>
  );
}
