import type { ReactNode } from 'react';

import { FieldShell } from '@/components/shared/field-shell';
import { cn } from '@/lib/utils';

interface TextareaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  rows?: number;
  placeholder?: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  id?: string;
  name?: string;
  disabled?: boolean;
}

/**
 * Texto de varias líneas con el estilo de los inputs (fuente ≥ 16 px: lo
 * garantiza `index.css`, así iOS no hace zoom al enfocar). Sin `maxLength`
 * a propósito: cortar en silencio lo que se pega es peor que avisar; el
 * límite lo valida el formulario con un mensaje (y, si hace falta, un
 * contador en `hint`).
 */
export function TextareaField({
  label,
  value,
  onChange,
  onBlur,
  rows = 3,
  placeholder,
  optional = false,
  hint,
  error,
  id,
  name,
  disabled,
}: TextareaFieldProps) {
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      {(control) => (
        <textarea
          {...control}
          name={name}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={cn(
            'flex min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      )}
    </FieldShell>
  );
}
