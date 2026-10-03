import { useState } from 'react';

import { ConfirmDelete } from '@/components/shared/confirm-delete';
import { ELIMINAR_VIAJE_CONTEXT } from './constants';
import { textosDeBorrado, type EstadoConteoGastos } from './eliminar-viaje-textos';
import { useGastosDelViajeCount } from './use-viajes';

interface EliminarViajeProps {
  viajeId: string;
  /** Hace el borrado (los dos pasos, `useEliminarViaje`) y navega. TIRA el error si falla. Recibe la cantidad de
   *  gastos que se le mostró al usuario (null si no se pudo contar), para volver a contar antes de desvincular. */
  onConfirm: (gastosMostrados: number | null) => Promise<unknown>;
}

/**
 * "Eliminar viaje": la confirmación en dos pasos de `ConfirmDelete`, con el texto según cuántos gastos tiene el
 * viaje. La cantidad se pide recién al abrir el paso de confirmar y siempre fresca (ver `useGastosDelViajeCount`):
 *  - 0 gastos: el texto de siempre.
 *  - N > 0: "Este viaje tiene N gastos. Se conservan, pero quedan sin viaje." y el botón lo dice.
 *  - Si el conteo falla: un texto genérico, y se puede borrar igual.
 * Los gastos nunca se borran: el borrado los desvincula primero y recién después borra el viaje.
 */
export function EliminarViaje({ viajeId, onConfirm }: EliminarViajeProps) {
  const [confirmando, setConfirmando] = useState(false);
  const conteo = useGastosDelViajeCount(viajeId, confirmando);

  // Solo hay número "listo" cuando la consulta TERMINÓ (`fetchStatus` 'idle'): mientras pide, y también si quedó en
  // pausa por falta de señal (ahí `isFetching` es false), el texto espera. Así nunca se muestra el número de una
  // apertura anterior como si fuera el de ahora.
  const terminado = conteo.fetchStatus === 'idle';
  const estado: EstadoConteoGastos =
    terminado && conteo.data !== undefined && !conteo.isError
      ? { tipo: 'listo', cantidad: conteo.data }
      : terminado && conteo.isError
        ? { tipo: 'error' }
        : { tipo: 'cargando' };
  const textos = textosDeBorrado(estado);
  const gastosMostrados = estado.tipo === 'listo' ? estado.cantidad : null;

  return (
    <ConfirmDelete
      label="Eliminar viaje"
      context={ELIMINAR_VIAJE_CONTEXT}
      prompt={textos.prompt}
      confirmLabel={textos.confirmLabel}
      confirmDisabled={!textos.puedeConfirmar}
      onConfirmingChange={setConfirmando}
      onConfirm={() => onConfirm(gastosMostrados)}
    />
  );
}
