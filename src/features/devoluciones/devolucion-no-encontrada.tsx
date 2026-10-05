import { Link } from 'react-router';
import { SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { estadoDesdeCliente, rutaDelCliente, type DesdeCliente } from '@/features/clientes/cliente-navegacion';
import {
  ORIGEN_CLIENTE,
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
  /** Si la edición se abrió desde la lista de Devoluciones o desde un cliente (marca ya validada), se vuelve ahí en vez de al viaje. */
  origen?: OrigenDevolucion | null;
  /** El cliente desde el que se llegó (ya validado), si lo hubo. */
  desdeCliente?: DesdeCliente | null;
}

/**
 * Estado de "esa devolución no existe": id inválido en la URL, borrada por otro lado, de OTRO viaje o de otro
 * transportista. La base no distingue esos casos y el mensaje tampoco (sin oráculo de existencia).
 */
export function DevolucionNoEncontrada({ viajeId, volver = '', origen = null, desdeCliente = null }: DevolucionNoEncontradaProps) {
  const desdeLista = origen === ORIGEN_LISTA_DEVOLUCIONES;
  const alCliente = origen === ORIGEN_CLIENTE && desdeCliente !== null;

  return (
    <EmptyState
      icon={SearchX}
      title="Devolución no encontrada"
      description="Puede que ya la hayas eliminado, o que el enlace no sea correcto."
      action={
        <Button asChild size="lg">
          {desdeLista ? (
            <Link to={rutaListaDevoluciones(volver)}>Volver a Devoluciones</Link>
          ) : alCliente ? (
            <Link to={rutaDelCliente(desdeCliente.id)} state={{ volver: desdeCliente.volver }}>
              Volver al cliente
            </Link>
          ) : (
            <Link to={rutaDelViaje(viajeId)} state={{ volver, ...estadoDesdeCliente(desdeCliente) }}>
              Volver al viaje
            </Link>
          )}
        </Button>
      }
    />
  );
}
