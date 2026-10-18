import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { currentMonth, MIN_YEAR } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { filtroEnVista, resumenFiltroToSearch, VISTAS_RESUMEN, type ResumenFiltro } from './resumen-filtros';
import { ANIO_ANTERIOR, ANIO_SIGUIENTE, ETIQUETA_SELECTOR_ANIO, ETIQUETA_VISTAS, ETIQUETAS_VISTA } from './resumen-pantalla-textos';

/**
 * Las dos vistas del Resumen ("Mes" y "Año"), igual que las pestañas de Viajes: la URL es la fuente de verdad, son
 * ENLACES (no pestañas ARIA, que prometen un manejo de flechas que acá no existe), con `aria-current="page"` en la activa
 * dentro de un `nav` con nombre. Cambiar de vista conserva el período (`filtroEnVista`: de un mes al año de ese mes; de un
 * año al mes actual si es el año en curso, o a diciembre si es uno pasado) y usa `replace`, como los selectores de período:
 * "atrás" sale de la pantalla en vez de rebotar entre vistas. Lo que es el valor por defecto no se escribe en la URL.
 *
 * Alto táctil de 48 px. La activa no depende del color: borde grueso, fondo y negrita. Solo tokens del tema.
 */
export function SelectorDeVista({ filtro }: { filtro: ResumenFiltro }) {
  return (
    <nav aria-label={ETIQUETA_VISTAS} className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card p-1">
      {VISTAS_RESUMEN.map((vista) => {
        const activa = filtro.vista === vista;
        return (
          <Link
            key={vista}
            to={{ pathname: '/resumen', search: resumenFiltroToSearch(filtroEnVista(filtro, vista)) }}
            replace
            aria-current={activa ? 'page' : undefined}
            className={cn(
              'flex min-h-12 items-center justify-center rounded-md border-2 px-3 py-2 text-center text-base leading-tight transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              activa
                ? 'border-primary bg-primary/10 font-semibold text-foreground'
                : 'border-transparent font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {ETIQUETAS_VISTA[vista]}
          </Link>
        );
      })}
    </nav>
  );
}

interface SelectorDeAnioProps {
  value: number;
  onChange: (anio: number) => void;
}

/**
 * ‹ 2026 › con el mismo aspecto que `MonthPicker` (botones de 48 px para el pulgar). No va antes de 2000 (`MIN_YEAR`, el
 * mismo piso que las fechas de los registros) ni al futuro (no hay registros). El año se anuncia al cambiar (`aria-live`).
 */
export function SelectorDeAnio({ value, onChange }: SelectorDeAnioProps) {
  const puedeAnterior = value > MIN_YEAR;
  const puedeSiguiente = value < currentMonth().year;

  return (
    <div role="group" aria-label={ETIQUETA_SELECTOR_ANIO} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-1">
      <Button type="button" variant="ghost" size="icon" aria-label={ANIO_ANTERIOR} onClick={() => onChange(value - 1)} disabled={!puedeAnterior} className="[&_svg]:size-6">
        <ChevronLeft aria-hidden="true" />
      </Button>

      <p aria-live="polite" className="min-w-0 flex-1 truncate text-center text-base font-semibold tabular-nums">
        {value}
      </p>

      <Button type="button" variant="ghost" size="icon" aria-label={ANIO_SIGUIENTE} onClick={() => onChange(value + 1)} disabled={!puedeSiguiente} className="[&_svg]:size-6">
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
