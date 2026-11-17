import { Link, type LinkProps } from 'react-router';
import { CheckCircle2, Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ResultadoParaMostrar } from './sumar-gastos-resultado';
import { NINGUNO_SUMADO, textoNoSeSumaron, textoSumaste, textoYaEstaban, VOLVER_AL_VIAJE } from './sumar-gastos-textos';

interface ResultadoDeSumarProps {
  resultado: ResultadoParaMostrar;
  /** A dónde lleva «Volver al viaje» (la ruta ya armada y validada, y el estado de navegación que conserva el origen). */
  alViaje: { to: LinkProps['to']; state: LinkProps['state'] };
}

/**
 * El aviso de lo que pasó al tocar «Sumar» (`role="status"`: el lector de pantalla lo anuncia sin interrumpir). La pantalla NO vuelve
 * sola: el aviso se queda hasta el próximo «Sumar» y ofrece «Volver al viaje». Los gastos sumados ya no aparecen en la lista; los que
 * no se pudieron sumar siguen ahí y acá se dice cuáles y por qué.
 */
export function ResultadoDeSumar({ resultado, alViaje }: ResultadoDeSumarProps) {
  const { sumados, yaEstaban, noSumados } = resultado;
  // Con algo sumado (o que ya estaba) el aviso es de «salió bien»; si no se sumó nada es neutro: no es un error, pero tampoco algo
  // para festejar.
  const algoSumado = sumados > 0 || yaEstaban > 0;

  return (
    <Alert role="status" className={algoSumado ? 'border-primary/50 bg-primary/10' : undefined}>
      {algoSumado ? <CheckCircle2 aria-hidden="true" className="text-primary" /> : <Info aria-hidden="true" />}
      <div className="space-y-3">
        <AlertDescription className="space-y-1 font-medium">
          {sumados > 0 ? <p>{textoSumaste(sumados)}</p> : yaEstaban === 0 ? <p>{NINGUNO_SUMADO}</p> : null}
          {yaEstaban > 0 ? <p>{textoYaEstaban(yaEstaban)}</p> : null}
          {noSumados.length > 0 ? <p>{textoNoSeSumaron(noSumados.length)}</p> : null}
        </AlertDescription>
        {noSumados.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-base [overflow-wrap:anywhere]">
            {noSumados.map(({ gastoId, texto }) => (
              <li key={gastoId}>{texto}</li>
            ))}
          </ul>
        ) : null}
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link to={alViaje.to} state={alViaje.state}>
            {VOLVER_AL_VIAJE}
          </Link>
        </Button>
      </div>
    </Alert>
  );
}
