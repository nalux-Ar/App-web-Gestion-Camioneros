import { useState } from 'react';

import { ConfirmDelete } from '@/components/shared/confirm-delete';
import { ELIMINAR_VIAJE_CONTEXT } from './constants';
import { textosDeBorrado, type ConteosDelViaje, type EstadoConteos } from './eliminar-viaje-textos';
import { useConteosDelViaje } from './use-viajes';

interface EliminarViajeProps {
  viajeId: string;
  /** Hace el borrado (los dos pasos, `useEliminarViaje`) y navega. TIRA el error si falla. Recibe los números que se
   *  le mostraron al usuario (null si no se pudo contar alguno), para volver a contar antes de desvincular. */
  onConfirm: (conteosMostrados: ConteosDelViaje | null) => Promise<unknown>;
}

/**
 * "Eliminar viaje": la confirmación en dos pasos de `ConfirmDelete`, con el texto según cuántos gastos y cuántas
 * devoluciones tiene el viaje. Los dos números se piden recién al abrir el paso de confirmar y siempre frescos
 * (ver `useConteosDelViaje`):
 *  - Sin gastos ni devoluciones: el texto de siempre.
 *  - Con gastos: "Se conservan, pero quedan sin viaje" y el botón lo dice.
 *  - Con devoluciones: "Se borran junto con el viaje" y el botón lo dice.
 *  - Si el conteo falla (cualquiera de los dos): un texto genérico, y se puede borrar igual.
 * Los gastos nunca se borran: el borrado los desvincula primero y recién después borra el viaje. Las devoluciones
 * se borran en cascada, por la base.
 */
export function EliminarViaje({ viajeId, onConfirm }: EliminarViajeProps) {
  const [confirmando, setConfirmando] = useState(false);
  const conteo = useConteosDelViaje(viajeId, confirmando);

  // Solo hay número "listo" cuando la consulta TERMINÓ (`fetchStatus` 'idle'): mientras pide, y también si quedó en
  // pausa por falta de señal (ahí `isFetching` es false), el texto espera. Así nunca se muestra el número de una
  // apertura anterior como si fuera el de ahora.
  const terminado = conteo.fetchStatus === 'idle';
  const estado: EstadoConteos =
    terminado && conteo.data !== undefined && !conteo.isError
      ? { tipo: 'listo', gastos: conteo.data.gastos, devoluciones: conteo.data.devoluciones }
      : terminado && conteo.isError
        ? { tipo: 'error' }
        : { tipo: 'cargando' };
  const textos = textosDeBorrado(estado);
  const conteosMostrados: ConteosDelViaje | null =
    estado.tipo === 'listo' ? { gastos: estado.gastos, devoluciones: estado.devoluciones } : null;

  return (
    <ConfirmDelete
      label="Eliminar viaje"
      context={ELIMINAR_VIAJE_CONTEXT}
      prompt={textos.prompt}
      confirmLabel={textos.confirmLabel}
      confirmDisabled={!textos.puedeConfirmar}
      // Con devoluciones el borrado destruye datos: tras un error el botón sigue diciendo qué se borra (no "Reintentar").
      keepConfirmLabelOnError={conteosMostrados !== null && conteosMostrados.devoluciones > 0}
      onConfirmingChange={setConfirmando}
      onConfirm={() => onConfirm(conteosMostrados)}
    />
  );
}
