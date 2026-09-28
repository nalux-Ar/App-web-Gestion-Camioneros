import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setSubmitting(false);
      setError(mapAuthError(signInError));
      return;
    }

    navigate(redirectTo, { replace: true });
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="text-2xl">Ingresar</CardTitle>
        <CardDescription>Entrá con tu email y tu contraseña.</CardDescription>
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
                ¿Te olvidaste la contraseña?
              </Link>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Spinner /> Ingresando…
              </>
            ) : (
              'Ingresar'
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ¿Todavía no tenés cuenta?{' '}
            <Link to="/registro" className="text-primary underline-offset-4 hover:underline">
              Creá una acá
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
