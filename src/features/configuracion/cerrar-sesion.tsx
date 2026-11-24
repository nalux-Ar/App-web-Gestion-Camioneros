import { useEffect, useId, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/shared/inline-error';
import { Spinner } from '@/components/shared/spinner';
import { useAuth } from '@/features/auth/use-auth';

export const BOTON_CERRAR_SESION = 'Cerrar sesión';
export const PREGUNTA_CERRAR_SESION = '¿Cerrar sesión? Para volver a entrar necesitas tu correo y tu contraseña.';
export const CONFIRMAR_CERRAR_SESION = 'Sí, cerrar';
export const CANCELAR_CERRAR_SESION = 'No';
export const CERRANDO_SESION = 'Cerrando sesión…';
/** `signOut` no rechaza nunca; este texto es solo por si algún día lo hiciera (nunca queda un botón que no responde). */
export const CERRAR_SESION_FALLBACK_MESSAGE = 'No pudimos cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo.';

/**
 * «Cerrar sesión», dentro de la tarjeta «Tu cuenta» de Configuración (antes era un botón «Salir» en el encabezado, que cerraba sin
 * preguntar: un toque sin querer sacaba a la persona de la app, y volver a entrar cuesta el correo y la contraseña).
 *
 * Dos toques, sin ventana aparte (como `EmpezarDeNuevo` y `ConfirmDelete`):
 *
 *   [Cerrar sesión]  →  «¿Cerrar sesión? Para volver a entrar necesitas tu correo y tu contraseña.»  [Sí, cerrar] [No]
 *
 * El primer toque NO cierra nada. «No» cierra la pregunta y no hace nada más. «Sí, cerrar» llama a `signOut` del contexto de
 * autenticación (la misma función de siempre: la limpieza de cachés y del estado local, y la navegación a /ingresar, las hace
 * `AuthProvider`). `signOut` NUNCA rechaza: devuelve un resultado; si no se pudo cerrar (la sesión sigue viva) se muestra su
 * mensaje acá mismo y se puede volver a intentar. Mientras cierra, los dos botones quedan apagados y dicen «Cerrando sesión…», y un
 * guard (un ref, no solo el `disabled`: dos toques seguidos pueden entrar antes de que React repinte) impide llamarlo dos veces.
 * Tras un cierre exitoso el guard sigue puesto: la pantalla se desmonta al navegar y no hay nada que reintentar.
 *
 * Foco: al abrir la pregunta pasa a «No» (la opción segura) y al cancelar vuelve a «Cerrar sesión».
 */
export function CerrarSesion() {
  const { signOut } = useAuth();
  const [confirmando, setConfirmando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);

  const preguntaId = useId();
  const pedirRef = useRef<HTMLButtonElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const veniaConfirmando = useRef(false);

  useEffect(() => {
    if (confirmando) cancelarRef.current?.focus();
    else if (veniaConfirmando.current) pedirRef.current?.focus();
    veniaConfirmando.current = confirmando;
  }, [confirmando]);

  async function cerrar() {
    if (enCurso.current) return;
    enCurso.current = true;
    setCerrando(true);
    setError(null);
    let sigueAdentro = true;
    try {
      const resultado = await signOut();
      if (resultado.ok) sigueAdentro = false;
      else setError(resultado.message);
    } catch {
      setError(CERRAR_SESION_FALLBACK_MESSAGE);
    } finally {
      // Con la sesión cerrada se queda bloqueado (la pantalla se va sola); si no se pudo cerrar, se puede volver a intentar.
      if (sigueAdentro) {
        enCurso.current = false;
        setCerrando(false);
      }
    }
  }

  function cancelar() {
    if (enCurso.current) return;
    setError(null);
    setConfirmando(false);
  }

  if (!confirmando) {
    return (
      <Button ref={pedirRef} type="button" size="lg" variant="outline" className="w-full sm:w-auto" onClick={() => setConfirmando(true)}>
        <LogOut aria-hidden="true" /> {BOTON_CERRAR_SESION}
      </Button>
    );
  }

  return (
    <div role="group" aria-labelledby={preguntaId} className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <p id={preguntaId} className="text-base font-medium">
        {PREGUNTA_CERRAR_SESION}
      </p>
      {error ? <InlineError message={error} /> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" size="lg" disabled={cerrando} aria-busy={cerrando} onClick={() => void cerrar()}>
          {cerrando ? (
            <>
              <Spinner className="size-4" /> {CERRANDO_SESION}
            </>
          ) : (
            CONFIRMAR_CERRAR_SESION
          )}
        </Button>
        <Button ref={cancelarRef} type="button" size="lg" variant="outline" disabled={cerrando} onClick={cancelar}>
          {CANCELAR_CERRAR_SESION}
        </Button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {cerrando ? CERRANDO_SESION : ''}
      </span>
    </div>
  );
}
