import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { FieldShell } from '@/components/shared/field-shell';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectFieldProps {
  label: string;
  /** Valor elegido, o '' si todavía no eligió nada. */
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<SelectOption>;
  /** Texto de la opción vacía ("Elige una categoría"). En un campo obligatorio no se puede volver a elegir. */
  placeholder?: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  id?: string;
  name?: string;
  disabled?: boolean;
  onBlur?: () => void;
}

/**
 * `<select>` NATIVO con el estilo de los inputs. En el celular el selector
 * del sistema (rueda de iOS, lista de Android) es mucho más cómodo y
 * accesible que un popover hecho a mano, y en PC funciona con teclado sin
 * trabajo extra. Altura 48 px, fuente ≥ 16 px (evita el zoom de iOS).
 */
export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  optional = false,
  hint,
  error,
  id,
  name,
  disabled,
  onBlur,
}: SelectFieldProps) {
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      {(control) => (
        <div className="relative">
          <select
            {...control}
            name={name}
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            className={cn(
              'h-12 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-11 text-base text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
              value === '' && placeholder && 'text-muted-foreground',
            )}
          >
            {placeholder !== undefined ? (
              <option value="" disabled={!optional}>
                {placeholder}
              </option>
            ) : null}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled} className="text-foreground">
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      )}
    </FieldShell>
  );
}
