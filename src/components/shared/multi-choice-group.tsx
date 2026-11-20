import type { ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ChoiceOption } from './choice-group';

export interface MultiChoiceOption extends ChoiceOption {
  /** Esta opción no se puede tocar (por ejemplo, ya no está disponible). */
  disabled?: boolean;
}

interface MultiChoiceGroupProps {
  /** Prefijo de los ids del grupo. Las opciones quedan `${id}-0`, `${id}-1`…: sirve para llevar el foco a la primera. */
  id: string;
  legend: string;
  /** Los valores marcados, sin repetir. Ninguno viene marcado de antes: lo decide quien usa el componente. */
  value: readonly string[];
  /** Se tocó una opción: avisa cuál y si quedó marcada. Quien usa el componente decide qué pasa con la lista. */
  onToggle: (value: string, checked: boolean) => void;
  options: ReadonlyArray<MultiChoiceOption>;
  columns?: 1 | 2 | 3;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Todo el grupo sin poder tocarse (por ejemplo, mientras se guarda). */
  disabled?: boolean;
  /**
   * Cuántas se pueden marcar como máximo. Al llegar, las que NO están marcadas se apagan (las marcadas siguen activas, para poder
   * desmarcarlas) y se muestra `maxMessage` en una región `role="status"`. Sin esto no hay tope.
   */
  max?: number;
  /** Lo que se dice al llegar al tope (ya en español). Sin texto no se muestra aviso, pero las opciones se apagan igual. */
  maxMessage?: string;
}

const COLUMNS_CLASS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' } as const;

/**
 * Marcar UNA O MÁS opciones tocando botones grandes (≥ 56 px, el mismo aspecto que `ChoiceGroup`), sin abrir listas.
 *
 * Son `<input type="checkbox">` NATIVOS dentro de un `<fieldset>` con su `<legend>`: teclado (Tab y barra espaciadora), lectores de
 * pantalla ("casilla, marcada") y formulario funcionan sin ARIA a mano. La opción marcada se distingue por el borde grueso, el
 * fondo, el TILDE dentro de su recuadro y la negrita (no solo por el color). El error lleva ícono + texto y vive en una región
 * `aria-live` siempre presente, como `ChoiceGroup`. El foco visible es un anillo alrededor del botón.
 */
export function MultiChoiceGroup({
  id,
  legend,
  value,
  onToggle,
  options,
  columns = 2,
  optional = false,
  hint,
  error,
  disabled = false,
  max,
  maxMessage,
}: MultiChoiceGroupProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const maxId = `${id}-max`;
  const marcados = new Set(value);
  const enElTope = max !== undefined && marcados.size >= max;
  const describedBy = [hint ? hintId : null, enElTope && maxMessage ? maxId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <fieldset disabled={disabled} aria-describedby={describedBy || undefined} className="min-w-0 space-y-1.5">
      <legend className="mb-1.5 p-0 text-base font-medium leading-none">
        {legend}
        {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
      </legend>

      <div className={cn('grid gap-2', COLUMNS_CLASS[columns])}>
        {options.map((option, index) => {
          const marcada = marcados.has(option.value);
          return (
            <label key={option.value} className="relative block min-w-0">
              <input
                id={`${id}-${index}`}
                type="checkbox"
                value={option.value}
                checked={marcada}
                disabled={option.disabled || (enElTope && !marcada)}
                onChange={(event) => onToggle(option.value, event.target.checked)}
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
                  error && 'border-destructive',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md border-2',
                    marcada ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                  )}
                >
                  {marcada ? <Check className="size-4" /> : null}
                </span>
                <span className="min-w-0 break-words">{option.label}</span>
              </span>
            </label>
          );
        })}
      </div>

      {hint ? (
        <p id={hintId} className="text-base text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {/* Siempre en el DOM: un lector de pantalla anuncia el texto cuando aparece. */}
      <p id={maxId} role="status" className={enElTope && maxMessage ? 'text-base text-muted-foreground' : 'sr-only'}>
        {enElTope && maxMessage ? maxMessage : ''}
      </p>

      <div id={errorId} aria-live="polite">
        {error ? (
          <p className="flex items-start gap-1.5 text-base text-destructive-text">
            <AlertCircle className="mt-1 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
