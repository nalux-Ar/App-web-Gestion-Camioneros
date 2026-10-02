import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

import { formatDateShort } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { isCombustible, nombreParaMostrar, type Categoria } from './categorias';
import type { GastoDeLista } from './gastos-api';

interface GastoItemProps {
  gasto: GastoDeLista;
  /** La categoría, si ya se cargaron las categorías (si no, se muestra un nombre genérico). */
  categoria: Categoria | undefined;
  /** `search` de la lista actual: viaja a la edición para volver con los mismos filtros. */
  volver: string;
}

/**
 * Una fila de la lista: toda es un enlace a editar (área táctil ≥ 64 px). Categoría y monto son lo
 * principal; la descripción va truncada a una línea; si es combustible y tiene litros, se muestran
 * junto a la fecha. Los números van sin símbolo de moneda.
 */
export function GastoItem({ gasto, categoria, volver }: GastoItemProps) {
  const nombre = categoria ? nombreParaMostrar(categoria) : 'Gasto';
  // Los litros solo se guardan en combustible; si todavía no llegaron las categorías, `litros != null` ya lo implica.
  const mostrarLitros = gasto.litros !== null && (categoria === undefined || isCombustible(categoria));
  const detalle = [formatDateShort(gasto.fecha), mostrarLitros ? `${formatNumber(gasto.litros, { decimales: 3, fijos: false })} L` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <Link
        to={`/gastos/${gasto.id}/editar`}
        state={{ volver }}
        className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{nombre}</p>
          {gasto.descripcion ? <p className="truncate text-sm text-muted-foreground">{gasto.descripcion}</p> : null}
          <p className="text-sm text-muted-foreground">{detalle}</p>
        </div>
        <p className="shrink-0 text-right text-base font-semibold tabular-nums">
          {formatNumber(gasto.monto, { decimales: 2 })}
        </p>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}
