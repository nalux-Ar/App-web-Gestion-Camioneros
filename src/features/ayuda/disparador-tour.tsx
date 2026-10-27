import { Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { useAuth } from '@/features/auth/use-auth';
import { useMember } from '@/features/member/use-member';
import { TourAyudaDiferido } from './ayuda-lazy';
import { usePedidosDeRecorrido } from './pedido-recorrido';
import { buscarObjetivo } from './posicion';
import { TOUR_PASOS } from './tour-pasos';
import { debeMostrarseElTour, leerTourVistoLocal, TOUR_VERSION } from './tour-version';

/** Cada cuánto se mira si Inicio ya dibujó, y hasta cuándo (después se deja para la próxima vez). */
const REVISAR_CADA_MS = 150;
const ESPERA_MAXIMA_MS = 10_000;

/** Los objetivos que prueban que Inicio ya está en pantalla (la barra de navegación o la tarjeta del camión). */
const SENALES_DE_INICIO = ['nav-viajes', 'camion'] as const;

/**
 * Montado en el AppShell (diferido). Arranca el recorrido de bienvenida:
 *  - AUTOMÁTICO, una vez: con el miembro `ready`, la ruta exactamente `/` y una versión vista (la mayor entre la base y la
 *    copia local de este usuario) menor que `TOUR_VERSION`. Al terminar o saltar (las dos cuentan como visto) llama a
 *    `marcarTourVisto`. Sin señal corre igual (la marca queda local y se reintenta).
 *  - A PEDIDO ("Ver el recorrido otra vez" en Inicio): lo muestra sin escribir nada en la base ni tocar la versión.
 * En los dos casos espera a que Inicio ya haya dibujado (un `data-ayuda` visible). Si la ruta deja de ser `/`, no se
 * muestra (y el automático no se marca como visto).
 */
export function DisparadorTour() {
  const { member, status, marcarTourVisto } = useMember();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const pedidos = usePedidosDeRecorrido();
  const [atendidos, setAtendidos] = useState(pedidos);
  const [automaticoCerrado, setAutomaticoCerrado] = useState(false);
  const [inicioListo, setInicioListo] = useState(false);

  const automatico =
    !automaticoCerrado &&
    debeMostrarseElTour({
      status,
      pathname,
      versionBase: member?.tourVersionVista ?? 0,
      versionLocal: leerTourVistoLocal(user?.id ?? null),
    });
  const aPedido = !automatico && pathname === '/' && pedidos !== atendidos;
  const mostrar = automatico || aPedido;

  // Espera a que Inicio esté dibujado (sin eso, el primer paso que señala la barra quedaría centrado sin necesidad).
  useEffect(() => {
    if (!mostrar || inicioListo) return;
    const inicio = Date.now();
    let id = 0;
    function revisar() {
      if (SENALES_DE_INICIO.some((objetivo) => buscarObjetivo(objetivo) !== null)) {
        setInicioListo(true);
        return;
      }
      if (Date.now() - inicio < ESPERA_MAXIMA_MS) id = window.setTimeout(revisar, REVISAR_CADA_MS);
    }
    id = window.setTimeout(revisar, 0);
    return () => window.clearTimeout(id);
  }, [mostrar, inicioListo]);

  // Al salir de Inicio, la próxima vez se vuelve a esperar a que dibuje.
  useEffect(() => {
    if (pathname === '/' || !inicioListo) return;
    const id = window.setTimeout(() => setInicioListo(false), 0);
    return () => window.clearTimeout(id);
  }, [pathname, inicioListo]);

  if (!mostrar || !inicioListo) return null;

  // Terminar o saltar valen lo mismo: el recorrido cuenta como visto.
  function terminar() {
    if (automatico) {
      setAutomaticoCerrado(true);
      void marcarTourVisto(TOUR_VERSION);
    } else {
      setAtendidos(pedidos);
    }
  }

  return (
    <Suspense fallback={null}>
      <TourAyudaDiferido pasos={TOUR_PASOS} onTerminar={terminar} />
    </Suspense>
  );
}
