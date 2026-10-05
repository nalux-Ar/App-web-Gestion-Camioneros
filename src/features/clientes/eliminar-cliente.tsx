import { useState } from 'react';

import { ConfirmDelete } from '@/components/shared/confirm-delete';
import { ELIMINAR_CLIENTE_CONTEXT } from './constants';
import { textosBorradoCliente, type EstadoConteosCliente } from './eliminar-cliente-textos';
import { useConteosDelCliente } from './use-clientes';

interface EliminarClienteProps {
  clienteId: string;
  /** Hace el borrado y navega. TIRA el error si falla (un cliente con entregas o devoluciones: RESTRICT). */
  onConfirm: () => Promise<unknown>;
}

/**
 * "Eliminar cliente": la confirmación en dos pasos de `ConfirmDelete`, con el texto según cuántas entregas y devoluciones
 * tiene el cliente. Los dos números se piden recién al abrir el paso de confirmar y siempre frescos (`useConteosDelCliente`):
 *  - Sin entregas ni devoluciones: la pregunta de siempre y el botón de borrar.
 *  - Con alguna: NO aparece el botón de borrar; se explica por qué y que se puede renombrar (la base no lo dejaría borrar).
 *  - Si el conteo falla: un texto genérico y se puede intentar igual. Si tiene entregas o devoluciones, la base lo rechaza
 *    sin tocar nada y el error lo dice ("tiene entregas o devoluciones"), sin ofrecer reintentar.
 */
export function EliminarCliente({ clienteId, onConfirm }: EliminarClienteProps) {
  const [confirmando, setConfirmando] = useState(false);
  const conteo = useConteosDelCliente(clienteId, confirmando);

  // Solo hay número "listo" cuando la consulta TERMINÓ (`fetchStatus` 'idle'): mientras pide, y también si quedó en pausa
  // por falta de señal (ahí `isFetching` es false), el texto espera. Así nunca se muestra el número de una apertura anterior
  // como si fuera el de ahora.
  const terminado = conteo.fetchStatus === 'idle';
  const estado: EstadoConteosCliente =
    terminado && conteo.data !== undefined && !conteo.isError
      ? { tipo: 'listo', entregas: conteo.data.entregas, devoluciones: conteo.data.devoluciones }
      : terminado && conteo.isError
        ? { tipo: 'error' }
        : { tipo: 'cargando' };
  const textos = textosBorradoCliente(estado);

  return (
    <ConfirmDelete
      label="Eliminar cliente"
      context={ELIMINAR_CLIENTE_CONTEXT}
      prompt={textos.prompt}
      confirmDisabled={!textos.puedeConfirmar}
      confirmHidden={textos.bloqueado}
      cancelLabel={textos.bloqueado ? 'Entendido' : 'Cancelar'}
      onConfirmingChange={setConfirmando}
      onConfirm={onConfirm}
    />
  );
}
