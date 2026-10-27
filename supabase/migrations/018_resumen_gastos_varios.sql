-- =====================================================================
-- 018_resumen_gastos_varios.sql — Elan (Resumen, vista Mes: detalle de "Gastos varios")
-- =====================================================================
-- Qué hace: crea UNA función de SOLO LECTURA, public.resumen_gastos_varios(
-- p_desde, p_hasta), que devuelve los gastos de la categoría global "Gastos
-- varios" del período con su descripción, para que la pantalla Resumen muestre
-- de qué se trata cada uno. No crea tablas, columnas ni índices, no cambia
-- ningún dato y NO modifica resumen_gastos (014/015), que sigue devolviendo solo
-- agregados.
--
-- Por qué una función aparte: "Gastos varios" es la categoría donde la
-- descripción es obligatoria y lo que más ganas da de ver. Se acota en la base
-- (hasta 30 filas, descripción de hasta 80 caracteres) para que la respuesta
-- sea chica y predecible aunque un mes tenga cientos de gastos o descripciones
-- de 2.000 caracteres (el tope de la columna).
--
-- Orden de aplicación: 18. Requiere 001 a 003 y 005 a 017 (en rigor, la 001, la
-- 002 y la 003: usa gastos, categorias_gasto y get_mi_transportista_id). El
-- test de aislamiento completo (sección 26 incluida) asume 001 a 003 y 005 a 018.
-- Despliegue: aditiva. El front publicado no la usa; la 018 va ANTES del front
-- que la llama (sin ella, la llamada fallaría con PGRST202).
-- Después de aplicar: regenerar src/lib/database.types.ts (la RPC nueva).
--
-- ---------------------------------------------------------------------
-- resumen_gastos_varios(p_desde date, p_hasta date)  — rango de hasta 366 días
-- ---------------------------------------------------------------------
-- Devuelve filas (gasto_id, fecha, descripcion, descripcion_truncada, monto,
-- total_cantidad):
--   * Gastos de la cuenta (transportista_id = get_mi_transportista_id()) con
--     fecha (del gasto) entre p_desde y p_hasta, p_hasta INCLUIDO, cuya
--     categoría es la GLOBAL "Gastos varios": transportista_id NULL y nombre
--     'Gastos varios' sin distinguir mayúsculas (mismo criterio que el front y
--     que la semilla de la 001). Una categoría PROPIA con ese nombre no cuenta.
--   * Orden: fecha desc, monto desc, id. Como máximo 30 filas (c_max_filas).
--   * descripcion = el texto sin espacios, tabulaciones ni saltos de línea en
--     los bordes, cortado a 80 caracteres (c_max_descripcion). Si queda vacío
--     o es NULL, devuelve NULL (el front muestra "Sin descripción").
--   * descripcion_truncada = true si el texto limpio tenía más de 80 caracteres.
--   * monto = el del gasto, redondeado a 2 decimales.
--   * total_cantidad = cuántos gastos varios hay en el período (TODOS, no solo
--     los devueltos), igual en todas las filas: si es mayor que las filas
--     recibidas, el front muestra "y N más".
--   * Sin gastos varios en el período: 0 filas.
--
-- ---------------------------------------------------------------------
-- Reglas comunes (como en la 014 y la 015)
-- ---------------------------------------------------------------------
-- * language plpgsql STABLE SECURITY INVOKER, search_path fijo y
--   "#variable_conflict use_column": RLS sigue filtrando como en un SELECT
--   directo, y además la consulta lleva el filtro explícito
--   transportista_id = get_mi_transportista_id() (defensa en profundidad).
-- * EXECUTE revocado a public, anon y authenticated, y otorgado solo a
--   authenticated.
-- * Las fechas las manda siempre el front (en hora local): la función nunca usa
--   current_date. Rango inclusivo en los dos extremos.
-- * Errores (SQLSTATE en error.code):
--     42501  sin cuenta (el usuario no pertenece a ningún transportista), o sin
--            EXECUTE (anon).
--     22023  parámetros inválidos, con los mismos textos fijos de la 014:
--            "Período inválido: hacen falta desde y hasta, con desde <= hasta"
--            (también con una fecha infinita, como corrigió la 015)
--            "Período inválido: no puede superar 366 días"
--
-- ---------------------------------------------------------------------
-- Locks, datos y reversibilidad
-- ---------------------------------------------------------------------
-- * CREATE FUNCTION no toma locks sobre las tablas. La función es STABLE y solo
--   lee: no escribe nada (lo controla la sección 26 del test).
-- * Usa el índice gastos (transportista_id, fecha) de la 001.
-- * Aditiva y reversible a mano, en una transacción:
--     drop function if exists public.resumen_gastos_varios(date, date);
--   (y volver al front anterior, si ya la usaba).
-- =====================================================================

set local lock_timeout = '5s';

create function public.resumen_gastos_varios(p_desde date, p_hasta date)
returns table (gasto_id uuid, fecha date, descripcion text, descripcion_truncada boolean,
               monto numeric, total_cantidad integer)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tid uuid;
  -- Topes de la respuesta: filas devueltas y largo de la descripción.
  c_max_filas constant integer := 30;
  c_max_descripcion constant integer := 80;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or not isfinite(p_desde) or not isfinite(p_hasta) or p_hasta < p_desde then
    raise exception 'Período inválido: hacen falta desde y hasta, con desde <= hasta' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'Período inválido: no puede superar 366 días' using errcode = '22023';
  end if;

  return query
  with g as (
    select g.id, g.fecha, g.monto,
           -- Texto limpio; vacío o solo espacios cuenta como sin descripción (NULL).
           nullif(btrim(g.descripcion, E' \t\r\n'), '') as texto
      from public.gastos g
      join public.categorias_gasto c on c.id = g.categoria_id
     where g.transportista_id = v_tid
       and g.fecha between p_desde and p_hasta
       and c.transportista_id is null
       and lower(c.nombre) = 'gastos varios'
  )
  select g.id, g.fecha,
         left(g.texto, c_max_descripcion),
         coalesce(char_length(g.texto) > c_max_descripcion, false),
         round(g.monto, 2),
         (count(*) over ())::integer
    from g
   order by g.fecha desc, g.monto desc, g.id
   limit c_max_filas;
end;
$$;

comment on function public.resumen_gastos_varios(date, date) is
  'Resumen: gastos de la categoría global "Gastos varios" del período (fecha del gasto, p_hasta inclusivo, hasta 366 días) en filas (gasto_id, fecha, descripcion, descripcion_truncada, monto, total_cantidad): fecha desc, monto desc, id; como máximo 30 filas; descripcion recortada a 80 caracteres (NULL si está vacía); total_cantidad = todos los gastos varios del período (igual en todas las filas). SECURITY INVOKER. Ver el encabezado de 018.';

-- ---------------------------------------------------------------------
-- Permisos: solo authenticated.
-- ---------------------------------------------------------------------
revoke execute on function public.resumen_gastos_varios(date, date) from public, anon, authenticated;
grant execute on function public.resumen_gastos_varios(date, date) to authenticated;
