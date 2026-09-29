import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
import { supabase } from '@/lib/supabase';
import { clearRecoveryPending } from '@/lib/recovery-lock';
import { useAuth } from '../use-auth';
import { PasswordInput } from '../components/password-input';
import { PasswordChecklist } from '../components/password-checklist';
import { FormError } from '../components/form-error';
import { mapAuthError } from '../auth-errors';
import { isPasswordValid } from '../password';

/**
 * `src/lib/process-auth-redirect.ts` procesa el enlace del correo apenas
 * arranca la app (antes de montar cualquier pantalla): canjea el
 * `token_hash` con `verifyOtp` (o el fragmento legado con `setSession`),
 * así que para cuando este componente se monta ya sabemos si hay sesión o
 * no. Sin sesión = enlace vencido, ya usado, o la página se abrió directo
 * sin pasar por el correo (los tres casos muestran el mismo mensaje: no hay
 * forma de distinguirlos de manera útil para quien lo está leyendo).
 */
export function ResetPasswordPage() {
  const { session, status } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'loading') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner className="size-8 text-primary" />
          <p className="text-sm text-muted-foreground">Comprobando el enlace…</p>
        </CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card>
        <CardHeader className="items-center space-y-3 text-center">
          <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
          <CardTitle className="text-2xl">El enlace venció o ya se usó</CardTitle>
          <CardDescription>Pide un enlace nuevo para elegir tu contraseña.</CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button asChild size="lg">
            <Link to="/recuperar-contrasena">Pedir un enlace nuevo</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || cancelling) return;

    setError(null);

    if (!isPasswordValid(password)) {
      setError('Completa los requisitos de la contraseña.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(mapAuthError(updateError));
      return;
    }

    // Ya eligió la contraseña nueva: la sesión de recuperación deja de
    // estar "pendiente", puede entrar a la app con normalidad.
    clearRecoveryPending();
    navigate('/', { replace: true });
  }

  async function handleCancel() {
    if (submitting || cancelling) return;
    setCancelling(true);
    try {
      // scope: 'local' = solo limpia el storage de este navegador, no
      // depende de tener señal.
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      clearRecoveryPending();
      setCancelling(false);
      navigate('/ingresar', { replace: true });
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="text-2xl">Elige tu nueva contraseña</CardTitle>
        {/* Se muestra el correo completo, sin enmascarar, a propósito: si
            alguien le manda a la víctima un enlace de recuperación propio,
            la sesión que se abre es la de la cuenta del atacante. Ver de
            qué cuenta es la contraseña que se está por elegir es lo que le
            permite darse cuenta y presionar Cancelar. */}
        <CardDescription>
          {session.user.email ? (
            <>
              Vas a elegir la contraseña de <strong className="break-all">{session.user.email}</strong>. Si no es tu
              cuenta, presiona Cancelar.
            </>
          ) : (
            'Vas a elegir la contraseña de esta cuenta. Si no es tu cuenta, presiona Cancelar.'
          )}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <OfflineBanner />
          <FormError message={error} />
          <PasswordInput
            label="Contraseña nueva"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={submitting || cancelling}
          />
          <PasswordChecklist password={password} />
          <PasswordInput
            label="Repite la contraseña"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            disabled={submitting || cancelling}
          />
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" size="lg" className="w-full" disabled={submitting || cancelling}>
            {submitting ? (
              <>
                <Spinner /> Guardando…
              </>
            ) : (
              'Guardar contraseña'
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={submitting || cancelling}
            onClick={() => void handleCancel()}
          >
            {cancelling ? (
              <>
                <Spinner /> Cancelando…
              </>
            ) : (
              'Cancelar'
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
