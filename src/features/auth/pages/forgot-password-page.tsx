import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/shared/turnstile-widget';
import { supabase } from '@/lib/supabase';
import { TURNSTILE_ENABLED } from '@/lib/turnstile-config';
import { EmailField } from '../components/email-field';
import { FormError } from '../components/form-error';
import { isCaptchaError, isNetworkError, mapAuthError } from '../auth-errors';

const GENERIC_SENT_MESSAGE =
  'Si ese email tiene una cuenta en Elan, te enviamos un enlace para que elijas una contraseña nueva. Revisa tu correo (y la carpeta de spam).';

/**
 * Por diseño, este formulario muestra SIEMPRE el mismo resultado exista o
 * no una cuenta con ese email (evita que alguien use el formulario para
 * confirmar qué emails están registrados). La única excepción es un error
 * de red real (el pedido ni siquiera llegó a Supabase y tiene sentido
 * reintentar) y un error de captcha (el token no valió: no hubo pedido real
 * y también hay que reintentar). Ninguno de los dos dice nada sobre si el
 * email existe.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retryableError, setRetryableError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaActionRequired, setCaptchaActionRequired] = useState(false);
  const captchaRef = useRef<TurnstileWidgetHandle>(null);
  // Con Turnstile pausado (src/lib/turnstile-config.ts) no se espera ningún
  // token: el botón no exige verificación y no se manda captcha a Supabase.
  const captchaPending = TURNSTILE_ENABLED && !captchaToken;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || captchaPending) return;

    setSubmitting(true);
    setRetryableError(null);

    // `resetPasswordForEmail` recibe `captchaToken` directamente en su objeto
    // de opciones (a diferencia de signIn/signUp, que lo llevan en `options`).
    let failure: unknown = null;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/restablecer-contrasena`,
        captchaToken: captchaToken ?? undefined,
      });
      failure = error;
    } catch (thrown) {
      failure = thrown;
    }

    // El token de Turnstile sirve una sola vez: se descarta y se pide uno
    // nuevo después de CADA intento, salga bien o mal (incluido un error de
    // red). Lo tipeado no se toca.
    captchaRef.current?.reset();
    setSubmitting(false);

    if (failure && (isNetworkError(failure) || isCaptchaError(failure))) {
      setRetryableError(mapAuthError(failure));
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <Card>
        <CardHeader className="items-center space-y-3 text-center">
          <MailCheck className="size-10 text-primary" aria-hidden="true" />
          <CardTitle className="text-2xl">Revisa tu correo</CardTitle>
          <CardDescription>{GENERIC_SENT_MESSAGE}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link to="/ingresar" className="text-sm text-primary underline-offset-4 hover:underline">
            Volver a ingresar
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="text-2xl">¿Olvidaste tu contraseña?</CardTitle>
        <CardDescription>Escribe tu email y te enviamos un enlace para elegir una nueva.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <OfflineBanner />
          <FormError message={retryableError} />
          <EmailField value={email} onChange={setEmail} disabled={submitting} />
          <TurnstileWidget
            ref={captchaRef}
            onTokenChange={setCaptchaToken}
            onActionRequiredChange={setCaptchaActionRequired}
          />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" size="lg" className="w-full" disabled={submitting || captchaPending}>
            {submitting ? (
              <>
                <Spinner /> Enviando…
              </>
            ) : captchaActionRequired ? (
              'Completa la verificación'
            ) : captchaPending ? (
              <>
                <Spinner /> Verificando…
              </>
            ) : (
              'Enviar enlace'
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/ingresar" className="text-primary underline-offset-4 hover:underline">
              Volver a ingresar
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
