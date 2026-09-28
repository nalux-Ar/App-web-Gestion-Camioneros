import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
import { supabase } from '@/lib/supabase';
import { EmailField } from '../components/email-field';
import { PasswordInput } from '../components/password-input';
import { PasswordChecklist } from '../components/password-checklist';
import { FormError } from '../components/form-error';
import { mapAuthError } from '../auth-errors';
import { isPasswordValid } from '../password';

export function RegisterPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);

    if (!isPasswordValid(password)) {
      setError('Completá los requisitos de la contraseña.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/ingresar`,
      },
    });

    setSubmitting(false);

    if (signUpError) {
      setError(mapAuthError(signUpError));
      return;
    }

    if (data.session) {
      // Cuenta nueva, sesión inmediata (así está configurado el proyecto
      // hoy: sin confirmación de email). Directo al onboarding.
      navigate('/', { replace: true });
      return;
    }

    // `signUp` no tiró error pero tampoco abrió sesión: es lo que pasa con
    // "Confirm email" ACTIVADO. En ese modo Supabase contesta igual para un
    // email nuevo (manda el mail de confirmación) que para uno ya
    // registrado (no manda nada y no da error), así que la pantalla tiene
    // que servir para los dos casos sin decir cuál es: "revisá tu correo"
    // + la salida para quien ya tenía cuenta. Así no se revela si el
    // email existe.
    //
    // Con "Confirm email" DESACTIVADO (como está hoy) no se llega acá: un
    // email nuevo entra directo con sesión, y uno existente da error
    // (user_already_exists), que mapAuthError traduce a un mensaje
    // neutral. En ese modo la enumeración por registro no se puede cerrar
    // del todo desde el front (un email nuevo entra y uno existente no);
    // la solución de fondo es activar "Confirm email" antes de producción.
    setCheckEmail(true);
  }

  if (checkEmail) {
    return (
      <Card>
        <CardHeader className="items-center space-y-3 text-center">
          <MailCheck className="size-10 text-primary" aria-hidden="true" />
          <CardTitle className="text-2xl">Revisá tu correo</CardTitle>
          <CardDescription>
            Si el email es nuevo, te mandamos un mail para confirmar la cuenta. Abrilo y tocá el link (fijate
            también en correo no deseado).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2 text-center text-sm">
          <p className="text-muted-foreground">¿Ya tenías cuenta con ese email?</p>
          <Link to="/ingresar" className="text-primary underline-offset-4 hover:underline">
            Ingresar
          </Link>
          <Link to="/recuperar-contrasena" className="text-primary underline-offset-4 hover:underline">
            Recuperar la contraseña
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="text-2xl">Crear cuenta</CardTitle>
        <CardDescription>Con tu email y una contraseña alcanza para arrancar.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <OfflineBanner />
          <FormError message={error} />
          <EmailField value={email} onChange={setEmail} disabled={submitting} />
          <PasswordInput
            label="Contraseña"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={submitting}
          />
          <PasswordChecklist password={password} />
          <div className="space-y-1.5">
            <PasswordInput
              label="Repetí la contraseña"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              disabled={submitting}
            />
            {!passwordsMatch && <p className="text-sm text-destructive-text">Las contraseñas no coinciden.</p>}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Spinner /> Creando cuenta…
              </>
            ) : (
              'Crear cuenta'
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tenés cuenta?{' '}
            <Link to="/ingresar" className="text-primary underline-offset-4 hover:underline">
              Ingresá acá
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
