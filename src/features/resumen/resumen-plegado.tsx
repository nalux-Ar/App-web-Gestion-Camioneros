import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ContenidoDeConsulta, type ConsultaDeBloque } from './resumen-bloque';
import { PLEGADO_NO_SE_PUDO_CARGAR } from './resumen-pantalla-textos';

/**
 * ¿Abierto o cerrado? Arranca cerrado y no se guarda (la pantalla lo rearma al cambiar de período o de vista).
 *
 * Con la consulta PROPIA del plegado, un fallo lo abre solo UNA vez, para que el error no quede escondido. "El mismo
 * fallo" dura hasta que la consulta vuelve a traer datos: si la persona lo cierra, ni un reintento que vuelve a fallar ni
 * el refresco al recuperar la señal lo reabren. Un fallo posterior a una carga buena es otro, y sí lo abre.
 */
function useAperturaDelPlegado(consultaPropia: ConsultaDeBloque<unknown> | undefined) {
  const [abierto, setAbierto] = useState(false);
  const [falloYaMostrado, setFalloYaMostrado] = useState(false);

  // Ajuste de estado durante el render (sin efecto): la región llega al documento ya abierta, junto con su error.
  if (consultaPropia?.isError && !falloYaMostrado) {
    setFalloYaMostrado(true);
    setAbierto(true);
  } else if (falloYaMostrado && consultaPropia && !consultaPropia.isError && consultaPropia.data !== undefined) {
    setFalloYaMostrado(false);
  }

  return { abierto, alternar: () => setAbierto((valor) => !valor) };
}

interface PlegadoResumenProps {
  /** id de la sección (el del título es `${id}-titulo` y el de la región `${id}-contenido`). */
  id: string;
  titulo: string;
  ocupada?: boolean;
  /**
   * La consulta que usa SOLO este plegado: si falla, se abre solo (una vez) y, cerrado, el encabezado lo avisa. Los
   * plegados que comparten consulta con una tarjeta de arriba no la pasan: el error ya se ve allá.
   */
  consultaPropia?: ConsultaDeBloque<unknown>;
  children: ReactNode;
}

/**
 * Una sección que se abre y se cierra tocando su título (acordeón: un `h2` con un botón adentro, de fila entera y 48 px
 * como mínimo). La sección se llama como su título. La región está siempre en la página, oculta mientras está cerrada,
 * así el `aria-controls` del botón nunca apunta a la nada.
 */
export function PlegadoResumen({ id, titulo, ocupada = false, consultaPropia, children }: PlegadoResumenProps) {
  const { abierto, alternar } = useAperturaDelPlegado(consultaPropia);
  const tituloId = `${id}-titulo`;
  const contenidoId = `${id}-contenido`;
  const avisarFallo = !abierto && consultaPropia?.isError === true;

  return (
    <section id={id} aria-labelledby={tituloId} aria-busy={ocupada} className="rounded-lg border border-border bg-card">
      <h2 className="text-lg font-semibold">
        <button
          type="button"
          aria-expanded={abierto}
          aria-controls={contenidoId}
          onClick={alternar}
          // `hover:bg-accent/50` y no `bg-accent` entero: el aviso en color de error tiene que seguir llegando a 4,5:1.
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span id={tituloId} className="break-words">
              {titulo}
            </span>
            {avisarFallo ? (
              <>
                {/* El espacio separa las dos frases en el nombre del botón (no dibuja nada). */}{' '}
                <span data-plegado-fallo="" className="flex items-start gap-2 text-base font-normal text-destructive-text">
                  <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{PLEGADO_NO_SE_PUDO_CARGAR}</span>
                </span>
              </>
            ) : null}
          </span>
          <ChevronDown className={cn('size-5 shrink-0 transition-transform motion-reduce:transition-none', abierto && 'rotate-180')} aria-hidden="true" />
        </button>
      </h2>
      {/* Sin clases de `display` acá: pisarían al atributo `hidden`. */}
      <div id={contenidoId} hidden={!abierto} className="space-y-4 px-4 pb-4 pt-1">
        {children}
      </div>
    </section>
  );
}

interface BloquePlegadoProps<T> {
  id: string;
  titulo: string;
  consulta: ConsultaDeBloque<T>;
  filasCargando?: number;
  /** El contenido con los datos ya cargados (el vacío lo decide cada bloque). */
  children: (datos: T) => ReactNode;
}

/** Un bloque con consulta propia, plegado: adentro, lo mismo que `BloqueResumen` (carga, error con "Reintentar", datos). */
export function BloquePlegado<T>({ id, titulo, consulta, filasCargando, children }: BloquePlegadoProps<T>) {
  return (
    <PlegadoResumen id={id} titulo={titulo} ocupada={consulta.data === undefined && !consulta.isError} consultaPropia={consulta}>
      <ContenidoDeConsulta consulta={consulta} filasCargando={filasCargando}>
        {children}
      </ContenidoDeConsulta>
    </PlegadoResumen>
  );
}
