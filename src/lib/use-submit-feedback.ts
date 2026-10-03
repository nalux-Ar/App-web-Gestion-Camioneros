import { useCallback, useRef, useState } from 'react';

import { isRetryableDataError, mapDataError, type DataErrorContext } from '@/lib/data-errors';

/**
 * PATRÓN DE RESILIENCIA DE FORMULARIOS (leer antes de armar un formulario)
 *
 * El público de la app guarda gastos desde el celular, en ruta, con señal
 * intermitente. Perder lo tipeado porque se cortó la señal justo al tocar
 * "Guardar" es lo peor que puede pasar en un formulario. Por eso:
 *
 *  1. El estado del formulario (los `useState` de cada campo, como texto)
 *     NUNCA se limpia si el guardado falla. Solo se resetea o se navega
 *     cuando el guardado salió bien. Esta regla la cumple quien arma el
 *     formulario: este hook nunca toca el estado de los campos.
 *  2. Al fallar, se muestra el error (ícono + texto, nunca solo color) con
 *     un botón "Reintentar" que reenvía los MISMOS valores. Sin red, el
 *     aviso "No hay conexión" sale antes de tocar nada (`OfflineBanner`).
 *  3. Mientras envía: botón deshabilitado con "Guardando…" y un guard contra
 *     el doble toque (un ref, no solo el `disabled`, porque dos toques
 *     seguidos pueden entrar antes de que React repinte el botón).
 *     Tras un guardado EXITOSO el guard sigue puesto (`keepLocked`, por
 *     defecto): entre el éxito y el final de la navegación (p.ej. se está
 *     bajando el chunk lazy de la pantalla siguiente, con mala señal) el
 *     botón NO vuelve a habilitarse, o un segundo toque duplicaría el
 *     registro. `pending` sigue en true y la pantalla se desmonta al
 *     navegar. Si el formulario sigue montado tras guardar ("Guardar y cargar
 *     otro"), llamar a `release()` después de resetearlo, o pasar
 *     `run(action, { keepLocked: false })`. Si falla, el guard se libera
 *     siempre (hay que poder reintentar).
 *  4. Nada de reintentos automáticos de escrituras (ver `queryClient`,
 *     `mutations.retry: 0` y `networkMode: 'always'`): el reintento lo decide
 *     la persona.
 *
 * Riesgo conocido que esto NO cubre: si el INSERT llegó al servidor pero se
 * perdió la respuesta (o saltó el timeout de escritura, ver
 * `writeTimeoutSignal` en db.ts: es exactamente el caso "respuesta perdida"),
 * "Reintentar" crea el registro dos veces. Solucionarlo
 * de verdad requiere idempotencia en la base (columna tipo `client_ref` con
 * UNIQUE por tenant, ver CONTEXT.md); hasta entonces el riesgo es acotado
 * porque el usuario ve la lista y puede borrar el duplicado.
 *
 * Ejemplo:
 *
 *   const crear = useMutation({ mutationFn: insertarGasto }); // tira el error si falla
 *   const { run, pending, error, retryable } = useSubmitFeedback();
 *
 *   async function handleSubmit(event: FormEvent) {
 *     event.preventDefault();                 // el <form> lleva noValidate
 *     const values = validar(state);          // errores por campo; null si hay alguno
 *     if (!values) return;
 *     const result = await run(() => crear.mutateAsync(values));
 *     if (result.ok) navigate('/gastos');     // SOLO si salió bien; sigue bloqueado hasta desmontar
 *   }
 *
 *   <form onSubmit={handleSubmit} noValidate>
 *     ...campos...
 *     <SubmitBar pending={pending} error={error} retryable={retryable} />
 *   </form>
 *
 * "Reintentar" del `SubmitBar` es un botón submit: vuelve a entrar en
 * `handleSubmit` con el estado intacto, o sea, los mismos valores.
 */

export type SubmitResult<T> = { ok: true; data: T } | { ok: false };

export interface RunOptions {
  /** Tras un guardado exitoso, mantener bloqueado (default: true). Ver punto 3 del patrón. */
  keepLocked?: boolean;
}

export interface SubmitFeedbackOptions {
  /** Mensajes propios para errores de datos (FK, único…). Definirlo como
   *  constante de módulo, no inline en el componente. */
  context?: DataErrorContext;
}

export function useSubmitFeedback({ context }: SubmitFeedbackOptions = {}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retryable: boolean } | null>(null);
  const inFlight = useRef(false);

  /**
   * Ejecuta el guardado. `action` tiene que TIRAR el error si falla (con
   * TanStack: `mutateAsync`). Si ya hay uno en curso (o quedó bloqueado
   * tras un éxito), ignora la llamada y devuelve `{ ok: false }`.
   */
  const run = useCallback(
    async <T>(action: () => Promise<T>, { keepLocked = true }: RunOptions = {}): Promise<SubmitResult<T>> => {
      if (inFlight.current) return { ok: false };
      inFlight.current = true;
      setPending(true);
      setFailure(null);
      let stayLocked = false;
      try {
        const data = await action();
        stayLocked = keepLocked;
        return { ok: true, data };
      } catch (error) {
        setFailure({ message: mapDataError(error, context), retryable: isRetryableDataError(error, context) });
        return { ok: false };
      } finally {
        if (!stayLocked) {
          inFlight.current = false;
          setPending(false);
        }
      }
    },
    [context],
  );

  /** Desbloquea tras un éxito (`keepLocked`) en un formulario que sigue montado. */
  const release = useCallback(() => {
    inFlight.current = false;
    setPending(false);
  }, []);

  const clearError = useCallback(() => setFailure(null), []);

  return {
    run,
    /** true mientras guarda y, tras un éxito, hasta `release()` o hasta que se desmonte. */
    pending,
    release,
    /** Mensaje listo para mostrar (español, nunca texto del servidor), o null. */
    error: failure?.message ?? null,
    /** false cuando reintentar daría lo mismo (check violado, sin permiso…). */
    retryable: failure?.retryable ?? true,
    clearError,
  };
}
