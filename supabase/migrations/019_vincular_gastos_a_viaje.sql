-- =====================================================================
-- 019_vincular_gastos_a_viaje.sql — Elan (Gastos: sumar varios gastos sueltos a un viaje)
-- =====================================================================
-- Qué hace: crea UNA función, public.vincular_gastos_a_viaje(p_viaje_id,
-- p_gasto_ids), que vincula a un viaje, de una sola vez y de forma atómica,
-- varios gastos que hoy no tienen viaje, y devuelve qué pasó con cada uno. No
-- crea tablas, columnas ni índices y no cambia ningún dato existente.
--
-- Por qué: hoy vincular un gasto a un viaje obliga a editar los gastos de a uno.
-- Desde el detalle del viaje («Sumar gastos que ya cargué») el usuario marca
-- varios y los suma juntos. Hace falta una operación masiva y atómica (o quedan
-- todos o no queda ninguno) y que explique qué pasó con cada gasto, porque la
-- lista que ve la pantalla puede estar vieja (otra pestaña u otro dispositivo
-- ya movió, borró o vinculó alguno).
--
-- Orden de aplicación: 19. Requiere 001 a 003 y 005 a 018 (usa gastos.viaje_id,
-- gastos.camion_id y viajes.camion_id de la 010, y los triggers de gastos de la
-- 002, la 006, la 010 y la 013). El test de aislamiento completo (sección 27
-- incluida) asume 001 a 003 y 005 a 019.
-- Despliegue: aditiva. El front publicado no la usa; la 019 va ANTES del front
-- que la llama (sin ella, la llamada fallaría con PGRST202). Después de aplicar:
-- regenerar src/lib/database.types.ts (la RPC nueva).
--
-- ---------------------------------------------------------------------
-- vincular_gastos_a_viaje(p_viaje_id uuid, p_gasto_ids uuid[])
-- ---------------------------------------------------------------------
-- Devuelve UNA fila (gasto_id uuid, resultado text) por cada gasto pedido, en el
-- orden en que llegaron en la lista y sin repetir. resultado, uno de:
--   vinculado        El gasto estaba suelto (sin viaje) y ahora está en el viaje.
--   ya_estaba        El gasto ya estaba en ESTE viaje. No se toca.
--   en_otro_viaje    El gasto está en OTRO viaje. NO se mueve: una pestaña con la
--                    lista vieja no tiene que sacarle un gasto a otro viaje y
--                    cambiarle la ganancia sin que nadie lo note. Mover un gasto
--                    de un viaje a otro se hace en dos pasos, a propósito:
--                    primero se lo quita del viaje y después se lo suma al nuevo.
--   camion_distinto  El gasto está suelto pero tiene un camión distinto del del
--                    viaje. No se vincula (ver "Camión" abajo).
--   no_encontrado    No existe un gasto con ese id en la cuenta. Es la MISMA
--                    respuesta para un id inexistente y para el de un gasto de
--                    otra cuenta: no sirve de oráculo de existencia entre cuentas.
-- Si un gasto cumple más de una condición, gana la primera de esta lista en este
-- orden: no_encontrado, ya_estaba, en_otro_viaje, camion_distinto, vinculado
-- (p. ej. un gasto de otro viaje y de otro camión devuelve en_otro_viaje).
--
-- Normalización de la lista (se hace antes de tocar nada):
--   * Los NULL dentro de la lista se descartan: no son gastos, no devuelven fila
--     ni dan error. Si no queda ningún id (lista vacía, NULL o solo NULL) es 22023.
--   * Los ids repetidos se juntan en uno solo, en el lugar de su primera
--     aparición: [b, a, b, a] devuelve b y a, una fila cada uno.
--   * El tope de 100 se aplica al largo de la lista TAL COMO LLEGA, antes de
--     normalizar: un pedido enorme se corta de entrada, sin trabajo, aunque
--     tuviera pocos ids distintos.
--
-- Camión (misma regla que el trigger de la 010, fn_validar_camion, que sigue
-- siendo la defensa final): solo hay conflicto si el gasto tiene camión Y el
-- viaje tiene camión Y son distintos.
--   * gasto con camión, viaje con otro camión ........ camion_distinto
--   * gasto con camión, viaje con el mismo camión .... vinculado
--   * gasto con camión, viaje SIN camión ............. vinculado (el gasto conserva el suyo)
--   * gasto SIN camión, viaje con camión ............. vinculado
--   * gasto SIN camión, viaje sin camión ............. vinculado
-- Qué pasa con el camión de un gasto sin camión al vincularlo: NADA. La función
-- escribe una sola columna (viaje_id) y el gasto sigue con camion_id NULL. Es lo
-- que ya hace la base (la 010 solo rellena el camión de un gasto con litros, y
-- un gasto con litros siempre tiene camión por la 011: los demás pueden ser
-- gastos propios, no del camión). El Resumen lo atribuye al camión del viaje por
-- la regla de la 014 (resumen_gastos: el camión del gasto o, si no tiene, el del
-- viaje), y al quitarlo del viaje vuelve a «Sin camión» sin pérdida. Un camión
-- ARCHIVADO del viaje no impide vincular: la regla de archivado de la 010 solo
-- mira el camión del gasto cuando CAMBIA, y esta función nunca lo cambia.
--
-- Qué escribe: SOLO gastos.viaje_id, y solo en los gastos que cuentan como
-- «vinculado». Los triggers que ya existen se ocupan del resto: updated_at
-- (trg_30), la coherencia de camión (trg_22), el cambio de id y de tenant
-- (trg_20, 013) y el client_ref inmutable (trg_25, 006); ninguno choca con un
-- UPDATE que solo toca viaje_id. Los gastos que no se vinculan no se tocan
-- (ni siquiera updated_at).
--
-- Idempotente: repetir la llamada (por ejemplo después de perder la respuesta
-- por mala señal) deja el mismo estado final; la segunda vez devuelve ya_estaba
-- para lo que la primera vinculó y lo mismo que antes para lo demás. No usa
-- client_ref: no crea filas.
--
-- ---------------------------------------------------------------------
-- Errores (SQLSTATE en error.code; textos fijos, sin datos de ninguna fila)
-- ---------------------------------------------------------------------
-- Se rechaza SIN cambiar nada, en este orden:
--   42501  Sin cuenta (el usuario no pertenece a ningún transportista):
--          "No perteneces a ningún transportista: no se pueden sumar gastos al
--          viaje". También lo da anon, pero por permiso sobre la función misma.
--   22023  Viaje nulo: "Falta el id del viaje".
--   22023  Más de 100 elementos en la lista: "Se pueden sumar como máximo 100
--          gastos por vez".
--   22023  Lista nula, vacía o sin ningún id (solo NULL): "Hace falta al menos
--          un gasto para sumar al viaje". (Se decide después de normalizar la
--          lista; no se puede dar junto con el error de más de 100.)
--   P0002  Viaje inexistente o de otra cuenta, con el MISMO error para los dos:
--          "No se encontró el viaje".
-- No se atrapan excepciones: cualquier error de un trigger o de una restricción
-- se propaga tal cual y deja TODO sin cambios. En particular, si más adelante
-- hay un trigger de cobro que levante PT402 en el UPDATE de gastos (cuenta en
-- solo lectura), esa excepción llega intacta a quien llamó, sin que se guarde
-- ningún gasto a medias. Hoy ese trigger no existe y esta función no sabe nada
-- de cobro; la sección 27 del test lo comprueba con un trigger de prueba.
--
-- ---------------------------------------------------------------------
-- Concurrencia y locks (orden fijo: viaje, después gastos por id)
-- ---------------------------------------------------------------------
-- 1) La fila del viaje, con FOR SHARE, en una sentencia propia ANTES de tocar
--    los gastos. Por qué SHARE: mientras esta transacción decide y escribe,
--    nadie puede cambiar el viaje (ni su camión, que es lo que se compara) ni
--    borrarlo: quien lo intente espera a que termine. Es el mismo modo que ya
--    usa fn_validar_camion (010), así que no choca consigo mismo, y deja que
--    dos llamadas sobre el mismo viaje corran a la vez (se encuentran recién
--    en los gastos, que se piden en el mismo orden). Un modo más fuerte
--    serializaría sin necesidad. Como es una sentencia aparte, el orden no
--    depende del plan: el viaje se bloquea antes.
-- 2) Los gastos pedidos que existen en la cuenta, ordenados por id y con FOR
--    UPDATE (todos, también los que no se van a vincular: así lo que se informa
--    vale al momento del COMMIT). Se leen, se clasifican y se escriben en UNA
--    sola sentencia, con una sola vista de los datos, tomada después del lock
--    del viaje. En READ COMMITTED, FOR UPDATE vuelve a leer la última versión
--    de cada fila después de esperar, así que una fila cambiada mientras
--    esperábamos se clasifica con su estado actual.
-- Todas las llamadas toman los locks en el mismo orden (viaje, gastos por id), y
-- el resto de la base o va también del viaje al gasto (fn_propagar_camion_viaje,
-- 010) o toma el viaje en un modo compatible con este (fn_validar_camion), así
-- que esta función no agrega ciclos de espera. Hay una sola conexión en el test,
-- por lo que solo se comprueba que los locks estén tomados y que el código los
-- pida en ese orden (sección 27), no la espera entre dos transacciones.
--
-- ---------------------------------------------------------------------
-- Reglas comunes (como en la 014, la 016 y la 018)
-- ---------------------------------------------------------------------
-- * language plpgsql VOLATILE (escribe) SECURITY INVOKER, search_path fijo y
--   "#variable_conflict use_column": RLS sigue filtrando como en un UPDATE
--   directo, y además cada consulta lleva el filtro explícito
--   transportista_id = get_mi_transportista_id() (defensa en profundidad: vale
--   también en una conexión que saltee RLS; la sección 27 lo prueba como
--   postgres con el JWT de una cuenta).
-- * Sin SECURITY DEFINER: no entra en los avisos 0028/0029 de los advisors.
-- * EXECUTE revocado a public, anon y authenticated, y otorgado solo a
--   authenticated. service_role conserva el EXECUTE por defecto de la
--   plataforma, como en las demás funciones; sin usuario en el JWT recibe 42501.
-- * create function (no create or replace), como la 014 y la 018: si ya hubiera
--   una función con esa firma, que la migración falle en vez de pisarla.
--
-- ---------------------------------------------------------------------
-- Lo que NO es una función (consultas comunes, con los permisos y la RLS de hoy)
-- ---------------------------------------------------------------------
-- * Candidatos de la pantalla: gastos sin viaje de la cuenta, los más cercanos
--   a la fecha del viaje primero y después los más recientes, hasta 100 y SIN
--   ventana fija de días: select ... from gastos where viaje_id is null, con
--   orden por la distancia en días entre gastos.fecha y la fecha del viaje (y,
--   a igual distancia, fecha desc). Usa los índices de la 001 (transportista_id,
--   fecha) y (transportista_id, viaje_id); no hace falta uno nuevo.
-- * Deshacer («Quitar del viaje»): update gastos set viaje_id = null where id in
--   (...) and viaje_id = <el viaje>. Los gastos no se borran. authenticated tiene
--   UPDATE sobre gastos desde la 003 (de tabla entera, no por columna) y la
--   policy por cuenta ya filtra. El gasto conserva su camión: vincular y quitar
--   es un viaje de ida y vuelta sin cambios.
--
-- ---------------------------------------------------------------------
-- Efecto en el Resumen (hay que decirlo en la ayuda de la pantalla)
-- ---------------------------------------------------------------------
-- * Ningún total por fecha cambia: el gasto del mes, por categoría y por método
--   de pago, y el resultado del mes (resumen_gastos, resumen_mensual) dependen
--   de la fecha del gasto, no de su viaje.
-- * Cambian la ganancia del viaje (resumen_viajes: ingreso menos TODOS los gastos
--   vinculados) y el grupo «por camión» de resumen_gastos (un gasto sin camión
--   pasa de «Sin camión» al camión del viaje).
--
-- ---------------------------------------------------------------------
-- Locks, datos y reversibilidad
-- ---------------------------------------------------------------------
-- * CREATE FUNCTION no toma locks sobre las tablas. En uso, la función toma los
--   locks de fila descritos arriba, sobre un máximo de 100 gastos más el viaje.
-- * Busca por id (clave primaria) dentro de la cuenta: no necesita índices
--   nuevos.
-- * Aditiva y reversible a mano, en una transacción:
--     drop function if exists public.vincular_gastos_a_viaje(uuid, uuid[]);
--   (y volver al front anterior, si ya la usaba). Los gastos que se hayan
--   vinculado con ella quedan vinculados.
-- =====================================================================

set local lock_timeout = '5s';

create function public.vincular_gastos_a_viaje(p_viaje_id uuid, p_gasto_ids uuid[])
returns table (gasto_id uuid, resultado text)
language plpgsql
volatile
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  -- Tope de gastos por llamada (sobre el largo de la lista recibida).
  c_max_gastos constant integer := 100;
  v_tid uuid;
  v_ids uuid[];
  v_viaje_camion uuid;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista: no se pueden sumar gastos al viaje'
      using errcode = '42501';
  end if;

  if p_viaje_id is null then
    raise exception 'Falta el id del viaje' using errcode = '22023';
  end if;
  -- El tope se mide sobre la lista tal como llega, antes de normalizarla. Con una
  -- lista NULL, cardinality da NULL y no entra acá: la rechaza el chequeo de abajo.
  if cardinality(p_gasto_ids) > c_max_gastos then
    raise exception 'Se pueden sumar como máximo % gastos por vez', c_max_gastos
      using errcode = '22023';
  end if;

  -- Lista normalizada: sin NULL y sin repetidos, en el orden de la primera
  -- aparición. Una lista NULL, vacía o de solo NULL queda vacía.
  v_ids := array(
    select u.id
      from unnest(p_gasto_ids) with ordinality as u(id, ord)
     where u.id is not null
     group by u.id
     order by min(u.ord)
  );
  if cardinality(v_ids) = 0 then
    raise exception 'Hace falta al menos un gasto para sumar al viaje' using errcode = '22023';
  end if;

  -- Lock 1: el viaje. Un viaje inexistente y uno de otra cuenta dan el mismo
  -- error (RLS + filtro explícito: no se ve ni se bloquea).
  select vi.camion_id into v_viaje_camion
    from public.viajes vi
   where vi.id = p_viaje_id and vi.transportista_id = v_tid
     for share;
  if not found then
    raise exception 'No se encontró el viaje' using errcode = 'P0002';
  end if;

  -- Lock 2, clasificación y escritura en una sola sentencia: los gastos pedidos
  -- (los de otra cuenta y los inexistentes no aparecen en "bloqueados") se
  -- bloquean por id y se leen ya bloqueados; solo se actualizan los sueltos
  -- cuyo camión no choca con el del viaje; la respuesta sale de lo bloqueado y
  -- de lo que realmente se actualizó. "camion_choca" es la regla de camión,
  -- definida una sola vez para decidir y para informar. El CASE no tiene ELSE a
  -- propósito: solo daría NULL si un trigger frenara el UPDATE de un gasto sin
  -- levantar un error (el de cobro, si llega, levanta PT402); ese gasto saldría
  -- con resultado NULL y no con uno falso.
  return query
  with pedidos as (
    select u.id, u.ord
      from unnest(v_ids) with ordinality as u(id, ord)
  ), bloqueados as (
    select g.id, g.viaje_id, g.camion_id,
           coalesce(g.camion_id <> v_viaje_camion, false) as camion_choca
      from public.gastos g
     where g.transportista_id = v_tid
       and g.id in (select p.id from pedidos p)
     order by g.id
       for update
  ), movidos as (
    update public.gastos gu
       set viaje_id = p_viaje_id
     where gu.transportista_id = v_tid
       and gu.id in (select b.id from bloqueados b
                      where b.viaje_id is null and not b.camion_choca)
    returning gu.id
  )
  select p.id,
         case
           when b.id is null then 'no_encontrado'
           when b.viaje_id = p_viaje_id then 'ya_estaba'
           when b.viaje_id is not null then 'en_otro_viaje'
           when m.id is not null then 'vinculado'
           when b.camion_choca then 'camion_distinto'
         end
    from pedidos p
    left join bloqueados b on b.id = p.id
    left join movidos m on m.id = p.id
   order by p.ord;
end;
$$;

comment on function public.vincular_gastos_a_viaje(uuid, uuid[]) is
  'Suma varios gastos sueltos a un viaje, de una vez y de forma atómica (SECURITY INVOKER, VOLATILE). Devuelve una fila (gasto_id, resultado) por gasto pedido, en el orden recibido y sin repetidos: vinculado, ya_estaba (ya estaba en este viaje), en_otro_viaje (no se mueve), camion_distinto (el gasto y el viaje tienen camiones distintos) o no_encontrado (inexistente o de otra cuenta, igual). Hasta 100 por llamada; los NULL se descartan. Idempotente. Escribe solo gastos.viaje_id. Errores: 42501 sin cuenta, 22023 parámetros inválidos, P0002 viaje inexistente o ajeno; ver el encabezado de 019.';

-- ---------------------------------------------------------------------
-- Permisos: solo authenticated.
-- ---------------------------------------------------------------------
revoke execute on function public.vincular_gastos_a_viaje(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.vincular_gastos_a_viaje(uuid, uuid[]) to authenticated;
