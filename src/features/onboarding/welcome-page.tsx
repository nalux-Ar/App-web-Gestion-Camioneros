import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
import { supabase } from '@/lib/supabase';
import { useMember } from '@/features/member/use-member';
import { FormError } from '@/features/auth/components/form-error';
import { isNetworkError, NETWORK_ERROR_MESSAGE } from '@/features/auth/auth-errors';

const MAX_NOMBRE_LENGTH = 200;

/**
 * `create_transportista` (SECURITY DEFINER) crea el tenant + el miembro
 * admin en una sola transacción. Códigos de error esperados (ver
 * CONTEXT.md): `23505` = ya tiene transportista (no es un error real acá,
 * solo entramos), `22023` = nombre vacío o demasiado largo, `28000` = sin
 * sesión (no debería pasar detrás de <RequireAuth>, pero por las dudas).
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const { refetch } = useMember();

  const [nombre, setNombre] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = nombre.trim();
  const isValid = trimmed.length >= 1 && trimmed.length <= MAX_NOMBRE_LENGTH;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    if (!isValid) {
      setError('Poné un nombre (hasta 200 caracteres).');
      return;
    }

    setSubmitting(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('create_transportista', { p_nombre: trimmed });

    if (!rpcError || rpcError.code === '23505') {
      await refetch();
      navigate('/', { replace: true });
      return;
    }

    setSubmitting(false);

    if (rpcError.code === '28000') {
      navigate('/ingresar', { replace: true });
      return;
    }

    if (rpcError.code === '22023') {
      setError('Poné un nombre entre 1 y 200 caracteres.');
      return;
    }

    setError(isNetworkError(rpcError) ? NETWORK_ERROR_MESSAGE : 'No pudimos crear tu cuenta. Probá de nuevo.');
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="text-2xl">¡Bienvenido a Elan!</CardTitle>
        <CardDescription>
          ¿Cómo se llama tu empresa o vos? Por ejemplo "Juan Pérez" o "Transportes Pérez SRL".
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <OfflineBanner />
          <FormError message={error} />
          <div className="space-y-1.5">
            <Label htmlFor="nombre-transportista">Nombre</Label>
            <Input
              id="nombre-transportista"
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              maxLength={MAX_NOMBRE_LENGTH}
              disabled={submitting}
              autoComplete="organization"
              required
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" size="lg" className="w-full" disabled={submitting || trimmed.length === 0}>
            {submitting ? (
              <>
                <Spinner /> Creando…
              </>
            ) : (
              'Empezar'
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
