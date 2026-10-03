import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/shared/select-field';
import { TextareaField } from '@/components/shared/textarea-field';
import type { ClienteOpcion } from '@/features/clientes/cliente-nombre';
import { NuevoClienteInline } from '@/features/clientes/nuevo-cliente-inline';
import { charLength } from '@/lib/text';
import { MAX_INCIDENCIAS, TEXTO_COUNTER_FROM } from './constants';
import { entregaDomId } from './viaje-dom-ids';
import type { EntregaErrors, EntregaFormRow } from './viaje-form';

export type CargaClientes = 'cargando' | 'error' | 'listo';

interface EntregaFilaProps {
  /** Posición en la lista (0 = la primera): solo para el título "Entrega N". */
  index: number;
  fila: EntregaFormRow;
  errors: EntregaErrors | undefined;
  /** Los clientes para elegir, o `null` si la lista todavía no cargó (o falló). */
  clientes: readonly ClienteOpcion[] | null;
  carga: CargaClientes;
  onChange: (key: string, cambios: Partial<Pick<EntregaFormRow, 'clienteId' | 'incidencias'>>) => void;
  onQuitar: (key: string) => void;
  onRefrescarClientes: () => Promise<readonly ClienteOpcion[]>;
  /** Un cliente nuevo (o uno existente que se eligió): el formulario lo suma a la lista de la pantalla. */
  onClienteCreado: (cliente: ClienteOpcion) => void;
}

const CLIENTES_VACIO_HINT = 'Todavía no tienes clientes: crea el primero con «Nuevo cliente».';

/**
 * Una fila de la sección "Entregas": cliente (obligatorio), incidencias (opcional), "Quitar" y el
 * "+ Nuevo cliente" al vuelo. Va en un `memo`: con muchas filas y muchos clientes, tipear en una fila no
 * tiene por qué repintar todas las demás (las props de una fila que no cambió mantienen su identidad).
 */
export const EntregaFila = memo(function EntregaFila({
  index,
  fila,
  errors,
  clientes,
  carga,
  onChange,
  onQuitar,
  onRefrescarClientes,
  onClienteCreado,
}: EntregaFilaProps) {
  const [abierto, setAbierto] = useState(false);
  // A dónde vuelve el foco cuando se cierra el mini formulario (el elemento que tenía el foco se desmonta).
  const [foco, setFoco] = useState<{ destino: 'select' | 'boton'; n: number } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);

  const numero = index + 1;
  const tituloId = `entrega-${fila.key}-titulo`;
  const selectId = entregaDomId(fila.key, 'clienteId');

  useEffect(() => {
    if (!foco) return;
    if (foco.destino === 'select') document.getElementById(selectId)?.focus();
    else botonRef.current?.focus();
  }, [foco, selectId]);

  const opciones = useMemo(() => (clientes ?? []).map((cliente) => ({ value: cliente.id, label: cliente.nombre })), [clientes]);

  // Un cliente que no está en la lista (no cargó, o ya no existe) se muestra como "sin elegir": si el
  // `<select>` recibiera un valor sin opción, el navegador mostraría OTRO cliente sin avisar.
  const valor = clientes?.some((cliente) => cliente.id === fila.clienteId) ? fila.clienteId : '';

  const incidenciasLength = charLength(fila.incidencias, MAX_INCIDENCIAS);

  const placeholder =
    carga === 'listo' ? 'Elige un cliente' : carga === 'error' ? 'No se pudo cargar la lista' : 'Cargando clientes…';

  function seleccionar(cliente: ClienteOpcion) {
    onClienteCreado(cliente);
    onChange(fila.key, { clienteId: cliente.id });
    setAbierto(false);
    setFoco((previo) => ({ destino: 'select', n: (previo?.n ?? 0) + 1 }));
  }

  function cancelar() {
    setAbierto(false);
    setFoco((previo) => ({ destino: 'boton', n: (previo?.n ?? 0) + 1 }));
  }

  return (
    <li>
      <div role="group" aria-labelledby={tituloId} className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 id={tituloId} className="text-base font-semibold">
            Entrega {numero}
          </h3>
          <Button
            type="button"
            variant="outline"
            className="border-destructive/50 text-destructive-text"
            aria-label={`Quitar entrega ${numero}`}
            onClick={() => onQuitar(fila.key)}
          >
            <Trash2 aria-hidden="true" /> Quitar
          </Button>
        </div>

        <SelectField
          id={selectId}
          label="Cliente"
          value={valor}
          onChange={(clienteId) => onChange(fila.key, { clienteId })}
          options={opciones}
          placeholder={placeholder}
          disabled={clientes === null}
          hint={clientes !== null && clientes.length === 0 ? CLIENTES_VACIO_HINT : undefined}
          error={errors?.clienteId}
        />

        {abierto && clientes !== null ? (
          <div>
            <NuevoClienteInline
              idPrefix={`entrega-${fila.key}-cliente-nuevo`}
              clientes={clientes}
              onRefrescar={onRefrescarClientes}
              onSeleccionar={seleccionar}
              onCancelar={cancelar}
            />
          </div>
        ) : (
          <Button
            ref={botonRef}
            type="button"
            variant="outline"
            disabled={clientes === null}
            onClick={() => setAbierto(true)}
          >
            <Plus aria-hidden="true" /> Nuevo cliente
          </Button>
        )}

        <TextareaField
          id={entregaDomId(fila.key, 'incidencias')}
          label="Incidencias"
          optional
          rows={2}
          value={fila.incidencias}
          onChange={(incidencias) => onChange(fila.key, { incidencias })}
          hint={
            incidenciasLength > MAX_INCIDENCIAS
              ? `Más de ${MAX_INCIDENCIAS} caracteres: acórtalas.`
              : incidenciasLength >= TEXTO_COUNTER_FROM
                ? `${incidenciasLength} de ${MAX_INCIDENCIAS} caracteres`
                : undefined
          }
          error={errors?.incidencias}
        />
      </div>
    </li>
  );
});
