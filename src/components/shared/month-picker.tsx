import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  addMonths,
  compareMonths,
  currentMonth,
  formatMonthLabel,
  monthRange,
  type MonthRange,
  type YearMonth,
} from '@/lib/dates';
import { cn } from '@/lib/utils';

interface MonthPickerProps {
  /** Mes mostrado (el estado vive en la pantalla; arrancar con `currentMonth()`). */
  value: YearMonth;
  /** Devuelve el mes nuevo y su rango listo para filtrar: `.gte('fecha', desde).lt('fecha', hasta)`. */
  onChange: (month: YearMonth, range: MonthRange) => void;
  /** Permite ir a meses futuros. Por defecto no: ver nota abajo. */
  allowFuture?: boolean;
  className?: string;
}

/**
 * ‹ septiembre 2026 ›  con botones de 48 px, pensado para un pulgar.
 *
 * "Siguiente" se deshabilita en el mes actual (`allowFuture` lo habilita).
 * Criterio: en Gastos el futuro siempre está vacío (no se gasta por
 * adelantado), así que navegar ahí solo mostraría pantallas vacías y haría
 * creer que se perdió algo. En Viajes puede tener sentido ver viajes
 * programados: pasar `allowFuture`. Si una pantalla deja cargar registros con
 * fecha futura, tiene que permitirlo también acá, o esos registros quedan
 * fuera de alcance (en Gastos: `max={todayLocal()}` en el `DateField`).
 *
 * El mes se anuncia a lectores de pantalla al cambiar (`aria-live`).
 */
export function MonthPicker({ value, onChange, allowFuture = false, className }: MonthPickerProps) {
  const canGoNext = allowFuture || compareMonths(value, currentMonth()) < 0;

  function go(delta: number) {
    const next = addMonths(value, delta);
    onChange(next, monthRange(next.year, next.month));
  }

  return (
    <div
      role="group"
      aria-label="Mes"
      className={cn('flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-1', className)}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Mes anterior"
        onClick={() => go(-1)}
        className="[&_svg]:size-6"
      >
        <ChevronLeft aria-hidden="true" />
      </Button>

      <p aria-live="polite" className="min-w-0 flex-1 truncate text-center text-base font-semibold capitalize">
        {formatMonthLabel(value)}
      </p>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Mes siguiente"
        onClick={() => go(1)}
        disabled={!canGoNext}
        className="[&_svg]:size-6"
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
