import { Check } from 'lucide-react';

import { formatDateWithYear } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { cn } from '@/lib/utils';
import { nombreParaMostrar, type Categoria } from './categorias';
import type { GastoDeFila } from './gastos-api';
import { NOMBRE_GENERICO_DE_GASTO } from './sumar-gastos-textos';

/**
 * Las filas de gastos de las pantallas que juntan varios para sumarlos a un viaje («Sumar gastos que ya cargué») o, más adelante,
 * para sacarlos de él («Quitar»): una lista de casillas (`GastosParaElegir`) y, aparte, una lista de lo que NO se puede elegir y
 * por qué (`GastosQueNoSeEligen`). Las dos muestran lo mismo de cada gasto: la categoría, la fecha, la descripción si tiene y el monto.
 * No saben nada de sumar ni de quitar: reciben qué está marcado y avisan qué casilla se tocó.
 *
 * Fechas SIEMPRE con `formatDateWithYear`: la base acepta fechas raras (`infinity`, años de cinco cifras) y esa función las
 * devuelve tal cual en vez de romper el dibujo de toda la lista. Con año porque los gastos sin viaje pueden ser de cualquier
 * fecha (no hay ventana de días).
 *
 * Tamaños: cada fila mide 64 px o más (el piso táctil del proyecto es 48) y TODA la fila es la zona que se toca. Textos de 16 px.
 * Sin scroll horizontal a 360 px: el texto largo (una descripción sin espacios) se corta donde haga falta.
 */

interface DatosDelGastoProps {
  gasto: GastoDeFila;
  categoria: Categoria | undefined;
}

/** Lo que se ve de un gasto: a la izquierda categoría, fecha y descripción; a la derecha el monto. */
function DatosDelGasto({ gasto, categoria }: DatosDelGastoProps) {
  return (
    <>
      <span className="min-w-0 flex-1 break-words">
        <span className="block font-medium">{categoria ? nombreParaMostrar(categoria) : NOMBRE_GENERICO_DE_GASTO}</span>
        <span className="block text-base text-muted-foreground">{formatDateWithYear(gasto.fecha)}</span>
        {/* Sin `block` a propósito: `line-clamp-2` ya es un bloque (`display: -webkit-box`) y un `display` de Tailwind lo pisaría. */}
        {gasto.descripcion ? (
          <span className="line-clamp-2 text-base text-muted-foreground [overflow-wrap:anywhere]">{gasto.descripcion}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-right text-base font-semibold tabular-nums">{formatNumber(gasto.monto, { decimales: 2 })}</span>
    </>
  );
}

interface GastosParaElegirProps {
  gastos: readonly GastoDeFila[];
  categoriasPorId: ReadonlyMap<string, Categoria>;
  /** Los ids marcados (ya recortados a esta lista). */
  marcados: ReadonlySet<string>;
  /** Se tocó la casilla de este gasto. */
  onAlternar: (gastoId: string) => void;
  /** Sin poder tocar ninguna casilla (mientras se envía). */
  deshabilitado?: boolean;
  /** El nombre del grupo de casillas, para el lector de pantalla («Gastos sin viaje»). */
  etiqueta: string;
}

/**
 * Los gastos con una casilla cada uno. Es un grupo (`fieldset` con su `legend`, que solo ve el lector de pantalla: el título que
 * se ve lo pone la pantalla) de casillas NATIVAS dentro de un `label` que cubre toda la fila: teclado, lector de pantalla y
 * toque funcionan sin ARIA a mano. La casilla de verdad no se ve (`sr-only`); lo que se ve es la fila con su recuadro, y marcar
 * se distingue por el borde grueso, el fondo, el TILDE y no solo por el color. Ninguno viene marcado de antes: lo decide
 * quien usa el componente.
 */
export function GastosParaElegir({ gastos, categoriasPorId, marcados, onAlternar, deshabilitado = false, etiqueta }: GastosParaElegirProps) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{etiqueta}</legend>
      <ul className="space-y-2">
        {gastos.map((gasto) => {
          const marcado = marcados.has(gasto.id);
          return (
            <li key={gasto.id}>
              <label className="relative block min-w-0">
                <input
                  type="checkbox"
                  checked={marcado}
                  disabled={deshabilitado}
                  onChange={() => onAlternar(gasto.id)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border-2 px-4 py-3 transition-colors',
                    marcado ? 'border-primary bg-primary/10' : 'border-border bg-card',
                    'hover:bg-accent',
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                    'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border-2',
                      marcado ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                    )}
                  >
                    {marcado ? <Check className="size-5" /> : null}
                  </span>
                  <DatosDelGasto gasto={gasto} categoria={categoriasPorId.get(gasto.categoria_id)} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

interface GastosQueNoSeEligenProps {
  gastos: readonly GastoDeFila[];
  categoriasPorId: ReadonlyMap<string, Categoria>;
  /** Por qué no se puede elegir este gasto (ya en español). */
  motivoDe: (gasto: GastoDeFila) => string;
}

/** Los gastos que NO se pueden elegir: sin casilla y con el motivo debajo, en el mismo formato de fila. */
export function GastosQueNoSeEligen({ gastos, categoriasPorId, motivoDe }: GastosQueNoSeEligenProps) {
  return (
    <ul className="space-y-2">
      {gastos.map((gasto) => (
        <li key={gasto.id} className="min-h-16 rounded-lg border-2 border-border bg-card px-4 py-3">
          <div className="flex items-start gap-3">
            <DatosDelGasto gasto={gasto} categoria={categoriasPorId.get(gasto.categoria_id)} />
          </div>
          <p className="mt-1 text-base text-muted-foreground [overflow-wrap:anywhere]">{motivoDe(gasto)}</p>
        </li>
      ))}
    </ul>
  );
}
