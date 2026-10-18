-- =====================================================================
-- 015_resumen_mensual_fechas_finitas.sql — Elan (endurecimiento: hallazgo de la auditoría de la 014)
-- =====================================================================
-- Qué hace: reemplaza el cuerpo de public.resumen_mensual(date, integer) (014)
-- para que rechace un p_mes_desde infinito ('infinity' o '-infinity') con el
-- mismo 22023 y el mismo texto fijo que ya daba para un mes NULL. Misma
-- función, misma firma, mismas columnas y mismos atributos: el cuerpo nuevo
-- difiere del de la 014 SOLO en la condición de la validación inicial, que
-- suma "or not isfinite(p_mes_desde)". Para cualquier fecha finita el
-- resultado es idéntico al de la 014.
--
-- Por qué (hallazgo): con p_mes_desde infinito, date_trunc da infinito y
-- generate_series(v_desde, v_hasta, interval '1 month') no termina nunca
-- (infinito + 1 mes = infinito). Reproducción, con la sesión de cualquier
-- cuenta:
--     select * from public.resumen_mensual('infinity', 1);
--     select * from public.resumen_mensual('-infinity', 1);
-- La llamada queda colgada hasta el statement_timeout del rol (8 s en
-- authenticated) ocupando una conexión y memoria. Cualquier usuario con sesión
-- puede dispararla por POST /rest/v1/rpc/resumen_mensual, y unas pocas en
-- paralelo agotan el pool de conexiones de todas las cuentas (denegación de
-- servicio). No expone datos. Las otras tres funciones no cuelgan: con fechas
-- infinitas fallan enseguida al restar p_hasta - p_desde (22008) o por
-- desde > hasta (22023); la sección 23 del test de aislamiento documenta ese
-- comportamiento y no se cambia acá.
--
-- Por qué una migración nueva y no editar la 014: la 014 ya está aplicada en
-- la base; el historial de migraciones no se reescribe (repo y base tienen
-- que coincidir archivo por archivo).
--
-- No se acota el año de p_mes_desde: con fechas finitas la serie tiene como
-- máximo 24 meses, y las fechas extremas (antes de Cristo o fuera del rango de
-- timestamp) terminan enseguida, con filas vacías o con 22008. El front
-- siempre manda fechas reales.
--
-- Orden de aplicación: 15. Requiere 014. El test de aislamiento completo (la
-- sección 23 requiere 014 y 015) asume 001 a 003 y 005 a 015.
-- Despliegue: no cambia firma, columnas ni tipos; el front no se toca y no hay
-- que regenerar src/lib/database.types.ts.
--
-- ---------------------------------------------------------------------
-- Locks, permisos y reversibilidad
-- ---------------------------------------------------------------------
-- * CREATE OR REPLACE FUNCTION no toma locks sobre tablas: solo actualiza su
--   fila en pg_proc. Las otras sesiones toman el cuerpo nuevo en su próxima
--   llamada después del COMMIT. El lock_timeout es por consistencia con 010 a
--   014 (cubre un reemplazo simultáneo de la misma función).
-- * Reemplazar conserva el dueño, los privilegios, SECURITY INVOKER, STABLE,
--   el search_path y el comentario. Igual se repiten el comentario
--   (actualizado) y el REVOKE/GRANT de EXECUTE (idempotentes), para que quede
--   explícito: EXECUTE solo para authenticated (anon y public no).
-- * No cambia datos.
-- * Se deshace a mano, en una transacción, volviendo al cuerpo de la 014: el
--   mismo CREATE OR REPLACE de abajo con la condición
--     if p_mes_desde is null or p_meses is null or p_meses < 1 or p_meses > 24 then
--   y el comentario de la 014. Volver atrás reabre el hallazgo.
-- =====================================================================

set local lock_timeout = '5s';

create or replace function public.resumen_mensual(p_mes_desde date, p_meses integer)
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
  if p_mes_desde is null or not isfinite(p_mes_desde) or p_meses is null or p_meses < 1 or p_meses > 24 then
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
  'Resumen: una fila por mes calendario (exactamente p_meses, de 1 a 24, desde el mes de p_mes_desde) con gastos, combustible, viajes, ingreso y resultado (ingresos de los viajes del mes - todos los gastos del mes; NULL si ningún viaje del mes tiene ingreso). p_mes_desde NULL o infinito: 22023 (015). SECURITY INVOKER. Ver el encabezado de 014.';

revoke all on function public.resumen_mensual(date, integer) from public, anon, authenticated;
grant execute on function public.resumen_mensual(date, integer) to authenticated;
