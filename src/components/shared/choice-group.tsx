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
  /**
   * Con `columns={2}`: los botones quedan en 2×2 mientras entren dos columnas de al menos 9,75 rem, y si no entran pasan a UNA
   * columna a ancho completo (mismo estilo y mismo alto mínimo). Reacciona al ANCHO de la pantalla y también al TAMAÑO DE LETRA
   * del teléfono: `rem` crece con la letra, así que con letra grande se apila aunque la pantalla sea ancha (un corte fijo en px
   * no lo vería). Sirve para rótulos largos («Transferencia»), que si no, se cortarían a mitad de palabra. Desde 480 px de ancho
   * se fuerzan 2 columnas (para que `auto-fit` nunca arme 3 + 1 en pantallas anchas). Con `columns` 1 o 3 no cambia nada (1 ya es
   * una columna; 3 es para rótulos cortos). Por defecto false: el resto de los grupos queda con su cuadrícula de siempre.
   */
  apilarEnAngosto?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
}

const COLUMNS_CLASS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' } as const;
/**
 * 2×2 mientras entren 2 columnas de ≥ 9,75 rem (= lo que necesita «Transferencia» + ~4 px de margen: palabra 95,7 px + borde 4 +
 * padding 24 + tilde y espacio 28); si no entran (pantalla angosta O letra grande, porque `rem` crece con la letra) queda UNA
 * columna. Desde 480 px se fuerzan 2 columnas. Sin espacios dentro de los corchetes y el literal entero, para que Tailwind genere la clase.
 */
const COLUMNS_2_APILABLE_CLASS = 'grid-cols-[repeat(auto-fit,minmax(9.75rem,1fr))] min-[480px]:grid-cols-2';

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
  apilarEnAngosto = false,
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
      <legend className="mb-1.5 p-0 text-base font-medium leading-none">
        {legend}
        {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
      </legend>

      <div className={cn('grid gap-2', apilarEnAngosto && columns === 2 ? COLUMNS_2_APILABLE_CLASS : COLUMNS_CLASS[columns])}>
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
        <p id={hintId} className="text-base text-muted-foreground">
          {hint}
        </p>
      ) : null}

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
