import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/shared/turnstile-widget';
import { supabase } from '@/lib/supabase';
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !captchaToken) return;

    setSubmitting(true);
    setError(null);

    let failure: unknown = null;
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        options: { captchaToken },
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
        <CardDescription>Ingresa con tu email y tu contraseña.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <OfflineBanner />
          <FormError message={error} />
          <EmailField value={email} onChange={setEmail} disabled={submitting} />
          <div className="space-y-1.5">
            <PasswordInput
              label="Contraseña"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={submitting}
            />
            <div className="text-right">
              <Link to="/recuperar-contrasena" className="text-sm text-primary underline-offset-4 hover:underline">
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
          </div>
          <TurnstileWidget
            ref={captchaRef}
            onTokenChange={setCaptchaToken}
            onActionRequiredChange={setCaptchaActionRequired}
          />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" size="lg" className="w-full" disabled={submitting || !captchaToken}>
            {submitting ? (
              <>
                <Spinner /> Ingresando…
              </>
            ) : captchaActionRequired ? (
              'Completa la verificación'
            ) : !captchaToken ? (
              <>
                <Spinner /> Verificando…
              </>
            ) : (
              'Ingresar'
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
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
