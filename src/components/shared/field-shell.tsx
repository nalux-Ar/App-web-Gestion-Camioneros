import { useId, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

import { Label } from '@/components/ui/label';

/** Atributos que el control (input/select) tiene que recibir para quedar
 *  enlazado con su etiqueta, su ayuda y su error. */
export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

interface FieldShellProps {
  id?: string;
  label: string;
  /** Se marca "(opcional)" en la etiqueta. Es más claro en el celular que un asterisco. */
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** El control, recibiendo los atributos de accesibilidad ya armados. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Estructura común de los campos de formulario: etiqueta, control, ayuda y
 * error. Los campos de `components/shared` (NumberField, SelectField,
 * DateField) la comparten para que se vean y se anuncien igual.
 *
 *  - El error lleva ícono + texto (nunca solo color) y vive en una región
 *    `aria-live` que está siempre en el DOM: los lectores de pantalla anuncian
 *    el texto cuando aparece.
 *  - `aria-describedby` apunta a la ayuda y, solo si hay, al error.
 *  - Los formularios van con `noValidate`: la validación es nuestra, en
 *    español, y no los globos del navegador. Por eso se usa `aria-required`
 *    y no el atributo `required`.
 */
export function FieldShell({ id, label, optional = false, hint, error, children }: FieldShellProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1.5">
      <Label htmlFor={controlId}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
      </Label>

      {children({
        id: controlId,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-required': optional ? undefined : true,
      })}

      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}

      <div id={errorId} aria-live="polite">
        {error ? (
          <p className="flex items-start gap-1.5 text-sm text-destructive-text">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
