import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/shared/turnstile-widget';
import { supabase } from '@/lib/supabase';
import { TURNSTILE_ENABLED } from '@/lib/turnstile-config';
import { getSafeRedirectPath } from '@/lib/safe-redirect';
import { EmailField } from '../components/email-field';
import { PasswordInput } from '../components/password-input';
import { FormError } from '../components/form-error';
import { mapAuthError } from '../auth-errors';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = getSafeRedirectPath(searchParams.get('volver'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);

    let failure: unknown = null;
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        options: { captchaToken: captchaToken ?? undefined },
      });
      failure = signInError;
    } catch (thrown) {
      failure = thrown;
    }

    // El token de Turnstile sirve una sola vez: se descarta y se pide uno
    // nuevo después de CADA intento, salga bien o mal (incluido un error de
    // red). Lo tipeado no se toca.
    captchaRef.current?.reset();

    if (failure) {
      setSubmitting(false);
      setError(mapAuthError(failure));
      return;
    }

    navigate(redirectTo, { replace: true });
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="text-2xl">Ingresar</CardTitle>
        <CardDescription>Ingresa con tu correo y tu contraseña.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <OfflineBanner />
          <FormError message={error} />
          <EmailField value={email} onChange={setEmail} disabled={submitting} />
          <div className="space-y-4">
            <PasswordInput
              label="Contraseña"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={submitting}
            />
            {/* Un botón de 48 px, con el texto a 16 px y 16 px de aire sobre el campo (antes era un enlace de ≈20 px de alto,
                pegado al campo). Sigue siendo un enlace (navega), con la forma de un botón. */}
            <div className="flex justify-end">
              <Button asChild variant="outline">
                <Link to="/recuperar-contrasena">Olvidé mi contraseña</Link>
              </Button>
            </div>
          </div>
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
                <Spinner /> Ingresando…
              </>
            ) : captchaActionRequired ? (
              'Completa la verificación'
            ) : captchaPending ? (
              <>
                <Spinner /> Verificando…
              </>
            ) : (
              'Ingresar'
            )}
          </Button>
          <p className="text-center text-base text-muted-foreground">
            ¿Aún no tienes cuenta?{' '}
            <Link to="/registro" className="text-primary underline-offset-4 hover:underline">
              Regístrate aquí
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
