import { useCallback, useState } from 'react';
import { AlertCircle, Info, Plus } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/shared/inline-error';
import type { ClienteOpcion } from '@/features/clientes/cliente-nombre';
import { CLIENTES_LIMIT } from '@/features/clientes/clientes-api';
import { MAX_ENTREGAS } from './constants';
import { EntregaFila, type CargaClientes } from './entrega-fila';
import { AGREGAR_ENTREGA_DOM_ID, ENTREGAS_DOM_ID } from './viaje-dom-ids';
import type { EntregaFormRow, ViajeFormErrors } from './viaje-form';

const TOPE_ENTREGAS_ID = 'viaje-entregas-tope';

/** "No hay entregas" / "Hay 1 entrega" / "Hay 3 entregas": para el aviso a lectores de pantalla. */
function textoCantidad(cantidad: number): string {
  if (cantidad === 0) return 'No hay entregas';
  return cantidad === 1 ? 'Hay 1 entrega' : `Hay ${cantidad} entregas`;
}

interface ViajeEntregasProps {
  entregas: readonly EntregaFormRow[];
  errors: ViajeFormErrors;
  /** Error de la sección en conjunto (ya filtrado: no se muestra el de "falta cargar clientes" si ya cargaron). */
  entregasGeneral: string | undefined;
  /** Los clientes para elegir (cargados + creados acá), o `null` si la lista todavía no cargó o falló. */
  clientes: readonly ClienteOpcion[] | null;
  /** Había más clientes que el tope: la lista es parcial. */
  clientesTruncado: boolean;
  carga: CargaClientes;
  /** Si la lista de clientes falló: el mensaje (ya en español) y cómo reintentar. */
  errorClientes: { message: string; reintentando: boolean; onReintentar: () => void } | null;
  onAgregar: () => void;
  onQuitar: (key: string) => void;
  onChange: (key: string, cambios: Partial<Pick<EntregaFormRow, 'clienteId' | 'incidencias'>>) => void;
  onRefrescarClientes: () => Promise<readonly ClienteOpcion[]>;
  onClienteCreado: (cliente: ClienteOpcion) => void;
}

/**
 * Sección "Entregas" del viaje: de 0 a 100 filas (se puede guardar un viaje sin entregas: no se exige una
 * mínima), en el orden en que se cargaron. No hay reordenamiento (la base no tiene columna de orden). Un
 * mismo cliente puede estar en dos filas.
 *
 * Si la lista de clientes no carga, el error con "Reintentar" va acá dentro y las filas (con lo que se
 * tipeó) se conservan: nada se borra.
 */
export function ViajeEntregas({
  entregas,
  errors,
  entregasGeneral,
  clientes,
  clientesTruncado,
  carga,
  errorClientes,
  onAgregar,
  onQuitar,
  onChange,
  onRefrescarClientes,
  onClienteCreado,
}: ViajeEntregasProps) {
  // Aviso para lectores de pantalla: al agregar o quitar una fila el foco se mueve, pero cuántas hay no se oye solo.
  const [anuncio, setAnuncio] = useState('');
  const llegoAlTope = entregas.length >= MAX_ENTREGAS;

  function agregar() {
    onAgregar();
    setAnuncio(`Entrega agregada. ${textoCantidad(entregas.length + 1)}.`);
  }

  // Estable mientras no cambie la cantidad (`memo` de las filas): tipear en una fila no repinta las demás.
  const cantidad = entregas.length;
  const quitar = useCallback(
    (key: string) => {
      onQuitar(key);
      setAnuncio(`Entrega quitada. ${textoCantidad(cantidad - 1)}.`);
    },
    [onQuitar, cantidad],
  );

  return (
    <section aria-labelledby={ENTREGAS_DOM_ID} className="space-y-4">
      <div className="space-y-1">
        {/* `tabIndex={-1}`: el foco puede llegar acá cuando falla la sección en conjunto. */}
        <h2 id={ENTREGAS_DOM_ID} tabIndex={-1} className="text-lg font-semibold">
          Entregas
        </h2>
        <p className="text-sm text-muted-foreground">
          Los clientes a los que entregas en este viaje. Puedes guardar el viaje sin entregas.
        </p>
      </div>

      {entregasGeneral ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive-text">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{entregasGeneral}</span>
        </p>
      ) : null}

      {errorClientes ? (
        <InlineError
          message={errorClientes.message}
          onRetry={errorClientes.onReintentar}
          retrying={errorClientes.reintentando}
        />
      ) : null}

      {clientesTruncado ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>
            Tienes más de {CLIENTES_LIMIT} clientes: aquí se muestran los primeros {CLIENTES_LIMIT}, por orden alfabético.
          </AlertDescription>
        </Alert>
      ) : null}

      {entregas.length > 0 ? (
        <ol className="space-y-4">
          {entregas.map((fila, index) => (
            <EntregaFila
              key={fila.key}
              index={index}
              fila={fila}
              errors={errors.entregas[fila.key]}
              clientes={clientes}
              carga={carga}
              onChange={onChange}
              onQuitar={quitar}
              onRefrescarClientes={onRefrescarClientes}
              onClienteCreado={onClienteCreado}
            />
          ))}
        </ol>
      ) : null}

      <div className="space-y-2">
        <Button
          id={AGREGAR_ENTREGA_DOM_ID}
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={llegoAlTope}
          aria-describedby={llegoAlTope ? TOPE_ENTREGAS_ID : undefined}
          onClick={agregar}
        >
          <Plus aria-hidden="true" /> Agregar entrega
        </Button>
        {llegoAlTope ? (
          <p id={TOPE_ENTREGAS_ID} className="text-sm text-muted-foreground">
            Llegaste al máximo de {MAX_ENTREGAS} entregas por viaje.
          </p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {anuncio}
      </p>
    </section>
  );
}
