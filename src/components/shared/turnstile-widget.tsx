import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TURNSTILE_ENABLED } from '@/lib/turnstile-config';
import { TURNSTILE_SITE_KEY, loadTurnstile } from '@/lib/turnstile';

export interface TurnstileWidgetHandle {
  /** Descarta el token actual (avisa `null` al padre) y pide uno nuevo. Un
   *  token de Turnstile sirve UNA sola vez: hay que llamarlo después de cada
   *  intento de envío, salga bien o mal. */
  reset: () => void;
}

interface TurnstileWidgetProps {
  /** Token nuevo cuando se verifica; `null` cuando se descarta o vence. */
  onTokenChange: (token: string | null) => void;
  /** `true` cuando hay algo que el usuario tiene que hacer: la casilla de
   *  Cloudflare está visible (hay que marcarla) o el widget falló y se está
   *  mostrando el aviso con "Reintentar". `false` cuando Cloudflare está
   *  verificando por su cuenta. Sirve para que el botón de envío diga
   *  "Completa la verificación" (sin spinner) en vez de "Verificando…". */
  onActionRequiredChange?: (required: boolean) => void;
  /** React 19: `ref` viaja como prop normal, no hace falta forwardRef. */
  ref?: Ref<TurnstileWidgetHandle>;
}

/**
 * - `working`: Cloudflare está verificando por su cuenta (invisible).
 * - `interactive`: Cloudflare pidió interacción; la casilla está visible y se
 *   puede completar. Sin aviso de error.
 * - `failed`: falla real; se muestra el aviso con "Reintentar".
 */
type Phase = 'working' | 'interactive' | 'failed';

/** Familias de error de Cloudflare que Turnstile reintenta por su cuenta con
 *  `retry: 'auto'`: 300xxx y 600xxx (fallos genéricos del cliente o del
 *  desafío, p. ej. 600010). El resto (1xxxxx/400xxx de configuración o
 *  sitekey, 200xxx de carga, etc.) no se arregla reintentando. */
function isRetryableTurnstileError(errorCode: unknown): boolean {
  return typeof errorCode === 'string' && /^(300|600)\d{3}$/.test(errorCode);
}

/** Tras un error reintentable, si en este tiempo no llega ni token ni
 *  interacción, se muestra el aviso: no dejar "Verificando…" para siempre. */
const RETRYABLE_SAFETY_NET_MS = 20_000;

/**
 * Captcha de Cloudflare Turnstile en modo `interaction-only`: casi siempre
 * es invisible y se resuelve solo; solo aparece si Cloudflare necesita que el
 * usuario haga algo. El token vive únicamente en el estado del padre (nunca
 * en storage) y no se loguea en ningún lado.
 *
 * Errores: un error reintentable (300xxx/600xxx) NO es una falla: Cloudflare
 * reintenta solo y muchas veces termina pidiendo la casilla. Ahí solo se
 * descarta el token y el botón sigue en "Verificando…" (o en "Completa la
 * verificación" si la casilla ya está visible). El aviso rojo con
 * "Reintentar" queda para errores no reintentables, timeout del desafío,
 * fallo de carga del script (incluido su timeout de 15 s), `render` sin
 * widget, o un error reintentable que no se resuelve en ~20 s. Un token
 * vencido tampoco es una falla: con `refresh-expired: 'auto'` Cloudflare lo
 * renueva solo. El padre no pierde nada de lo tipeado: este componente no
 * toca el formulario.
 *
 * Pausa: con `TURNSTILE_ENABLED` apagado (src/lib/turnstile-config.ts) no
 * renderiza nada, no carga el script de Cloudflare y no crea timers. Los
 * hooks se llaman igual (las reglas de hooks no admiten un return temprano
 * antes de ellos): el efecto y `reset` simplemente no hacen nada.
 */
export function TurnstileWidget({ onTokenChange, onActionRequiredChange, ref }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>('working');
  const safetyNetTimerRef = useRef<number | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const onActionRequiredChangeRef = useRef(onActionRequiredChange);
  const [phase, setPhase] = useState<Phase>('working');
  // Se incrementa para volver a correr el efecto de montaje cuando no hay un
  // widget vivo que resetear (falló la CARGA del script, o `render` no
  // devolvió un widget): hay que empezar de cero.
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
    onActionRequiredChangeRef.current = onActionRequiredChange;
  }, [onTokenChange, onActionRequiredChange]);

  const updatePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
    onActionRequiredChangeRef.current?.(next !== 'working');
  }, []);

  const clearSafetyNet = useCallback(() => {
    if (safetyNetTimerRef.current !== null) {
      window.clearTimeout(safetyNetTimerRef.current);
      safetyNetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Pausado: no se carga el script de Cloudflare ni se arma ningún timer.
    if (!TURNSTILE_ENABLED) return;

    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    function markFailed(): void {
      clearSafetyNet();
      onTokenChangeRef.current(null);
      updatePhase('failed');
    }

    function handleError(errorCode: unknown): void {
      if (!isRetryableTurnstileError(errorCode)) {
        markFailed();
        return;
      }

      // Reintentable: Cloudflare vuelve a intentar solo. Se descarta el
      // token y no se toca la fase (si la casilla ya está visible, sigue
      // visible y sin aviso). Si todavía está verificando de fondo, se
      // arma la red de seguridad UNA sola vez por racha de errores (no se
      // reinicia con cada error, o nunca llegaría a saltar).
      onTokenChangeRef.current(null);
      if (phaseRef.current === 'working' && safetyNetTimerRef.current === null) {
        safetyNetTimerRef.current = window.setTimeout(() => {
          safetyNetTimerRef.current = null;
          if (!cancelled && phaseRef.current === 'working') markFailed();
        }, RETRYABLE_SAFETY_NET_MS);
      }
    }

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        try {
          const widgetId = turnstile.render(container, {
            sitekey: TURNSTILE_SITE_KEY,
            appearance: 'interaction-only',
            theme: 'dark',
            language: 'es',
            retry: 'auto',
            'refresh-expired': 'auto',
            callback: (token) => {
              clearSafetyNet();
              updatePhase('working');
              onTokenChangeRef.current(token);
            },
            // Vencido no es falla: Cloudflare renueva el token solo (auto).
            // Solo se descarta el que quedó viejo.
            'expired-callback': () => onTokenChangeRef.current(null),
            'error-callback': handleError,
            'timeout-callback': markFailed,
            // La casilla se hace visible: hay que marcarla. Sin aviso rojo.
            'before-interactive-callback': () => {
              clearSafetyNet();
              updatePhase('interactive');
            },
            // La casilla dejó de estar visible: el token llega por `callback`.
            'after-interactive-callback': () => updatePhase('working'),
          });
          if (!widgetId) {
            // Sin id no hay nada que resetear ni que limpiar después: se
            // trata como falla y el widget queda sin registrar.
            markFailed();
            return;
          }
          widgetIdRef.current = widgetId;
        } catch {
          markFailed();
        }
      })
      .catch(() => {
        if (!cancelled) markFailed();
      });

    return () => {
      cancelled = true;
      clearSafetyNet();
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId) {
        try {
          window.turnstile?.remove(widgetId);
        } catch {
          // El widget ya no estaba: nada que limpiar.
        }
      }
    };
  }, [loadAttempt, updatePhase, clearSafetyNet]);

  const reset = useCallback(() => {
    // Pausado: no hay widget ni token que descartar (y no hay que re-armar
    // el efecto de montaje con `setLoadAttempt`).
    if (!TURNSTILE_ENABLED) return;

    clearSafetyNet();
    onTokenChangeRef.current(null);
    updatePhase('working');

    // Solo se usa el id si es uno válido; si no hay (nunca hubo widget o
    // `render` no devolvió uno), se recarga el widget de cero.
    const widgetId = widgetIdRef.current;
    if (widgetId && window.turnstile) {
      try {
        window.turnstile.reset(widgetId);
        return;
      } catch {
        // Cae a recargar el widget de cero.
      }
    }
    setLoadAttempt((attempt) => attempt + 1);
  }, [clearSafetyNet, updatePhase]);

  useImperativeHandle(ref, () => ({ reset }), [reset]);

  if (!TURNSTILE_ENABLED) return null;

  return (
    <div>
      {/* `-mx-3`: el widget de Turnstile mide 300px de ancho fijo y, en un
          celular de 360px, el contenido de la tarjeta queda en ~278px. Con
          esto gana los 24px que le faltan cuando le toca mostrarse. */}
      <div ref={containerRef} className="-mx-3 flex justify-center" />
      {phase === 'failed' ? (
        <Alert variant="destructive" className="mt-3">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            <p>No pudimos verificar que no eres un robot. Revisa tu conexión e inténtalo de nuevo.</p>
            <p className="mt-1">Si usas un bloqueador de anuncios, desactívalo para esta página.</p>
            <Button type="button" size="sm" variant="outline" className="mt-2 text-foreground" onClick={reset}>
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
