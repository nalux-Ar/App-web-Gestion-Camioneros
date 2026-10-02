import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InlineError } from '@/components/shared/inline-error';
import { Spinner } from '@/components/shared/spinner';
import { cn } from '@/lib/utils';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { useMember } from '@/features/member/use-member';
import { GUARDAR_NOMBRE_CONTEXT, validateNombre } from './nombre';
import { useActualizarNombre } from './use-actualizar-nombre';

const INPUT_ID = 'nombre-cuenta';
const ERROR_ID = 'nombre-cuenta-error';
const HINT_ID = 'nombre-cuenta-hint';

/**
 * Tarjeta "Nombre" de Configuración: el administrador edita el nombre de la
 * cuenta (el transportista), que se ve en el encabezado y en el saludo del inicio.
 *
 * A diferencia del tema y el color de acento (que se autoguardan), esto es un
 * guardado explícito con botón "Guardar". Resiliencia (patrón de
 * src/lib/use-submit-feedback.ts):
 *  - Lo tipeado NO se limpia si el guardado falla; "Reintentar" reenvía el mismo valor.
 *  - Doble toque bloqueado (el guard de `run` es un ref, no solo el `disabled`).
 *  - El contexto de miembro se actualiza solo cuando la base confirma
 *    (ver `useActualizarNombre`), no antes.
 *
 * Quién puede: solo el rol `admin` (la base lo exige con RLS; acá se deshabilita
 * para que un chofer no toque un botón que no va a funcionar). El `transportista_id`
 * sale SIEMPRE del contexto, nunca de la URL ni de un input.
 */
export function NombreCard() {
  const { member } = useMember();
  const actualizar = useActualizarNombre();
  const { run, pending, error, retryable, clearError } = useSubmitFeedback({ context: GUARDAR_NOMBRE_CONTEXT });

  const inputRef = useRef<HTMLInputElement>(null);

  const currentName = member?.transportistaNombre ?? '';
  const puedeEditar = member?.rol === 'admin';

  const [draft, setDraft] = useState(currentName);
  // El nombre del contexto que el campo tomó como punto de partida. Si el
  // contexto cambia desde afuera (p. ej. se recargó el miembro), el campo
  // acompaña SOLO si la persona no había editado nada; si ya estaba tipeando,
  // se respeta lo suyo. Es el patrón "ajustar estado durante el render" de
  // React (setState condicional al propio estado), el mismo de MemberProvider:
  // sin efecto, sin un render intermedio con el nombre viejo.
  const [baseline, setBaseline] = useState(currentName);
  if (baseline !== currentName) {
    setBaseline(currentName);
    if (draft === baseline) setDraft(currentName);
  }

  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Comparación con el valor recortado: "Juan " y "Juan" son lo mismo.
  const changed = draft.trim() !== currentName;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setDraft(event.target.value);
    // Volver a tipear descarta el aviso anterior (validación, error de guardado o "guardado").
    setValidationError(null);
    setSaved(false);
    clearError();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member || member.rol !== 'admin' || pending) return;

    const validation = validateNombre(draft);
    if (!validation.ok) {
      setValidationError(validation.message);
      // El foco vuelve al campo con error: se anuncia el mensaje y se puede corregir de una.
      inputRef.current?.focus();
      return;
    }
    // Sin cambios no hay nada que guardar (el botón ya va deshabilitado; esto cubre el Enter).
    if (validation.value === member.transportistaNombre) return;

    // Se captura AHORA: es el tenant al que pertenece este guardado, aunque mientras
    // la base responde cambie el usuario o el tenant.
    const transportistaId = member.transportistaId;
    setValidationError(null);
    setSaved(false);

    // `keepLocked: false`: la tarjeta sigue montada tras guardar, hay que poder volver a guardar.
    const result = await run(() => actualizar.mutateAsync({ transportistaId, nombre: validation.value }), {
      keepLocked: false,
    });
    if (!result.ok) return; // el error ya se muestra, sin tocar lo tipeado

    // El campo queda con lo que guardó la base (sin los espacios de los costados) y el
    // botón vuelve a deshabilitarse (valor sin cambios).
    setDraft(result.data);
    setSaved(true);
  }

  const describedBy = [validationError ? ERROR_ID : null, !puedeEditar ? HINT_ID : null].filter(Boolean).join(' ');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nombre</CardTitle>
        <CardDescription>Es el nombre de tu cuenta: aparece en el encabezado y en el saludo del inicio.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={INPUT_ID}>Nombre de la cuenta</Label>
            {/* Sin `maxLength`: cortar en silencio lo que se pega es peor que avisar
                (mismo criterio que TextareaField). El límite se valida al guardar, con mensaje.
                `readOnly` (y no `disabled`) mientras guarda: el teclado del celular no se cierra
                y no se puede cambiar el texto a mitad del guardado. Lo mismo para quien no es
                administrador: `disabled` atenúa el texto (opacity-50) y en el celular esta tarjeta
                es donde un chofer lee el nombre de la cuenta, así que se deja legible y con fondo
                apagado para que no parezca editable. */}
            <Input
              id={INPUT_ID}
              ref={inputRef}
              value={draft}
              onChange={handleChange}
              autoComplete="organization"
              readOnly={pending || !puedeEditar}
              aria-readonly={!puedeEditar}
              className={cn(!puedeEditar && 'bg-muted text-muted-foreground')}
              aria-invalid={validationError !== null}
              aria-describedby={describedBy || undefined}
            />
            {validationError ? (
              <p id={ERROR_ID} role="alert" className="text-sm text-destructive-text">
                {validationError}
              </p>
            ) : null}
            {!puedeEditar ? (
              <p id={HINT_ID} className="text-sm text-muted-foreground">
                Solo el administrador de la cuenta puede cambiar el nombre.
              </p>
            ) : null}
          </div>

          {/* Si el error no se arregla reintentando (0 filas, sin permiso, datos inválidos), `retryable`
              es false y no se ofrece "Reintentar". Con red caída o timeout, "Reintentar" es un botón
              submit: reenvía el mismo valor. El aviso de "sin conexión" ya lo da el OfflineBanner de la
              pantalla: no se repite acá. */}
          {error ? <InlineError message={error} retryAsSubmit={retryable} /> : null}

          <Button type="submit" className="w-full sm:w-auto" disabled={!puedeEditar || pending || !changed} aria-busy={pending}>
            {pending ? (
              <>
                <Spinner /> Guardando…
              </>
            ) : (
              'Guardar'
            )}
          </Button>

          {/* Siempre en el DOM: los lectores de pantalla anuncian el texto cuando aparece. */}
          <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {pending ? <span className="sr-only">Guardando…</span> : saved ? 'Nombre guardado.' : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
