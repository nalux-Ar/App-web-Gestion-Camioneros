import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
import { supabase } from '@/lib/supabase';
import { EmailField } from '../components/email-field';
import { FormError } from '../components/form-error';
import { isNetworkError, mapAuthError } from '../auth-errors';

const GENERIC_SENT_MESSAGE =
  'Si ese email tiene una cuenta en Elan, te mandamos un link para que elijas una contraseña nueva. Revisá tu correo (y la carpeta de spam).';

/**
 * Por diseño, este formulario muestra SIEMPRE el mismo resultado exista o
 * no una cuenta con ese email (evita que alguien use el formulario para
 * confirmar qué emails están registrados). La única excepción es un error
 * de red real: ahí sí conviene avisar distinto, porque el pedido ni
 * siquiera llegó a Supabase y tiene sentido reintentar.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setNetworkError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/restablecer-contrasena`,
    });

    setSubmitting(false);

    if (error && isNetworkError(error)) {
      setNetworkError(mapAuthError(error));
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <Card>
        <CardHeader className="items-center space-y-3 text-center">
          <MailCheck className="size-10 text-primary" aria-hidden="true" />
          <CardTitle className="text-2xl">Revisá tu correo</CardTitle>
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
        <CardTitle className="text-2xl">¿Te olvidaste la contraseña?</CardTitle>
        <CardDescription>Poné tu email y te mandamos un link para elegir una nueva.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <OfflineBanner />
          <FormError message={networkError} />
          <EmailField value={email} onChange={setEmail} disabled={submitting} />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Spinner /> Enviando…
              </>
            ) : (
              'Mandar link'
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
