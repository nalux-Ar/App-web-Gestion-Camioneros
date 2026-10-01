import { QueryClient } from '@tanstack/react-query';

import { classifyDataError } from '@/lib/data-errors';

/**
 * Cliente de TanStack Query de toda la app (un único singleton, montado en
 * `src/App.tsx`).
 *
 * SEGURIDAD: la caché es por usuario, nunca compartida. `AuthProvider` la
 * vacía (`queryClient.clear()`) en cualquier transición sesión → sin sesión y
 * cuando cambia el usuario (logout manual, sesión vencida, logout en otra
 * pestaña). Además todas las query keys llevan el `transportista_id`
 * (ver `src/lib/query-keys.ts`): aunque algo se escapara del `clear()`, los
 * datos de un tenant jamás se leerían bajo la key de otro.
 */

const QUERY_STALE_TIME_MS = 30_000;
const QUERY_GC_TIME_MS = 10 * 60_000;
const MAX_QUERY_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 8_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 s: al volver a una lista (p.ej. de Gastos a Inicio y de vuelta) se
      // ve al instante lo que ya estaba en caché, sin pedir de nuevo con
      // señal floja. Después de 30 s se considera vieja y se refresca al
      // volver a montar la pantalla. Las mutaciones invalidan lo que tocan,
      // así que lo que carga el propio usuario se ve enseguida.
      staleTime: QUERY_STALE_TIME_MS,

      // 10 min (el default es 5): los datos de una pantalla que se dejó
      // quedan a mano un rato más, útil si se pierde señal al volver a ella.
      gcTime: QUERY_GC_TIME_MS,

      // Reintento AUTOMÁTICO solo cuando `classifyDataError` dice 'server':
      // códigos de servidor de Postgres/PostgREST (base caída o sin
      // conexiones, deadlock, statement timeout: PGRST000-003 y clases
      // 08/40/53/54/55/57/58/XX) o un error con `status` >= 500 (un 502/504
      // de gateway, que solo trae `status` si la queryFn pasó por `unwrap()`).
      // Hasta 2 reintentos, con espera creciente.
      // NO se reintenta desde acá:
      //  - red caída: supabase-js (postgrest-js 2.x) ya reintenta los GET por
      //    su cuenta hasta 3 veces (1 s, 2 s, 4 s) ante una falla de red o un
      //    503/520; apilar otra ronda dejaría ~25 s de spinner sin decir nada.
      //    Mejor mostrar el error a los pocos segundos con "Reintentar".
      //  - timeout/abort del cliente (`kind: 'timeout'`) y errores
      //    desconocidos: no hay motivo para creer que la segunda vez sale.
      //  - 4xx (RLS, check, sesión): daría lo mismo.
      retry: (failureCount, error) =>
        failureCount < MAX_QUERY_RETRIES && classifyDataError(error) === 'server',
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, MAX_RETRY_DELAY_MS),

      // NO refrescar al volver a la pestaña/app. En el celular ese evento
      // salta cada vez que se vuelve de WhatsApp, del mapa o de la llamada
      // que se atendió en ruta: con señal mala o datos móviles sería una
      // ráfaga de pedidos (y de errores en pantalla) para nada. Los datos
      // los cambia casi siempre el propio usuario desde esta app (y sus
      // mutaciones ya invalidan), así que no hay mucho que "descubrir".
      // Contrapartida: si carga desde la PC y mira el celular, ve lo viejo
      // hasta que navegue o pase el staleTime (se refresca al montar).
      refetchOnWindowFocus: false,

      // SÍ refrescar al recuperar la conexión: es justo cuando la pantalla
      // pudo quedar vieja o con error. Con `networkMode: 'online'` (default
      // de las queries) las consultas sin señal quedan en pausa y se
      // reanudan solas al volver la red, en vez de fallar. Ojo en la UI: una
      // query pausada tiene `status: 'pending'` para siempre mientras no hay
      // red; `ListSkeleton` ya avisa "Sin conexión".
      refetchOnReconnect: true,
    },

    mutations: {
      // Las mutaciones NO se reintentan solas y NO se pausan sin red:
      //  - `retry: 0`: un reintento automático de un INSERT puede duplicar el
      //    gasto si el primer pedido sí llegó al servidor y lo que se perdió
      //    fue la respuesta (típico con señal intermitente).
      //  - `networkMode: 'always'`: por defecto, una mutación sin red queda
      //    "pausada" y se dispara SOLA cuando vuelve la conexión, posiblemente
      //    minutos después, con el usuario ya en otra pantalla (o habiendo
      //    tocado "Guardar" de nuevo: doble carga). Con 'always' se intenta
      //    en el momento y, si falla, falla en el momento.
      // El reintento es MANUAL: el usuario ve el error, el formulario
      // conserva lo tipeado y toca "Reintentar" (ver `useSubmitFeedback`).
      retry: 0,
      networkMode: 'always',
    },
  },
});
