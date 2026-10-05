import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InlineError } from '@/components/shared/inline-error';
import { Spinner } from '@/components/shared/spinner';
import { useTenantId } from '@/features/member/use-tenant-id';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { altaCliente, estadoInicialAlta, type AltaClienteEstado } from './cliente-alta';
import { CREAR_CLIENTE_CONTEXT, validateNombreCliente, type ClienteOpcion } from './cliente-nombre';
import { useCrearCliente } from './use-crear-cliente';

interface NuevoClienteInlineProps {
  /** Prefijo de los ids del DOM: único por fila (varias filas pueden tener el mini formulario abierto). */
  idPrefix: string;
  /** Los clientes conocidos ahora: la lista cargada + los creados en esta pantalla. Sirve para avisar de un duplicado. */
  clientes: readonly ClienteOpcion[];
  /** Se creó el cliente, o se eligió usar uno que ya existía: hay que dejarlo seleccionado. */
  onSeleccionar: (cliente: ClienteOpcion) => void;
  onCancelar: () => void;
}

/**
 * Mini formulario "+ Nuevo cliente" EN LÍNEA, dentro de la fila de una entrega: solo el nombre. No es un
 * `<form>` (iría anidado dentro del formulario del viaje, que es HTML inválido): el Enter del campo se
 * intercepta y los botones son `type="button"`.
 *
 * Duplicados (solo en el front: la base no tiene unique por nombre porque bloquearía homónimos
 * legítimos): si el nombre normalizado ya está en la lista, NO crea y avisa "Ya tienes un cliente llamado
 * «X»." con dos salidas, "Usar ese" y "Crear de todos modos".
 *
 * Reintentos (ver `altaCliente` y `crearClienteIdempotente`): el mini formulario genera un `client_ref` al abrirse y lo
 * manda IGUAL en cada "Reintentar". Si la creación falló por red o timeout pero el cliente se creó igual (se perdió la
 * respuesta), la base reconoce la clave y el reintento usa ESE cliente en vez de crear otro. Lo tipeado nunca se borra
 * por un error. Al crear bien el mini formulario se cierra: la próxima vez que se abra, la clave es otra.
 */
export function NuevoClienteInline({ idPrefix, clientes, onSeleccionar, onCancelar }: NuevoClienteInlineProps) {
  const tenantId = useTenantId();
  const crear = useCrearCliente();
  const { run, pending, error, retryable, clearError } = useSubmitFeedback({ context: CREAR_CLIENTE_CONTEXT });

  const [nombre, setNombre] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<ClienteOpcion | null>(null);
  // Lo que hay que recordar entre intentos: la clave de idempotencia (una por apertura del mini formulario), las huellas de
  // lo mandado y los nombres que ya pasaron el aviso de duplicado.
  const estadoRef = useRef<AltaClienteEstado>(estadoInicialAlta());
  const inputRef = useRef<HTMLInputElement>(null);
  const usarRef = useRef<HTMLButtonElement>(null);

  const inputId = `${idPrefix}-nombre`;
  const errorId = `${idPrefix}-nombre-error`;

  // Al abrirse, el foco va al campo (en el celular abre el teclado).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Al aparecer el aviso de duplicado, el foco va a "Usar ese" (la opción que casi siempre se quiere).
  useEffect(() => {
    if (duplicado) usarRef.current?.focus();
  }, [duplicado]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setNombre(event.target.value);
    // Volver a tipear descarta los avisos anteriores: el de duplicado era de OTRO nombre.
    setValidationError(null);
    setDuplicado(null);
    clearError();
  }

  async function intentar(forzar: boolean) {
    if (pending) return;
    const validation = validateNombreCliente(nombre);
    if (!validation.ok) {
      setValidationError(validation.message);
      inputRef.current?.focus();
      return;
    }
    setValidationError(null);
    setDuplicado(null);

    // `keepLocked: false`: el mini formulario sigue montado tras un aviso de duplicado o un error. Solo el nombre: los
    // datos de contacto se completan desde la pantalla de Clientes.
    const result = await run(
      () =>
        altaCliente({
          datos: { nombre: validation.value },
          forzar,
          clientes,
          estado: estadoRef.current,
          io: { crear: async (args) => (await crear.mutateAsync({ tenantId, ...args })).cliente },
        }),
      { keepLocked: false },
    );
    if (!result.ok) return; // el error ya se muestra, sin tocar lo tipeado

    if (result.data.tipo === 'duplicado') {
      setDuplicado(result.data.existente);
      return;
    }
    onSeleccionar(result.data.cliente);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // El Enter de un campo suelto enviaría el formulario del viaje entero: acá crea el cliente.
    if (event.key === 'Enter') {
      event.preventDefault();
      void intentar(false);
    } else if (event.key === 'Escape' && !pending) {
      event.preventDefault();
      onCancelar();
    }
  }

  const describedBy = validationError ? errorId : undefined;

  return (
    <div role="group" aria-label="Nuevo cliente" className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>Nombre del cliente</Label>
        {/* Sin `maxLength`: cortar en silencio lo que se pega es peor que avisar (el límite se valida al crear). */}
        <Input
          id={inputId}
          ref={inputRef}
          value={nombre}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          enterKeyHint="done"
          readOnly={pending}
          aria-required="true"
          aria-invalid={validationError !== null ? true : undefined}
          aria-describedby={describedBy}
        />
        {validationError ? (
          <p id={errorId} role="alert" className="text-sm text-destructive-text">
            {validationError}
          </p>
        ) : null}
      </div>

      {duplicado ? (
        <Alert>
          <Info aria-hidden="true" />
          <div className="space-y-3">
            <AlertDescription className="font-medium">Ya tienes un cliente llamado «{duplicado.nombre}».</AlertDescription>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button ref={usarRef} type="button" onClick={() => onSeleccionar(duplicado)}>
                Usar ese
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => void intentar(true)}>
                Crear de todos modos
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}

      {/* Con red caída o timeout, "Reintentar" vuelve a mandar el mismo client_ref: si el intento anterior llegó, no se crea
          otro. Si el error no se arregla reintentando (nombre inválido), `retryable` es false y solo queda el mensaje. */}
      {error ? (
        <InlineError message={error} onRetry={retryable ? () => void intentar(false) : undefined} retrying={pending} />
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!duplicado ? (
          <Button type="button" disabled={pending} aria-busy={pending} onClick={() => void intentar(false)}>
            {pending ? (
              <>
                <Spinner /> Creando…
              </>
            ) : (
              'Crear cliente'
            )}
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={pending} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {pending ? 'Creando cliente…' : ''}
      </span>
    </div>
  );
}
