import { useId, type ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ChoiceOption {
  value: string;
  label: string;
}

interface ChoiceGroupProps {
  /** Prefijo de los ids del grupo. Las opciones quedan `${id}-0`, `${id}-1`…: sirve para llevar el foco a la primera. */
  id: string;
  legend: string;
  /** Valor elegido ('' si todavía no eligió, o si '' es una opción más, p.ej. "Sin indicar"). */
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<ChoiceOption>;
  columns?: 1 | 2 | 3;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
}

const COLUMNS_CLASS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' } as const;

/**
 * Elegir UNA opción tocando botones grandes (≥ 56 px), sin abrir listas: en el
 * celular, con una mano, es lo más rápido para pocas opciones (categorías,
 * Sí / No / Sin indicar).
 *
 * Son `<input type="radio">` NATIVOS dentro de un `<fieldset>`: teclado
 * (flechas, Tab al grupo), lectores de pantalla ("opción 2 de 4") y formulario
 * funcionan sin ARIA a mano. La opción elegida se distingue por borde grueso,
 * fondo, TILDE y negrita (no solo por color). El error lleva ícono + texto y
 * vive en una región `aria-live` siempre presente, como `FieldShell`.
 */
export function ChoiceGroup({
  id,
  legend,
  value,
  onChange,
  options,
  columns = 2,
  optional = false,
  hint,
  error,
  disabled = false,
}: ChoiceGroupProps) {
  const name = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <fieldset disabled={disabled} aria-describedby={describedBy || undefined} className="min-w-0 space-y-1.5">
      <legend className="mb-1.5 p-0 text-sm font-medium leading-none">
        {legend}
        {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
      </legend>

      <div className={cn('grid gap-2', COLUMNS_CLASS[columns])}>
        {options.map((option, index) => (
          <label key={option.value} className="relative block min-w-0">
            <input
              id={`${id}-${index}`}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              required={!optional}
              aria-invalid={error ? true : undefined}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-input px-3 py-2 text-center text-base font-medium leading-tight transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                'peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:font-semibold',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                '[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100',
                error && 'border-destructive',
              )}
            >
              <Check className="size-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{option.label}</span>
            </span>
          </label>
        ))}
      </div>

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
    </fieldset>
  );
}
