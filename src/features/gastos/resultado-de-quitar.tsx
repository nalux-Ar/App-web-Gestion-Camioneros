import { Link, type LinkProps } from 'react-router';
import { CheckCircle2, Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ResultadoParaMostrarDeQuitar } from './quitar-gastos-resultado';
import { NINGUNO_QUITADO, textoNoSeBorraron, textoQuitaste, textoYaNoEstaban } from './quitar-gastos-textos';
import { VOLVER_AL_VIAJE } from './sumar-gastos-textos';

interface ResultadoDeQuitarProps {
  resultado: ResultadoParaMostrarDeQuitar;
  /** A dónde lleva «Volver al viaje» (la ruta ya armada y validada, y el estado de navegación que conserva el origen). */
  alViaje: { to: LinkProps['to']; state: LinkProps['state'] };
}

/**
 * El aviso de lo que pasó al tocar «Quitar» (`role="status"`: el lector de pantalla lo anuncia sin interrumpir). La pantalla NO vuelve
 * sola: el aviso se queda hasta el próximo «Quitar» y ofrece «Volver al viaje». Los gastos quitados ya no aparecen en la lista, y se
 * aclara en una frase que NO se borraron: quedaron sin viaje (se pueden volver a sumar). Si algunos de los marcados ya no estaban en
 * el viaje (otro dispositivo los quitó o los movió) se dice cuántos: no es un error, lo que se quería ya estaba hecho.
 */
export function ResultadoDeQuitar({ resultado, alViaje }: ResultadoDeQuitarProps) {
  const { quitados, yaNoEstaban } = resultado;
  // Con algo quitado (o que ya no estaba) el aviso es de «salió bien»; si no pasó nada de eso (no debería: se manda siempre algo) es
  // neutro, sin festejar.
  const algoHecho = quitados > 0 || yaNoEstaban > 0;

  return (
    <Alert role="status" className={algoHecho ? 'border-primary/50 bg-primary/10' : undefined}>
      {algoHecho ? <CheckCircle2 aria-hidden="true" className="text-primary" /> : <Info aria-hidden="true" />}
      <div className="space-y-3">
        <AlertDescription className="space-y-1 font-medium">
          {quitados > 0 ? <p>{textoQuitaste(quitados)}</p> : yaNoEstaban === 0 ? <p>{NINGUNO_QUITADO}</p> : null}
          {quitados > 0 ? <p className="font-normal">{textoNoSeBorraron(quitados)}</p> : null}
          {yaNoEstaban > 0 ? <p>{textoYaNoEstaban(yaNoEstaban)}</p> : null}
        </AlertDescription>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link to={alViaje.to} state={alViaje.state}>
            {VOLVER_AL_VIAJE}
          </Link>
        </Button>
      </div>
    </Alert>
  );
}
