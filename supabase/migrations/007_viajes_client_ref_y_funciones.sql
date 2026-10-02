-- =====================================================================
-- 007_viajes_client_ref_y_funciones.sql — Elan (Bloque C, Etapa 2: Viajes)
-- =====================================================================
-- Qué hace:
--   1. Agrega a public.viajes la columna client_ref (uuid, opcional) con un
--      índice único parcial por tenant y un trigger que la vuelve
--      inmutable. Es el mismo patrón que gastos (006).
--   2. Crea dos funciones SECURITY INVOKER para guardar un viaje junto con
--      sus entregas en UNA transacción:
--        * crear_viaje_con_entregas(...)       idempotente por client_ref.
--        * actualizar_viaje_con_entregas(...)  sincroniza la lista de entregas.
--
-- Orden de aplicación: 7. Requiere 001_schema.sql, 002_functions.sql y
-- 003_rls.sql ya aplicados (usa viajes, entregas, clientes y
-- get_mi_transportista_id()). 004, 005 y 006 no son dependencia, pero el
-- test de aislamiento (secciones 11 a 15) asume 001 a 007 aplicadas.
--
-- ---------------------------------------------------------------------
-- Por qué funciones y por qué SECURITY INVOKER
-- ---------------------------------------------------------------------
-- Guardar un viaje y sus entregas son varios INSERT/UPDATE/DELETE. Con
-- llamadas separadas desde el front, una señal que se corta a mitad de
-- camino deja un viaje sin entregas (o con la mitad). Una función corre
-- dentro de una sola transacción: o queda todo o no queda nada.
--
-- Son SECURITY INVOKER (no definer) a propósito:
-- * Corren con los privilegios del usuario que llama, así que RLS sigue
--   filtrando exactamente igual que en un INSERT/UPDATE directo: la
--   función no puede ver ni tocar filas de otro tenant.
-- * Los triggers de 002 siguen aplicando dentro de la función:
--   fn_forzar_transportista_id pisa transportista_id e id en cada INSERT
--   (la función ni siquiera los manda) y fn_bloquear_cambio_
--   transportista_id sigue protegiendo los UPDATE.
-- * Como no son SECURITY DEFINER, no entran en los avisos 0028/0029 de los
--   advisors de Supabase (aplican solo a SECURITY DEFINER ejecutable por
--   anon/authenticated). Con search_path fijo tampoco aplica 0011.
-- * Además de confiar en RLS, cada consulta lleva el filtro explícito
--   transportista_id = tenant del usuario (defensa en profundidad). Si
--   alguien las ejecutara con un rol que saltea RLS (service_role), sin
--   sesión de usuario get_mi_transportista_id() devuelve NULL y la función
--   se detiene con 42501 antes de tocar nada.
-- * EXECUTE: se revoca a public, anon y authenticated (Supabase da EXECUTE
--   por default privileges a anon/authenticated, ver 002) y se concede solo
--   a authenticated. service_role y postgres conservan el default, pero la
--   guarda de tenant de arriba los frena sin sesión de usuario.
--
-- ---------------------------------------------------------------------
-- Firmas: parámetros tipados para el viaje + jsonb solo para las entregas
-- ---------------------------------------------------------------------
-- * Los campos del viaje van como parámetros tipados (uuid, date, numeric,
--   text). Pros: los tipos de PostgREST y de supabase-js (gen types)
--   quedan tipados; un nombre mal escrito falla fuerte (PGRST202) en vez
--   de ignorarse en silencio; los valores pasan por los mismos checks de la
--   tabla. Contra: cada columna nueva de viajes obliga a una migración que
--   recree la función.
-- * Las entregas van como una lista jsonb porque son una cantidad variable
--   de registros. Las alternativas (arrays de un tipo compuesto, o arrays
--   paralelos de uuid/text) son más frágiles con PostgREST y no pueden
--   expresar "entrega existente (con id) o nueva (sin id)".
-- * En actualizar_viaje_con_entregas los campos del viaje NO tienen
--   default: el front manda todos, con null explícito para vaciar un campo.
--   Así un olvido del front falla con PGRST202 en vez de borrar datos sin
--   avisar. En crear los opcionales sí tienen default null (no hay nada que
--   pisar).
--
-- Formato de p_entregas: lista de objetos, en el orden en que se cargaron.
--   [] = sin entregas.
--   [ { "id": "<uuid>", "cliente_id": "<uuid>", "incidencias": "texto" }, ... ]
-- * cliente_id: obligatorio, un cliente del propio transportista.
-- * incidencias: opcional (string o null). Se recorta con btrim y '' queda
--   como NULL. Máximo 2000 caracteres (entregas_incidencias_chk).
-- * id: solo se usa en actualizar_viaje_con_entregas y solo para entregas
--   que YA existen en ese viaje. Sin id (o null) = entrega nueva. En
--   crear_viaje_con_entregas se ignora.
-- * Cualquier otra clave (transportista_id, viaje_id, created_at...) se
--   ignora: el cliente nunca decide el tenant ni el id de una fila nueva.
-- * Máximo 100 entregas por viaje (constante c_max_entregas en las dos
--   funciones). Es un límite de sensatez del payload, no un límite de
--   seguridad: la tabla no lo impone. Subirlo = recrear las funciones.
-- * La base no tiene columna de orden. Las entregas nuevas se insertan con
--   created_at escalonado (1 ms entre una y otra) para conservar el orden de
--   la lista; el front las lista por (created_at, id). Reordenar entregas
--   ya existentes no está soportado (haría falta una columna orden).
--
-- ---------------------------------------------------------------------
-- crear_viaje_con_entregas: contrato
-- ---------------------------------------------------------------------
-- Devuelve una fila (viaje_id uuid, creado boolean).
-- * creado = true: se creó el viaje y todas sus entregas.
-- * creado = false: ya existía un viaje con ese client_ref en el propio
--   tenant (reintento después de una respuesta perdida, o carrera entre dos
--   llamadas). Se devuelve el id existente y NO se reaplica nada: ni se
--   validan los datos recibidos, ni se modifica el viaje, ni se tocan sus
--   entregas. Si el usuario cambió datos entre intentos, el front llama a
--   actualizar_viaje_con_entregas con ese viaje_id (mismo flujo que gastos:
--   "guardado" + UPDATE con lo que está en pantalla).
-- * p_client_ref es obligatorio. El front lo genera al abrir el formulario,
--   lo mantiene en cada "Reintentar" y lo regenera tras guardar bien. Con
--   un client_ref reusado para otro viaje la función devolvería el viaje
--   viejo con creado = false: por eso hay que regenerarlo.
-- * Sin oráculo de existencia: el client_ref solo se busca dentro del
--   propio tenant. Mandar un client_ref que usó otro tenant simplemente
--   crea el viaje (creado = true), indistinguible de cualquier otro caso.
--
-- actualizar_viaje_con_entregas: contrato (reemplazo completo)
-- * Devuelve void. Reemplaza los campos del viaje por los recibidos y deja
--   la lista de entregas EXACTAMENTE como viene en p_entregas:
--     - entrega con id (existente en este viaje)  -> UPDATE de cliente_id e
--       incidencias (solo si cambió algo).
--     - entrega sin id                            -> INSERT.
--     - entrega existente que no viene en la lista -> DELETE.
--   p_entregas = [] borra todas las entregas del viaje. p_entregas es
--   obligatorio (null o algo que no sea una lista es un error 22023).
-- * client_ref no se puede cambiar (no es parámetro y el trigger lo
--   bloquea igual).
-- * Si un id de la lista no es una entrega de ESTE viaje del propio tenant
--   (no existe, es de otro viaje o es de otro tenant) la función falla con
--   P0002 y no cambia nada: no se mueven entregas entre viajes y el mensaje
--   no distingue "no existe" de "es de otro tenant".
-- * Concurrencia: el primer UPDATE toma el lock de la fila del viaje, así
--   que dos guardados simultáneos del mismo viaje se serializan; el segundo
--   valida contra el estado ya commiteado. Gana el último en guardar: si
--   otra pestaña agregó una entrega y esta no la incluye, se borra.
--
-- ---------------------------------------------------------------------
-- Errores que el front debe mapear (SQLSTATE -> significado)
-- ---------------------------------------------------------------------
--   42501  Sin sesión o sin transportista (mensaje "No perteneces...").
--   22023  Parámetros inválidos: client_ref, viaje_id o fecha faltantes;
--          p_entregas que no es una lista, con más de 100 elementos,
--          elementos mal formados, ids repetidos.
--   23503  Referencia inválida: algún cliente_id (o el camion_id) no existe o
--          no es del transportista. Mismo error para "no existe" y "es de
--          otro tenant". Cliente: mensaje "Alguno de los clientes no es
--          válido..."; camión: FK viajes_camion_fk.
--   P0002  (solo actualizar) El viaje, o alguna entrega con id, no se
--          encontró. El front refresca los datos.
--   23502  origen o destino nulos (NOT NULL de la tabla).
--   23514  Checks de las tablas (el mensaje trae el nombre del constraint):
--          viajes_origen_chk / viajes_destino_chk (vacío o > 200),
--          viajes_observaciones_chk (> 2000), viajes_ingreso_chk (< 0),
--          viajes_km_inicial_chk / viajes_km_final_chk /
--          viajes_km_recorridos_chk (< 0), viajes_chk_modo_km (mezcla de
--          km_recorridos con inicial/final), viajes_chk_km_coherentes (final
--          sin inicial o menor que el inicial), entregas_incidencias_chk
--          (> 2000).
--   22003  Número fuera de rango (km o ingreso demasiado grandes).
-- 23505 no se devuelve nunca desde crear_viaje_con_entregas: el client_ref
-- repetido se resuelve devolviendo creado = false.
--
-- ---------------------------------------------------------------------
-- Claves foráneas y ON DELETE dentro de las funciones
-- ---------------------------------------------------------------------
-- * Las FK de 001 son compuestas (transportista_id, x_id) y se validan al
--   final de cada sentencia. Las entregas se insertan DESPUÉS del viaje en
--   la misma transacción, así que la FK entregas_viaje_fk ya ve el viaje.
-- * transportista_id lo fija el trigger antes del chequeo de las FK: aunque
--   la validación explícita de clientes fallara, la FK compuesta impide
--   enganchar un cliente o un camión de otro tenant.
-- * Estas funciones no borran viajes. Borrar un viaje (DELETE directo)
--   borra en cascada sus entregas y sus devoluciones (ON DELETE CASCADE), y
--   se rechaza si tiene gastos vinculados (gastos_viaje_fk RESTRICT: el
--   SQLSTATE es 23503, el mismo que una referencia inválida; el front tiene
--   que distinguirlo por el contexto del borrado y no solo por el código).
-- * entregas_cliente_fk es ON DELETE RESTRICT: un cliente con entregas no se
--   puede borrar. El DELETE de entregas de la sincronización lo libera.
--
-- * Después de aplicar: regenerar src/lib/database.types.ts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) viajes.client_ref: clave de idempotencia por tenant, inmutable
-- ---------------------------------------------------------------------

alter table public.viajes
  add column client_ref uuid null;

-- Único por tenant. Parcial: las filas sin client_ref (las existentes, y
-- cualquiera cargada sin él) no compiten por el índice.
create unique index viajes_transportista_client_ref_uidx
  on public.viajes (transportista_id, client_ref)
  where client_ref is not null;

comment on column public.viajes.client_ref is
  'Clave de idempotencia generada por el front (un uuid al abrir el formulario; se mantiene en cada reintento y se regenera tras guardar bien). Única por tenant e inmutable. Se usa vía crear_viaje_con_entregas(), que devuelve el viaje existente (creado = false) si el client_ref ya estaba; un INSERT directo con client_ref repetido falla con 23505 (constraint viajes_transportista_client_ref_uidx). El índice es parcial, por eso no sirve para upsert de PostgREST. No hay oráculo de existencia entre tenants.';

-- Función propia para viajes (no se generaliza fn_bloquear_cambio_client_ref
-- de 006: ya está aplicada, y su mensaje nombra a los gastos).
create function public.fn_bloquear_cambio_client_ref_viaje()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.client_ref is distinct from old.client_ref then
    raise exception 'No se puede cambiar el client_ref de un viaje existente'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_bloquear_cambio_client_ref_viaje() from public, anon, authenticated;

-- Orden de disparo de los BEFORE UPDATE de viajes (por nombre):
-- trg_20_bloquear_cambio_transportista_id -> trg_25_bloquear_cambio_client_ref
-- -> trg_30_set_updated_at.
create trigger trg_25_bloquear_cambio_client_ref
  before update on public.viajes
  for each row execute function public.fn_bloquear_cambio_client_ref_viaje();

-- ---------------------------------------------------------------------
-- 2) crear_viaje_con_entregas
-- ---------------------------------------------------------------------

create function public.crear_viaje_con_entregas(
  p_client_ref uuid,
  p_fecha date,
  p_origen text,
  p_destino text,
  p_camion_id uuid default null,
  p_km_inicial numeric default null,
  p_km_final numeric default null,
  p_km_recorridos numeric default null,
  p_observaciones text default null,
  p_ingreso numeric default null,
  p_entregas jsonb default '[]'::jsonb
)
returns table (viaje_id uuid, creado boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  c_max_entregas constant integer := 100;
  v_tid uuid;
  v_viaje_id uuid;
  v_ahora timestamptz;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista: no se puede crear el viaje'
      using errcode = '42501';
  end if;

  if p_client_ref is null then
    raise exception 'Falta el client_ref del viaje' using errcode = '22023';
  end if;

  -- Reintento: si el client_ref ya existe en el propio tenant, se devuelve
  -- ese viaje sin validar ni reaplicar nada.
  select v.id into v_viaje_id
    from public.viajes v
   where v.transportista_id = v_tid and v.client_ref = p_client_ref;
  if found then
    return query select v_viaje_id, false;
    return;
  end if;

  if p_fecha is null then
    raise exception 'Falta la fecha del viaje' using errcode = '22023';
  end if;

  if p_entregas is null or jsonb_typeof(p_entregas) <> 'array' then
    raise exception 'Las entregas deben enviarse como una lista (puede estar vacía)'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_entregas) > c_max_entregas then
    raise exception 'Un viaje admite como máximo % entregas', c_max_entregas
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_entregas) as t(elem)
     where jsonb_typeof(t.elem) <> 'object'
        or coalesce(t.elem->>'cliente_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(jsonb_typeof(t.elem->'incidencias'), 'null') not in ('string', 'null')
  ) then
    raise exception 'Cada entrega debe ser un objeto con un cliente_id válido e incidencias de texto'
      using errcode = '22023';
  end if;

  -- Mismo mensaje (y mismo código) para un cliente que no existe y para uno
  -- de otro tenant: no sirve de oráculo de existencia.
  if exists (
    select 1
      from jsonb_array_elements(p_entregas) as t(elem)
     where not exists (
       select 1 from public.clientes c
        where c.transportista_id = v_tid and c.id = (t.elem->>'cliente_id')::uuid
     )
  ) then
    raise exception 'Alguno de los clientes no es válido para este transportista'
      using errcode = '23503';
  end if;

  -- transportista_id e id los completa el trigger fn_forzar_transportista_id.
  -- ON CONFLICT cubre la carrera entre dos llamadas simultáneas con el mismo
  -- client_ref (acá sí se puede indicar el predicado del índice parcial).
  insert into public.viajes
    (client_ref, fecha, origen, destino, camion_id, km_inicial, km_final,
     km_recorridos, observaciones, ingreso)
  values
    (p_client_ref, p_fecha, p_origen, p_destino, p_camion_id, p_km_inicial,
     p_km_final, p_km_recorridos, p_observaciones, p_ingreso)
  on conflict (transportista_id, client_ref) where client_ref is not null do nothing
  returning id into v_viaje_id;

  if not found then
    select v.id into v_viaje_id
      from public.viajes v
     where v.transportista_id = v_tid and v.client_ref = p_client_ref;
    return query select v_viaje_id, false;
    return;
  end if;

  v_ahora := clock_timestamp();
  insert into public.entregas (viaje_id, cliente_id, incidencias, created_at)
  select v_viaje_id,
         (t.elem->>'cliente_id')::uuid,
         nullif(btrim(t.elem->>'incidencias'), ''),
         v_ahora + t.ord * interval '1 millisecond'
    from jsonb_array_elements(p_entregas) with ordinality as t(elem, ord);

  return query select v_viaje_id, true;
end;
$$;

comment on function public.crear_viaje_con_entregas(uuid, date, text, text, uuid, numeric, numeric, numeric, text, numeric, jsonb) is
  'Crea un viaje y sus entregas en una sola transacción (SECURITY INVOKER: RLS filtra como en un INSERT directo). Idempotente por p_client_ref: si ya existe en el propio tenant devuelve (viaje_id existente, creado = false) sin reaplicar datos. p_entregas = lista jsonb de {cliente_id, incidencias}. Errores: ver el encabezado de 007.';

revoke execute on function public.crear_viaje_con_entregas(uuid, date, text, text, uuid, numeric, numeric, numeric, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.crear_viaje_con_entregas(uuid, date, text, text, uuid, numeric, numeric, numeric, text, numeric, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------
-- 3) actualizar_viaje_con_entregas
-- ---------------------------------------------------------------------

create function public.actualizar_viaje_con_entregas(
  p_viaje_id uuid,
  p_fecha date,
  p_origen text,
  p_destino text,
  p_camion_id uuid,
  p_km_inicial numeric,
  p_km_final numeric,
  p_km_recorridos numeric,
  p_observaciones text,
  p_ingreso numeric,
  p_entregas jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  c_max_entregas constant integer := 100;
  v_tid uuid;
  v_viaje_id uuid;
  v_ids uuid[];
  v_n integer;
  v_ahora timestamptz;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista: no se puede actualizar el viaje'
      using errcode = '42501';
  end if;

  if p_viaje_id is null then
    raise exception 'Falta el id del viaje' using errcode = '22023';
  end if;
  if p_fecha is null then
    raise exception 'Falta la fecha del viaje' using errcode = '22023';
  end if;

  if p_entregas is null or jsonb_typeof(p_entregas) <> 'array' then
    raise exception 'Las entregas deben enviarse como una lista (puede estar vacía)'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_entregas) > c_max_entregas then
    raise exception 'Un viaje admite como máximo % entregas', c_max_entregas
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_entregas) as t(elem)
     where jsonb_typeof(t.elem) <> 'object'
        or coalesce(t.elem->>'cliente_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(jsonb_typeof(t.elem->'incidencias'), 'null') not in ('string', 'null')
        or (coalesce(jsonb_typeof(t.elem->'id'), 'null') <> 'null'
            and coalesce(case when jsonb_typeof(t.elem->'id') = 'string' then t.elem->>'id' end, '')
                !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  ) then
    raise exception 'Cada entrega debe ser un objeto con un cliente_id válido, incidencias de texto y, si ya existe, su id'
      using errcode = '22023';
  end if;

  v_ids := array(
    select (t.elem->>'id')::uuid
      from jsonb_array_elements(p_entregas) as t(elem)
     where jsonb_typeof(t.elem->'id') = 'string'
  );
  if (select count(distinct x) from unnest(v_ids) as x) <> cardinality(v_ids) then
    raise exception 'La lista de entregas repite una entrega' using errcode = '22023';
  end if;

  -- Mismo mensaje (y mismo código) para un cliente que no existe y para uno
  -- de otro tenant.
  if exists (
    select 1
      from jsonb_array_elements(p_entregas) as t(elem)
     where not exists (
       select 1 from public.clientes c
        where c.transportista_id = v_tid and c.id = (t.elem->>'cliente_id')::uuid
     )
  ) then
    raise exception 'Alguno de los clientes no es válido para este transportista'
      using errcode = '23503';
  end if;

  -- El UPDATE del viaje toma el lock de la fila: serializa guardados
  -- simultáneos del mismo viaje. Un viaje inexistente y uno de otro tenant
  -- dan el mismo error (RLS + filtro explícito: no se ve ni se toca).
  update public.viajes v
     set fecha = p_fecha,
         origen = p_origen,
         destino = p_destino,
         camion_id = p_camion_id,
         km_inicial = p_km_inicial,
         km_final = p_km_final,
         km_recorridos = p_km_recorridos,
         observaciones = p_observaciones,
         ingreso = p_ingreso
   where v.id = p_viaje_id and v.transportista_id = v_tid
  returning v.id into v_viaje_id;
  if not found then
    raise exception 'No se encontró el viaje' using errcode = 'P0002';
  end if;

  -- Cada id de la lista tiene que ser una entrega de ESTE viaje.
  select count(*) into v_n
    from public.entregas e
   where e.transportista_id = v_tid
     and e.viaje_id = v_viaje_id
     and e.id = any (v_ids);
  if v_n <> cardinality(v_ids) then
    raise exception 'No se encontró alguna de las entregas de este viaje'
      using errcode = 'P0002';
  end if;

  -- Las entregas existentes que no vienen en la lista se borran.
  delete from public.entregas e
   where e.transportista_id = v_tid
     and e.viaje_id = v_viaje_id
     and not (e.id = any (v_ids));

  -- Las que vienen con id se actualizan (solo si cambió algo, para no tocar
  -- updated_at en vano).
  update public.entregas e
     set cliente_id = x.cliente_id,
         incidencias = x.incidencias
    from (
      select (t.elem->>'id')::uuid as id,
             (t.elem->>'cliente_id')::uuid as cliente_id,
             nullif(btrim(t.elem->>'incidencias'), '') as incidencias
        from jsonb_array_elements(p_entregas) as t(elem)
       where jsonb_typeof(t.elem->'id') = 'string'
    ) x
   where e.id = x.id
     and e.transportista_id = v_tid
     and e.viaje_id = v_viaje_id
     and (e.cliente_id is distinct from x.cliente_id
          or e.incidencias is distinct from x.incidencias);

  -- Las que vienen sin id son nuevas (transportista_id e id: trigger).
  v_ahora := clock_timestamp();
  insert into public.entregas (viaje_id, cliente_id, incidencias, created_at)
  select v_viaje_id,
         (t.elem->>'cliente_id')::uuid,
         nullif(btrim(t.elem->>'incidencias'), ''),
         v_ahora + t.ord * interval '1 millisecond'
    from jsonb_array_elements(p_entregas) with ordinality as t(elem, ord)
   where jsonb_typeof(t.elem->'id') is distinct from 'string';
end;
$$;

comment on function public.actualizar_viaje_con_entregas(uuid, date, text, text, uuid, numeric, numeric, numeric, text, numeric, jsonb) is
  'Reemplaza los datos de un viaje y sincroniza sus entregas en una sola transacción (SECURITY INVOKER: RLS filtra como en un UPDATE directo). Entrega con id = se actualiza; sin id = se inserta; existente que no viene = se borra. Todos los campos son obligatorios (null explícito para vaciar). Errores: ver el encabezado de 007.';

revoke execute on function public.actualizar_viaje_con_entregas(uuid, date, text, text, uuid, numeric, numeric, numeric, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.actualizar_viaje_con_entregas(uuid, date, text, text, uuid, numeric, numeric, numeric, text, numeric, jsonb)
  to authenticated;
