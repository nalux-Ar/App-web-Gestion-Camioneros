import { useState, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { FieldShell } from '@/components/shared/field-shell';
import { LITROS_HINT, validateOptionalNumber, validateRequiredNumber, type NumberKind } from '@/lib/numbers';
import { cn } from '@/lib/utils';

/**
 * Tope de caracteres que acepta el campo. Cubre el formato válido más largo con separadores de miles:
 * monto "9.999.999.999,99" (16), litros "999.999,999" (11), km "99.999.999,9" (12), con margen para ceros
 * a la izquierda. Se corta DESPUÉS de descartar lo que no es número (no con el atributo `maxLength`,
 * que corta antes: al pegar "Total: $ 12.500,00" se perdería parte del número en silencio).
 */
const MAX_NUMBER_INPUT_LENGTH = 20;

interface NumberFieldProps {
  label: string;
  /** El texto tal cual lo tipeó el usuario ("1.234,5"). El estado vive en el formulario. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Tipo de columna: si se indica, el campo valida al salir (y después en vivo) con sus límites. */
  kind?: NumberKind;
  /** Con `kind`: acepta 0 (ingreso, km). Por defecto exige mayor que 0 (monto, litros, precio). */
  allowZero?: boolean;
  optional?: boolean;
  /** Unidad o sufijo visible dentro del campo: "L", "km". */
  unit?: string;
  /** Ayuda bajo el campo. Con `kind="litros"`, si no se pasa, se muestra una sobre la coma y los miles. */
  hint?: ReactNode;
  /** Error de afuera (p.ej. al enviar el formulario). Gana sobre el de este campo. */
  error?: string | null;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Campo numérico para el celular: `type="text"` + `inputMode="decimal"` (un
 * `type="number"` no deja escribir coma en muchos teclados y redondea
 * raro). El texto se guarda tal cual; se interpreta con `parseDecimal`
 * (src/lib/numbers.ts), que acepta coma y punto.
 *
 * Mientras se escribe se descarta todo lo que no sea dígito, coma o punto
 * (también sirve al pegar "$ 1.500,50"); un "-" nunca se puede escribir.
 * Al enviar el formulario, leer el valor con `validateRequiredNumber` /
 * `validateOptionalNumber` y pasar el mensaje a `error`.
 */
export function NumberField({
  label,
  value,
  onChange,
  onBlur,
  kind,
  allowZero,
  optional = false,
  unit,
  hint,
  error,
  id,
  name,
  placeholder,
  disabled,
}: NumberFieldProps) {
  const [touched, setTouched] = useState(false);

  // Se valida en el render (no en un efecto): primero al salir del campo y
  // después en vivo, para que el mensaje desaparezca apenas se corrige.
  let ownError: string | null = null;
  if (touched && kind) {
    const result = optional
      ? validateOptionalNumber(value, kind, { allowZero })
      : validateRequiredNumber(value, kind, { allowZero });
    if (!result.ok) ownError = result.message;
  }
  const shownError = error ?? ownError;
  // En litros el punto se lee como decimal pero en es-AR suena a "miles":
  // la ayuda por defecto evita cargas 1000 veces menores.
  const shownHint = hint ?? (kind === 'litros' ? LITROS_HINT : undefined);

  return (
    <FieldShell id={id} label={label} optional={optional} hint={shownHint} error={shownError}>
      {(control) => (
        <div className="relative">
          <Input
            {...control}
            name={name}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            placeholder={placeholder}
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, '').slice(0, MAX_NUMBER_INPUT_LENGTH))}
            onBlur={() => {
              setTouched(true);
              onBlur?.();
            }}
            className={cn(unit && 'pr-14')}
          />
          {unit ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </div>
      )}
    </FieldShell>
  );
}
