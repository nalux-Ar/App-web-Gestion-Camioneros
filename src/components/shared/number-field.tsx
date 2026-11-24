import { useState, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { FieldShell } from '@/components/shared/field-shell';
import {
  LITROS_HINT,
  mensajeSoloNumeros,
  textoSeLee,
  validateOptionalNumber,
  validateRequiredNumber,
  type NumberKind,
} from '@/lib/numbers';
import { cn } from '@/lib/utils';

/**
 * Tope de caracteres que acepta el campo. Cubre el formato válido más largo con separadores de miles:
 * monto "9.999.999.999,99" (16), litros "999.999,999" (11), km "99.999.999,9" (12), con margen para ceros
 * a la izquierda. Se corta DESPUÉS de sacar el «$» y los espacios (no con el atributo `maxLength`, que corta
 * antes: al pegar "$ 12.500,00" se perdería parte del número en silencio). Es lo único que se sigue cortando
 * sin aviso: los dígitos de más.
 */
const MAX_NUMBER_INPUT_LENGTH = 20;

/**
 * Lo que se tolera en lo escrito o pegado y se quita: espacios (también el que no corta línea, U+00A0, que arma `formatMoney`),
 * el «$» y las marcas invisibles que a veces trae un texto copiado de WhatsApp o de una web pegadas al número (ancho cero
 * U+200B, marcas de dirección U+200E/U+200F y U+202A–U+202E, unión de palabras U+2060 y aislantes U+2066–U+2069). Sin esto un
 * monto que se ve perfecto se rechazaría con «solo números».
 */
const ADORNO = /[\s$\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069]/g;
/** Cualquier cosa que, ya sin adorno, no sea un dígito latino, una coma o un punto. */
const NO_ES_NUMERO = /[^0-9.,]/;

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
 * raro). El texto se guarda tal cual; se interpreta con `validateRequiredNumber` /
 * `validateOptionalNumber` (src/lib/numbers.ts), que aceptan coma y punto.
 *
 * Lo que se escribe o se pega se acepta solo si son dígitos, comas y puntos. Se toleran el «$» y los espacios
 * (también el espacio sin corte), que se quitan: «$ 1.500,50» o «$ 12.500» copiados llegan al formulario como
 * «1.500,50» y «12.500». Todo lo demás (letras, «%», «-», «−», dígitos no latinos, cualquier otro símbolo) se
 * RECHAZA entero, sin descartar nada en silencio: el campo queda con el texto que tenía, el formulario no recibe
 * ese cambio (`onChange` no se llama) y se avisa «solo números» (`mensajeSoloNumeros`) en el lugar del error, con
 * prioridad sobre cualquier otro, hasta el próximo cambio válido o hasta salir del campo. Así «IVA 21% $ 1500»
 * no puede quedar como «211500». Un "-" nunca se puede escribir.
 * Al enviar el formulario, leer el valor con `validateRequiredNumber` /
 * `validateOptionalNumber` y pasar el mensaje a `error`.
 *
 * En dinero y kilómetros el punto con 3 dígitos es de miles ("12.500" = 12500) y debajo del campo
 * se muestra cómo se leyó lo escrito («Se lee: $ 12.500», `textoSeLee`), para que quien tipea vea
 * el número que se va a guardar antes de tocar Guardar.
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
  // Se rechazó lo último que se escribió o se pegó porque no era un número. Es un aviso del campo (no del formulario).
  const [rechazado, setRechazado] = useState(false);

  function handleChange(texto: string) {
    const sinAdorno = texto.replace(ADORNO, '');
    if (NO_ES_NUMERO.test(sinAdorno)) {
      // Se rechaza el cambio completo: no se llama a `onChange`, así que el valor (y lo que se ve) no se mueve.
      setRechazado(true);
      return;
    }
    setRechazado(false);
    onChange(sinAdorno.slice(0, MAX_NUMBER_INPUT_LENGTH));
  }

  // Se valida en el render (no en un efecto): primero al salir del campo y
  // después en vivo, para que el mensaje desaparezca apenas se corrige.
  let ownError: string | null = null;
  if (touched && kind) {
    const result = optional
      ? validateOptionalNumber(value, kind, { allowZero })
      : validateRequiredNumber(value, kind, { allowZero });
    if (!result.ok) ownError = result.message;
  }
  // El aviso de rechazo gana sobre todo: se ve aunque el formulario tenga un error de «Guardar» sin cambiar.
  const shownError = rechazado ? mensajeSoloNumeros(kind) : (error ?? ownError);
  // En litros el punto se lee como decimal pero en es-AR suena a "miles":
  // la ayuda por defecto evita cargas 1000 veces menores.
  const shownHint = hint ?? (kind === 'litros' ? LITROS_HINT : undefined);
  // «Se lee: $ 12.500» / «Se lee: 452.310 km»: solo en dinero y km, solo si lo escrito se lee bien (si no, manda el
  // error) y desde la primera tecla: es la confirmación de lo que se entendió, no una validación que espera al blur.
  // Sale de la misma lectura y la misma conversión que el guardado (`textoSeLee`), así que es lo que se va a guardar.
  const lectura = kind ? textoSeLee(value, kind, { allowZero }) : null;

  return (
    <FieldShell id={id} label={label} optional={optional} hint={shownHint} lectura={lectura} error={shownError}>
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
            onChange={(event) => handleChange(event.target.value)}
            onBlur={() => {
              setRechazado(false);
              setTouched(true);
              onBlur?.();
            }}
            className={cn(unit && 'pr-14')}
          />
          {unit ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-base text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </div>
      )}
    </FieldShell>
  );
}
