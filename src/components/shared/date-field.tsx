import { useState, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { FieldShell } from '@/components/shared/field-shell';
import { validateOptionalDate, validateRequiredDate } from '@/lib/dates';

interface DateFieldProps {
  label: string;
  /** 'YYYY-MM-DD' (lo que entiende `<input type="date">` y la columna `date`), o '' si está vacío. */
  value: string;
  onChange: (value: string) => void;
  /** Límites 'YYYY-MM-DD' inclusive. P.ej. `max={todayLocal()}` para gastos (no hay gastos futuros). */
  min?: string;
  max?: string;
  optional?: boolean;
  hint?: ReactNode;
  /** Error de afuera (p.ej. al enviar el formulario). Gana sobre el de este campo. */
  error?: string | null;
  id?: string;
  name?: string;
  disabled?: boolean;
  onBlur?: () => void;
}

/**
 * `<input type="date">` NATIVO: en el celular abre el selector de fechas del
 * sistema. El valor va y viene como 'YYYY-MM-DD', sin zonas horarias.
 *
 * Valida por su cuenta, como `NumberField` (al salir del campo y después en
 * vivo): fecha vacía, inexistente (año de 5 o 6 dígitos tipeado en
 * escritorio, 30 de febrero) y fuera de `min`/`max`. Hace falta porque los
 * formularios van con `noValidate` y entonces `min`/`max` del input no se
 * aplican. Al enviar, releer el valor con `validateRequiredDate` /
 * `validateOptionalDate` (src/lib/dates.ts) y pasar el mensaje a `error`.
 *
 * Valor por defecto: al crear un registro inicializar el estado con HOY en
 * hora local, nunca con `toISOString()` (de noche en Argentina da mañana):
 *
 *   const [fecha, setFecha] = useState(todayLocal);   // de '@/lib/dates'
 *
 * Al editar, inicializar con la `fecha` del registro.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  optional = false,
  hint,
  error,
  id,
  name,
  disabled,
  onBlur,
}: DateFieldProps) {
  const [touched, setTouched] = useState(false);

  // Se valida en el render (no en un efecto): primero al salir del campo y
  // después en vivo, para que el mensaje desaparezca apenas se corrige.
  let ownError: string | null = null;
  if (touched) {
    const result = optional ? validateOptionalDate(value, { min, max }) : validateRequiredDate(value, { min, max });
    if (!result.ok) ownError = result.message;
  }

  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error ?? ownError}>
      {(control) => (
        <Input
          {...control}
          name={name}
          type="date"
          min={min}
          max={max}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            setTouched(true);
            onBlur?.();
          }}
          className="block min-w-0"
        />
      )}
    </FieldShell>
  );
}
