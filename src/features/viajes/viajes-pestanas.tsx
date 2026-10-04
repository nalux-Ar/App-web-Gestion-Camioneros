import { Link } from 'react-router';

import { cn } from '@/lib/utils';
import { filtroToSearch, type ViajesFiltro, type VistaViajes } from './viajes-filters';

const PESTANAS: ReadonlyArray<{ vista: VistaViajes; label: string }> = [
  { vista: 'viajes', label: 'Viajes' },
  { vista: 'devoluciones', label: 'Devoluciones' },
];

/**
 * Las dos vistas de `/viajes` ("Viajes" y "Devoluciones") con forma de control segmentado. La URL es la fuente de
 * verdad (`?vista=devoluciones&mes=2026-09`): son ENLACES, no pestañas ARIA (`role="tab"`, que prometen un manejo de
 * teclado de flechas que acá no existe), con `aria-current="page"` en la activa dentro de un `nav` con nombre.
 *
 * Cambiar de pestaña conserva el mes y usa `replace`, como el selector de mes: no apila historial, así "atrás" sale de la
 * pantalla en vez de rebotar entre pestañas. El enlace se arma con `filtroToSearch`, así lo que es el valor por defecto
 * (la pestaña Viajes, el mes actual) no se escribe.
 *
 * Alto táctil de 48 px y dos columnas de ancho completo. La pestaña activa no depende del color: borde grueso, fondo y
 * negrita (el mismo lenguaje que las opciones de `ChoiceGroup`). Solo tokens del tema.
 */
export function ViajesPestanas({ filtro }: { filtro: ViajesFiltro }) {
  return (
    <nav aria-label="Viajes y devoluciones" className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card p-1">
      {PESTANAS.map(({ vista, label }) => {
        const activa = filtro.vista === vista;
        return (
          <Link
            key={vista}
            to={{ pathname: '/viajes', search: filtroToSearch({ ...filtro, vista }) }}
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
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
