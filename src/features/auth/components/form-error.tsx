import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';

/** Banner de error de formulario. `Alert` ya tiene `role="alert"`
 *  (equivalente a aria-live="assertive"): no hace falta agregarlo acá. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
