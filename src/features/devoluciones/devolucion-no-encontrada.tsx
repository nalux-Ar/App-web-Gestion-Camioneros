import { Link } from 'react-router';
import { SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import {
  ORIGEN_LISTA_DEVOLUCIONES,
  rutaDelViaje,
  rutaListaDevoluciones,
  type OrigenDevolucion,
} from '@/features/viajes/viaje-navegacion';

interface DevolucionNoEncontradaProps {
  /** El viaje al que volver (uuid ya validado: la ruta se arma en el código). */
  viajeId: string;
  /** `search` de la lista de viajes ('' o '?mes=...'), ya saneado: el detalle lo necesita para su enlace "Viajes". */
  volver?: string;
  /** Si la edición se abrió desde la lista de Devoluciones (marca ya validada), se vuelve a esa lista en vez de al viaje. */
  origen?: OrigenDevolucion | null;
}

/**
 * Estado de "esa devolución no existe": id inválido en la URL, borrada por otro lado, de OTRO viaje o de otro
 * transportista. La base no distingue esos casos y el mensaje tampoco (sin oráculo de existencia).
 */
export function DevolucionNoEncontrada({ viajeId, volver = '', origen = null }: DevolucionNoEncontradaProps) {
  const desdeLista = origen === ORIGEN_LISTA_DEVOLUCIONES;

  return (
    <EmptyState
      icon={SearchX}
      title="Devolución no encontrada"
      description="Puede que ya la hayas eliminado, o que el enlace no sea correcto."
      action={
        <Button asChild size="lg">
          {desdeLista ? (
            <Link to={rutaListaDevoluciones(volver)}>Volver a Devoluciones</Link>
          ) : (
            <Link to={rutaDelViaje(viajeId)} state={{ volver }}>
              Volver al viaje
            </Link>
          )}
        </Button>
      }
    />
  );
}
