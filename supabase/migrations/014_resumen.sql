-- =====================================================================
-- 014_resumen.sql — Elan (Bloque C, etapa Resumen: la pantalla de reportes)
-- =====================================================================
-- Qué hace: crea cuatro funciones de SOLO LECTURA que calculan en la base los
-- números de la pantalla Resumen:
--   * resumen_gastos(p_desde, p_hasta)            gasto del período, desglosado.
--   * resumen_mensual(p_mes_desde, p_meses)       una fila por mes (comparación con
--                                                 el mes anterior y vista anual).
--   * resumen_combustible(p_desde, p_hasta, p_camion_id)
--                                                 carga y rendimiento por camión.
--   * resumen_viajes(p_desde, p_hasta)            viajes con su ganancia.
-- No crea tablas, columnas ni índices y no cambia ningún dato.
--
-- Por qué en la base y no en el front: PostgREST corta cada consulta en 1.000
-- filas, y un año de uso intenso ya pasa ese número solo en gastos (~3.650).
-- Sumar en el front daría totales incompletos sin avisar. Estas funciones
-- devuelven filas AGREGADAS (como máximo unas decenas; la lista de viajes, 500
-- con aviso), así que el corte no las alcanza.
--
-- Orden de aplicación: 14. Requiere 001 a 003 y 005 a 013 (usa gastos.litros,
-- km_odometro y tanque_lleno de la 005, camion_id de la 010 y la regla de la
-- 011: todo gasto con litros tiene camión). El test de aislamiento completo
-- (sección 23 incluida) asume 001 a 003 y 005 a 014.
-- Despliegue: aditiva. El front publicado no la usa; la 014 va ANTES del front
-- de la pantalla Resumen (sin ella, sus llamadas fallarían con PGRST202).
-- Después de aplicar: regenerar src/lib/database.types.ts (las RPC nuevas).
--
-- ---------------------------------------------------------------------
-- Reglas comunes (seguridad y parámetros)
-- ---------------------------------------------------------------------
-- * language plpgsql STABLE SECURITY INVOKER, search_path fijo y
--   "#variable_conflict use_column": RLS sigue filtrando como en un SELECT
--   directo, y además cada consulta lleva el filtro explícito
--   transportista_id = get_mi_transportista_id() (defensa en profundidad: vale
--   también en una conexión que saltee RLS).
-- * EXECUTE revocado a public, anon y authenticated, y otorgado solo a
--   authenticated.
-- * Las fechas las manda siempre el front (en hora local): las funciones nunca
--   usan current_date. Los rangos son INCLUSIVOS en los dos extremos (p_hasta
--   incluido).
-- * Errores (SQLSTATE en error.code):
--     42501  sin cuenta (el usuario no pertenece a ningún transportista), o sin
--            EXECUTE (anon).
--     22023  parámetros inválidos, con texto fijo:
--            "Período inválido: hacen falta desde y hasta, con desde <= hasta"
--            "Período inválido: no puede superar 366 días" (gastos, combustible)
--            "Período inválido: la lista de viajes admite hasta 62 días"
--            "Período inválido: hace falta un mes de inicio y entre 1 y 24 meses"
-- * Sin oráculo de existencia: un camion_id de otra cuenta devuelve lo mismo que
--   uno inexistente (0 filas).
-- * Redondeo en la base: dinero a 2 decimales, litros a 3, km/L a 3,
--   L/100 km a 2 y costo por km a 2. Los km quedan como en los datos (1 decimal).
--
-- ---------------------------------------------------------------------
-- resumen_gastos(p_desde date, p_hasta date)  — rango de hasta 366 días
-- ---------------------------------------------------------------------
-- Gastos con fecha (del gasto) entre p_desde y p_hasta. Devuelve filas
-- (grupo, clave, nombre, activa, cantidad, monto):
--   grupo = 'total'        una sola fila, SIEMPRE (cantidad 0 y monto 0 si no hay
--                          gastos); clave, nombre y activa NULL.
--   grupo = 'categoria'    una fila por categoría usada: clave = id, nombre.
--   grupo = 'metodo_pago'  una fila por método: clave = efectivo |
--                          tarjeta_credito | tarjeta_debito | transferencia, o
--                          NULL = "Sin especificar".
--   grupo = 'camion'       una fila por camión: clave = id, nombre = patente,
--                          activa (false = archivado); clave NULL = "Sin camión".
--                          Camión de cada gasto = el suyo o, si no tiene (todo lo
--                          que no es combustible), el del viaje vinculado.
-- cantidad integer (>= 1, salvo el total), monto numeric (2 decimales).
-- Filas: 1 + categorías usadas + hasta 5 métodos + camiones usados + 1.
-- Nota: la lista de Gastos podría usar esta función más adelante para mostrar el
-- total exacto del mes (y de cada categoría) en vez de sumar 500 filas.
--
-- ---------------------------------------------------------------------
-- resumen_mensual(p_mes_desde date, p_meses integer)  — de 1 a 24 meses
-- ---------------------------------------------------------------------
-- p_mes_desde puede ser cualquier día: se toma su mes. Devuelve EXACTAMENTE
-- p_meses filas, una por mes calendario (también los vacíos), ordenadas:
--   mes date (primer día), gastos_cantidad integer, gastos_monto numeric,
--   combustible_cargas integer, combustible_litros numeric, combustible_monto
--   numeric (cargas = gastos con litros), viajes_cantidad integer, viajes_km
--   numeric, viajes_con_ingreso integer, viajes_sin_ingreso integer,
--   viajes_ingreso numeric, resultado numeric NULL.
-- Gastos por la fecha del gasto; viajes por la fecha del viaje. Km de un viaje =
-- km_recorridos o km_final - km_inicial (sin km final, no suma). Un ingreso 0
-- cuenta como cargado.
-- resultado = ingresos de los viajes del mes - TODOS los gastos del mes
-- (vinculados o no). NULL si ningún viaje del mes tiene ingreso cargado (para no
-- mostrar "todo pérdida"); los viajes sin ingreso se informan aparte.
--
-- ---------------------------------------------------------------------
-- resumen_combustible(p_desde date, p_hasta date, p_camion_id uuid default null)
-- — rango de hasta 366 días
-- ---------------------------------------------------------------------
-- Una fila por camión de la cuenta con cargas en el período o con algún tramo
-- que cierre en él (archivados incluidos, con activa = false); con p_camion_id,
-- solo ese camión. Columnas:
--   camion_id uuid, patente text, activa boolean,
--   cargas integer, litros numeric, monto numeric, precio_promedio numeric NULL
--     (cargas con fecha en el período; precio ponderado = monto / litros),
--   llenas_con_odometro integer (bordes en el período),
--   tramos integer, tramos_km numeric NULL, tramos_litros numeric NULL,
--   tramos_monto numeric NULL (tramos VÁLIDOS que cierran en el período),
--   km_por_litro numeric NULL, litros_100km numeric NULL, costo_por_km numeric
--     NULL (NULL sin tramos válidos),
--   descartados_retroceso integer, descartados_sin_avance integer,
--   descartados_fuera_de_rango integer.
-- Reglas del rendimiento (método lleno a lleno):
-- * Carga = gasto con litros (siempre tiene camión, 011). Se apoya en los datos,
--   no en el nombre de la categoría (decisión de la 005).
-- * Orden de las cargas de un camión: fecha; dentro del mismo día, por
--   odómetro (las que no tienen van al final); después created_at e id.
-- * Borde = carga con tanque_lleno = true Y odómetro. Las demás (parciales,
--   llenas sin odómetro, tanque_lleno NULL) no cortan: suman sus litros al tramo
--   en el que caen (todo lo cargado entre dos llenos se consumió en esos km).
-- * Tramo = de un borde al siguiente del mismo camión. Litros = los de las cargas
--   posteriores al primer borde hasta el segundo inclusive; km = diferencia de
--   odómetro; monto = el de esas mismas cargas.
-- * Descartes, contados por motivo: km < 0 (retroceso), km = 0 (sin avance) y
--   rendimiento fuera de rango: km/L menor que 0,5 o mayor que 15 (0,5 y 15 son
--   VÁLIDOS). Casi siempre es un odómetro mal tipeado; así un error, alto o
--   bajo, cuesta como máximo los dos tramos que toca. (Se descartó la regla
--   "descartar también el tramo que arranca por debajo del odómetro máximo
--   anterior": un solo error alto, un dígito de más, dejaba como válido un tramo
--   absurdo y descartaba todos los siguientes hasta que el odómetro real lo
--   superara.)
-- * Un tramo se atribuye al período de la carga que lo CIERRA. El borde que lo
--   abre puede ser anterior al período: por eso se leen todas las cargas del
--   camión hasta p_hasta, sin límite inferior.
-- * Resultado = suma de km / suma de litros de los tramos válidos (ponderado,
--   no promedio de cocientes); L/100 km = litros * 100 / km; costo por km =
--   monto de combustible de los tramos / km (solo combustible).
-- * La primera carga de un camión no tiene tramo; lo que queda abierto al final
--   del período no cuenta.
-- Filas: como máximo, la cantidad de camiones de la cuenta.
--
-- ---------------------------------------------------------------------
-- resumen_viajes(p_desde date, p_hasta date)  — rango de hasta 62 días
-- ---------------------------------------------------------------------
-- Viajes con fecha (del viaje) en el período, del más nuevo al más viejo
-- (fecha, created_at, id), como máximo 500 filas:
--   viaje_id uuid, fecha date, origen text, destino text, camion_id uuid NULL,
--   patente text NULL, km numeric NULL, ingreso numeric NULL,
--   gastos_cantidad integer, gastos_monto numeric, ganancia numeric NULL,
--   total_viajes integer.
-- ganancia = ingreso - TODOS los gastos vinculados al viaje, sean de la fecha
-- que sean (NULL si el viaje no tiene ingreso; un ingreso 0 sí cuenta).
-- total_viajes = cuántos viajes hay en el período (igual en todas las filas): si
-- es mayor que las filas recibidas, la lista se cortó en 500.
--
-- ---------------------------------------------------------------------
-- Locks, datos y reversibilidad
-- ---------------------------------------------------------------------
-- * CREATE FUNCTION no toma locks sobre las tablas. Las funciones son STABLE y
--   solo leen: no escriben nada (lo controla la sección 23 del test).
-- * Aditiva y reversible a mano, en una transacción:
--     drop function if exists public.resumen_gastos(date, date);
--     drop function if exists public.resumen_mensual(date, integer);
--     drop function if exists public.resumen_combustible(date, date, uuid);
--     drop function if exists public.resumen_viajes(date, date);
--   (y volver al front anterior, si ya usaba la pantalla Resumen).
-- =====================================================================

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1) resumen_gastos
-- ---------------------------------------------------------------------
create function public.resumen_gastos(p_desde date, p_hasta date)
returns table (grupo text, clave text, nombre text, activa boolean, cantidad integer, monto numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tid uuid;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Período inválido: hacen falta desde y hasta, con desde <= hasta' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'Período inválido: no puede superar 366 días' using errcode = '22023';
  end if;

  return query
  with g as (
    select g.monto, g.categoria_id, g.metodo_pago,
           coalesce(g.camion_id, v.camion_id) as camion_imputado
      from public.gastos g
      left join public.viajes v on v.transportista_id = g.transportista_id and v.id = g.viaje_id
     where g.transportista_id = v_tid and g.fecha between p_desde and p_hasta
  )
  select 'total'::text, null::text, null::text, null::boolean,
         count(*)::integer, round(coalesce(sum(g.monto), 0), 2)
    from g
  union all
  select 'categoria', c.id::text, c.nombre, null, count(*)::integer, round(sum(g.monto), 2)
    from g join public.categorias_gasto c on c.id = g.categoria_id
   group by c.id, c.nombre
  union all
  select 'metodo_pago', g.metodo_pago::text, null, null, count(*)::integer, round(sum(g.monto), 2)
    from g
   group by g.metodo_pago
  union all
  select 'camion', g.camion_imputado::text, ca.patente, ca.activa, count(*)::integer, round(sum(g.monto), 2)
    from g
    left join public.camiones ca on ca.transportista_id = v_tid and ca.id = g.camion_imputado
   group by g.camion_imputado, ca.patente, ca.activa
  order by 1, 6 desc, 2;
end;
$$;

comment on function public.resumen_gastos(date, date) is
  'Resumen: gasto del período (fecha del gasto, p_hasta inclusivo, hasta 366 días) en filas (grupo, clave, nombre, activa, cantidad, monto): una fila total siempre, y una por categoría, por método de pago (clave NULL = sin especificar) y por camión (el del gasto o el de su viaje; clave NULL = sin camión). SECURITY INVOKER. Ver el encabezado de 014.';

-- ---------------------------------------------------------------------
-- 2) resumen_mensual
-- ---------------------------------------------------------------------
create function public.resumen_mensual(p_mes_desde date, p_meses integer)
returns table (mes date, gastos_cantidad integer, gastos_monto numeric,
               combustible_cargas integer, combustible_litros numeric, combustible_monto numeric,
               viajes_cantidad integer, viajes_km numeric, viajes_con_ingreso integer, viajes_sin_ingreso integer,
               viajes_ingreso numeric, resultado numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tid uuid;
  v_desde date;
  v_hasta date;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista' using errcode = '42501';
  end if;
  if p_mes_desde is null or p_meses is null or p_meses < 1 or p_meses > 24 then
    raise exception 'Período inválido: hace falta un mes de inicio y entre 1 y 24 meses' using errcode = '22023';
  end if;
  v_desde := date_trunc('month', p_mes_desde)::date;
  v_hasta := (v_desde + make_interval(months => p_meses) - interval '1 day')::date;

  return query
  with meses as (
    select gs::date as mes from generate_series(v_desde, v_hasta, interval '1 month') as gs
  ), gm as (
    select date_trunc('month', g.fecha)::date as mes,
           count(*) as c, sum(g.monto) as m,
           count(*) filter (where g.litros is not null) as cc,
           sum(g.litros) as l,
           sum(g.monto) filter (where g.litros is not null) as cm
      from public.gastos g
     where g.transportista_id = v_tid and g.fecha between v_desde and v_hasta
     group by 1
  ), vm as (
    select date_trunc('month', v.fecha)::date as mes,
           count(*) as c,
           sum(coalesce(v.km_recorridos, v.km_final - v.km_inicial)) as km,
           count(*) filter (where v.ingreso is not null) as ci,
           count(*) filter (where v.ingreso is null) as si,
           sum(v.ingreso) as ing
      from public.viajes v
     where v.transportista_id = v_tid and v.fecha between v_desde and v_hasta
     group by 1
  )
  select m.mes,
         coalesce(gm.c, 0)::integer, round(coalesce(gm.m, 0), 2),
         coalesce(gm.cc, 0)::integer, round(coalesce(gm.l, 0), 3), round(coalesce(gm.cm, 0), 2),
         coalesce(vm.c, 0)::integer, coalesce(vm.km, 0)::numeric,
         coalesce(vm.ci, 0)::integer, coalesce(vm.si, 0)::integer,
         round(coalesce(vm.ing, 0), 2),
         case when coalesce(vm.ci, 0) > 0 then round(coalesce(vm.ing, 0) - coalesce(gm.m, 0), 2) end
    from meses m
    left join gm on gm.mes = m.mes
    left join vm on vm.mes = m.mes
   order by 1;
end;
$$;

comment on function public.resumen_mensual(date, integer) is
  'Resumen: una fila por mes calendario (exactamente p_meses, de 1 a 24, desde el mes de p_mes_desde) con gastos, combustible, viajes, ingreso y resultado (ingresos de los viajes del mes - todos los gastos del mes; NULL si ningún viaje del mes tiene ingreso). SECURITY INVOKER. Ver el encabezado de 014.';

-- ---------------------------------------------------------------------
-- 3) resumen_combustible
-- ---------------------------------------------------------------------
create function public.resumen_combustible(p_desde date, p_hasta date, p_camion_id uuid default null)
returns table (camion_id uuid, patente text, activa boolean,
               cargas integer, litros numeric, monto numeric, precio_promedio numeric, llenas_con_odometro integer,
               tramos integer, tramos_km numeric, tramos_litros numeric, tramos_monto numeric,
               km_por_litro numeric, litros_100km numeric, costo_por_km numeric,
               descartados_retroceso integer, descartados_sin_avance integer, descartados_fuera_de_rango integer)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tid uuid;
  -- Rango posible de km/L de un tramo: 0,5 y 15 son válidos; fuera de él, se descarta.
  c_kml_min constant numeric := 0.5;
  c_kml_max constant numeric := 15;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Período inválido: hacen falta desde y hasta, con desde <= hasta' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'Período inválido: no puede superar 366 días' using errcode = '22023';
  end if;

  return query
  with cargas as (
    -- Todas las cargas del camión hasta p_hasta (el borde que abre un tramo puede ser anterior al período).
    select g.camion_id as cid, g.fecha, g.created_at, g.id, g.litros, g.monto, g.km_odometro,
           (g.tanque_lleno is true and g.km_odometro is not null) as borde
      from public.gastos g
     where g.transportista_id = v_tid and g.litros is not null and g.camion_id is not null
       and g.fecha <= p_hasta
       and (p_camion_id is null or g.camion_id = p_camion_id)
  ), num as (
    select c.*,
           row_number() over (partition by c.cid order by c.fecha, c.km_odometro nulls last, c.created_at, c.id) as rn
      from cargas c
  ), ord as (
    -- seg = cuántos bordes hay antes de la carga: las cargas con seg = k forman el tramo k (después del borde k,
    -- hasta el borde k+1 inclusive). km_ini = odómetro del último borde anterior, el que abre el tramo: el máximo
    -- de [nº de carga, odómetro] se queda con el de mayor número de carga. Sin joins entre CTE (con joins, el
    -- planificador estimaba mal las filas y elegía un nested loop).
    select n.*,
           count(*) filter (where n.borde) over w as seg,
           (max(array[n.rn::numeric, n.km_odometro]) filter (where n.borde) over w)[2] as km_ini
      from num n
    window w as (partition by n.cid order by n.rn rows between unbounded preceding and 1 preceding)
  ), tramos as (
    select o.cid, o.seg, sum(o.litros) as l, sum(o.monto) as m,
           max(o.km_ini) as km_ini,
           max(o.km_odometro) filter (where o.borde) as km_fin,
           max(o.fecha) filter (where o.borde) as fecha_fin,
           bool_or(o.borde) as cerrado
      from ord o
     where o.seg >= 1
     group by o.cid, o.seg
  ), ev as (
    -- Solo los tramos que CIERRAN en el período.
    select t.cid, t.l, t.m, t.km_fin - t.km_ini as km,
           case when t.km_fin < t.km_ini then 'retroceso'
                when t.km_fin = t.km_ini then 'sin_avance'
                when (t.km_fin - t.km_ini) / t.l not between c_kml_min and c_kml_max then 'fuera_de_rango'
                else 'valido' end as estado
      from tramos t
     where t.cerrado and t.fecha_fin between p_desde and p_hasta
  ), tr as (
    select ev.cid,
           count(*) filter (where ev.estado = 'valido') as n,
           sum(ev.km) filter (where ev.estado = 'valido') as km,
           sum(ev.l) filter (where ev.estado = 'valido') as l,
           sum(ev.m) filter (where ev.estado = 'valido') as m,
           count(*) filter (where ev.estado = 'retroceso') as d_ret,
           count(*) filter (where ev.estado = 'sin_avance') as d_sin,
           count(*) filter (where ev.estado = 'fuera_de_rango') as d_ran
      from ev
     group by ev.cid
  ), per as (
    -- Cargas con fecha en el período.
    select c.cid, count(*) as n, sum(c.litros) as l, sum(c.monto) as m,
           count(*) filter (where c.borde) as llenas
      from cargas c
     where c.fecha >= p_desde
     group by c.cid
  )
  select ca.id, ca.patente, ca.activa,
         coalesce(per.n, 0)::integer, round(coalesce(per.l, 0), 3), round(coalesce(per.m, 0), 2),
         round(per.m / nullif(per.l, 0), 2), coalesce(per.llenas, 0)::integer,
         coalesce(tr.n, 0)::integer, tr.km, round(tr.l, 3), round(tr.m, 2),
         round(tr.km / nullif(tr.l, 0), 3), round(tr.l * 100 / nullif(tr.km, 0), 2), round(tr.m / nullif(tr.km, 0), 2),
         coalesce(tr.d_ret, 0)::integer, coalesce(tr.d_sin, 0)::integer, coalesce(tr.d_ran, 0)::integer
    from public.camiones ca
    left join per on per.cid = ca.id
    left join tr on tr.cid = ca.id
   where ca.transportista_id = v_tid
     and (p_camion_id is null or ca.id = p_camion_id)
     and (per.cid is not null or tr.cid is not null)
   order by ca.activa desc, ca.patente;
end;
$$;

comment on function public.resumen_combustible(date, date, uuid) is
  'Resumen: combustible y rendimiento por camión (lleno a lleno) del período (hasta 366 días, p_hasta inclusivo; p_camion_id opcional, uno ajeno da 0 filas). Bordes = tanque lleno con odómetro; descartes por retroceso, sin avance y fuera de 0,5 a 15 km/L; el tramo cuenta en el período de la carga que lo cierra. SECURITY INVOKER. Ver el encabezado de 014.';

-- ---------------------------------------------------------------------
-- 4) resumen_viajes
-- ---------------------------------------------------------------------
create function public.resumen_viajes(p_desde date, p_hasta date)
returns table (viaje_id uuid, fecha date, origen text, destino text, camion_id uuid, patente text, km numeric,
               ingreso numeric, gastos_cantidad integer, gastos_monto numeric, ganancia numeric, total_viajes integer)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tid uuid;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Período inválido: hacen falta desde y hasta, con desde <= hasta' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 62 then
    raise exception 'Período inválido: la lista de viajes admite hasta 62 días' using errcode = '22023';
  end if;

  return query
  select v.id, v.fecha, v.origen, v.destino, v.camion_id, ca.patente,
         coalesce(v.km_recorridos, v.km_final - v.km_inicial),
         v.ingreso,
         coalesce(gv.n, 0)::integer, round(coalesce(gv.m, 0), 2),
         round(v.ingreso - coalesce(gv.m, 0), 2),
         (count(*) over ())::integer
    from public.viajes v
    left join public.camiones ca on ca.transportista_id = v.transportista_id and ca.id = v.camion_id
    left join lateral (
      -- Todos los gastos vinculados al viaje, sea cual sea su fecha.
      select count(*) as n, sum(g.monto) as m
        from public.gastos g
       where g.transportista_id = v_tid and g.viaje_id = v.id
    ) gv on true
   where v.transportista_id = v_tid and v.fecha between p_desde and p_hasta
   order by v.fecha desc, v.created_at desc, v.id
   limit 500;
end;
$$;

comment on function public.resumen_viajes(date, date) is
  'Resumen: viajes del período (fecha del viaje, hasta 62 días, p_hasta inclusivo), del más nuevo al más viejo, como máximo 500, con ganancia = ingreso - todos los gastos vinculados (NULL sin ingreso) y total_viajes para saber si la lista se cortó. SECURITY INVOKER. Ver el encabezado de 014.';

-- ---------------------------------------------------------------------
-- Permisos: solo authenticated.
-- ---------------------------------------------------------------------
revoke execute on function public.resumen_gastos(date, date) from public, anon, authenticated;
revoke execute on function public.resumen_mensual(date, integer) from public, anon, authenticated;
revoke execute on function public.resumen_combustible(date, date, uuid) from public, anon, authenticated;
revoke execute on function public.resumen_viajes(date, date) from public, anon, authenticated;

grant execute on function public.resumen_gastos(date, date) to authenticated;
grant execute on function public.resumen_mensual(date, integer) to authenticated;
grant execute on function public.resumen_combustible(date, date, uuid) to authenticated;
grant execute on function public.resumen_viajes(date, date) to authenticated;
