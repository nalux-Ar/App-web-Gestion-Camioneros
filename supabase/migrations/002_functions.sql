-- =====================================================================
-- 002_functions.sql — Elan (Bloque A: helpers, triggers y onboarding)
-- =====================================================================
-- Qué hace: crea la función helper get_mi_transportista_id(), las
-- funciones/triggers que blindan transportista_id y categoria_id contra
-- manipulación cruzada entre tenants, el trigger anti auto-promoción de
-- miembros.rol, las funciones de onboarding (create_transportista) y
-- cambio de rol (cambiar_rol_miembro), y sus GRANT/REVOKE de EXECUTE.
--
-- Orden de aplicación: 2 de 3. Requiere 001_schema.sql ya aplicado.
-- Correr ANTES de 003_rls.sql (las policies usan get_mi_transportista_id()).
--
-- Todas las funciones SECURITY DEFINER fijan search_path = public (evita
-- search_path hijacking) y arrancan con EXECUTE revocado de PUBLIC, anon
-- Y authenticated explícitamente: Supabase le da EXECUTE por default a
-- anon/authenticated (default privileges), no a PUBLIC, así que un
-- "revoke ... from public" solo no alcanza para sacárselo — hay que
-- nombrar los tres roles. Después se otorga EXECUTE explícito solo a
-- los roles que corresponde en cada caso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: transportista_id del usuario logueado (para usar en policies)
-- ---------------------------------------------------------------------

create function public.get_mi_transportista_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select transportista_id from public.miembros where user_id = auth.uid() limit 1
$$;

comment on function public.get_mi_transportista_id() is
  'Devuelve el transportista_id del usuario autenticado actual, o NULL si no pertenece a ninguno.';

revoke execute on function public.get_mi_transportista_id() from public, anon, authenticated;
grant execute on function public.get_mi_transportista_id() to authenticated;

-- ---------------------------------------------------------------------
-- Trigger genérico: mantiene updated_at
-- ---------------------------------------------------------------------

create function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.fn_set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Trigger genérico: fuerza transportista_id (y el id) en INSERT
-- (BEFORE INSERT)
-- ---------------------------------------------------------------------
-- Decisión: el cliente NUNCA envía transportista_id, pero si lo manda
-- (con su propio valor o con el de otro tenant), este trigger lo PISA
-- silenciosamente por el valor real del usuario logueado, en vez de
-- rechazar el INSERT. Es más seguro (nunca hay forma de que un INSERT
-- "cuele" en el tenant equivocado, pase lo que pase en el body del
-- request) y más tolerante a datos desactualizados del front.
-- Si el usuario no pertenece a ningún tenant, get_mi_transportista_id()
-- devuelve NULL y el INSERT falla por la constraint NOT NULL de
-- transportista_id (no hace falta chequearlo acá explícitamente, pero
-- lo hacemos para dar un mensaje de error más claro).
--
-- También se pisa new.id (gen_random_uuid()): si no lo hiciéramos, un
-- cliente podría usar el INSERT como "oráculo de existencia" — mandar
-- como id el id real de una fila de OTRO tenant y ver si el error es
-- duplicate_key (existe) o no (no existe), filtrando información entre
-- tenants sin necesitar SELECT. Consecuencia para el front: NO se puede
-- hacer upsert por id para editar una fila; las ediciones van siempre
-- por UPDATE (el id que vuelve del INSERT puede no ser el que se mandó).
--
-- Contexto de confianza sin JWT — ALLOW-LIST, no deny-list (corregido
-- tras hallazgo de appsec). La primera versión miraba
-- "current_user not in ('authenticated','anon')", pero current_user
-- cambia a postgres (el dueño) DENTRO DE CUALQUIER función SECURITY
-- DEFINER, sin importar quién la haya llamado ni con qué JWT. Con esa
-- lógica, una futura función definer invocada SIN 'sub' en el JWT
-- hubiera colado un INSERT sin forzar transportista_id, porque
-- current_user ahí adentro ya es 'postgres' (que no está en la lista
-- negada).
--
-- Por eso ahora es una allow-list basada en session_user, que NO cambia
-- con SET ROLE ni al entrar a una función SECURITY DEFINER — es la
-- identidad con la que arrancó la conexión física:
--   * session_user in ('postgres', 'supabase_admin') → conexión directa
--     (SQL Editor, migraciones aplicadas a mano o por MCP). PostgREST nunca entra por acá:
--     se conecta como 'authenticator' y hace SET ROLE por request, así
--     que en cualquier request real session_user es 'authenticator', no
--     postgres/supabase_admin, pase lo que pase adentro de cualquier
--     función SECURITY DEFINER que se llame en el camino.
--   * current_user = 'service_role' → job de backend con la service_role
--     key (nunca en el front). Acá sí importa current_user: como
--     service_role no es dueño de ninguna función nuestra, si
--     current_user es 'service_role' es porque el rol activo de la
--     conexión (tras el SET ROLE de PostgREST) es literalmente
--     service_role — no porque estemos "dentro" de una función suya.
-- Cualquier otro caso —incluido "SECURITY DEFINER corriendo como
-- postgres pero invocada desde un request de authenticated/anon sin
-- JWT"— cae al forzado normal: sin tenant, excepción. Fail-closed.
--
-- No se aplica a miembros ni transportistas: esas dos solo se insertan
-- vía create_transportista() (ver más abajo), que ya setea el valor
-- correcto a mano (y en miembros, get_mi_transportista_id() todavía no
-- tendría nada que devolver la primera vez que un usuario se da de alta).
-- ---------------------------------------------------------------------

create function public.fn_forzar_transportista_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tid uuid;
begin
  if auth.uid() is null and (
       session_user in ('postgres', 'supabase_admin')  -- conexión directa: SQL Editor / migraciones
       or current_user = 'service_role'                -- backend con la service_role key (nunca en el front)
     ) then
    return new;
  end if;

  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No pertenecés a ningún transportista: no se puede crear este registro'
      using errcode = '42501';
  end if;
  new.transportista_id := v_tid;
  new.id := gen_random_uuid();
  return new;
end;
$$;

revoke execute on function public.fn_forzar_transportista_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Trigger genérico: bloquea el cambio de transportista_id en UPDATE
-- ---------------------------------------------------------------------

create function public.fn_bloquear_cambio_transportista_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.transportista_id is distinct from old.transportista_id then
    raise exception 'No se puede cambiar el transportista_id de un registro existente'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_bloquear_cambio_transportista_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Trigger específico de gastos: valida que categoria_id sea una
-- categoría global o del mismo tenant que el gasto (gastos.categoria_id
-- no puede resolverse con una FK compuesta clásica porque
-- categorias_gasto.transportista_id admite NULL para las globales).
-- SECURITY DEFINER para que la validación sea autoritativa y no dependa
-- de qué filas deje ver la policy de SELECT de categorias_gasto en cada
-- momento (defensa en profundidad, aunque hoy esa policy ya alcanzaría).
--
-- El mensaje de "no existe" y el de "es de otro tenant" van UNIFICADOS
-- a propósito: si fueran distintos, un cliente podría usar el mensaje de
-- error como oráculo para averiguar si un uuid de categoría existe en
-- otro tenant (aunque no pueda usarla) sin tener SELECT sobre esa fila.
-- ---------------------------------------------------------------------

create function public.fn_validar_categoria_gasto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat_tid uuid;
begin
  select transportista_id into v_cat_tid
    from public.categorias_gasto
    where id = new.categoria_id;

  if not found
     or (v_cat_tid is not null and v_cat_tid <> new.transportista_id) then
    raise exception 'La categoría de gasto no es válida para este transportista'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_validar_categoria_gasto() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Trigger de miembros: bloquea cambios directos a rol/user_id/
-- transportista_id. El único camino habilitado para cambiar el rol es
-- cambiar_rol_miembro() (ver más abajo), que habilita el cambio con un
-- GUC de transacción (set_config(..., is_local => true)) inmediatamente
-- antes del UPDATE y lo apaga apenas termina. Esto es una segunda capa
-- de defensa además de los GRANT por columna de 003 (si algún día se
-- desconfigura un grant, este trigger igual corta el paso).
-- ---------------------------------------------------------------------

create function public.fn_bloquear_cambio_rol_directo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.rol is distinct from old.rol
     and coalesce(current_setting('app.permitir_cambio_rol', true), 'off') <> 'on' then
    raise exception 'El rol solo se puede cambiar mediante cambiar_rol_miembro()'
      using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'No se puede reasignar el user_id de un miembro' using errcode = '42501';
  end if;

  if new.transportista_id is distinct from old.transportista_id then
    raise exception 'No se puede cambiar el transportista_id de un miembro' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_bloquear_cambio_rol_directo() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Triggers: attach a cada tabla
-- ---------------------------------------------------------------------

-- transportistas: solo mantiene updated_at (no lleva transportista_id propio).
create trigger trg_30_set_updated_at
  before update on public.transportistas
  for each row execute function public.fn_set_updated_at();

-- miembros: anti auto-promoción + updated_at (sin trigger de "forzar
-- transportista_id": las filas de miembros solo las crea create_transportista()).
create trigger trg_10_bloquear_cambio_rol
  before update on public.miembros
  for each row execute function public.fn_bloquear_cambio_rol_directo();

create trigger trg_20_set_updated_at
  before update on public.miembros
  for each row execute function public.fn_set_updated_at();

-- camiones
create trigger trg_10_forzar_transportista_id
  before insert on public.camiones
  for each row execute function public.fn_forzar_transportista_id();

create trigger trg_20_bloquear_cambio_transportista_id
  before update on public.camiones
  for each row execute function public.fn_bloquear_cambio_transportista_id();

create trigger trg_30_set_updated_at
  before update on public.camiones
  for each row execute function public.fn_set_updated_at();

-- clientes
create trigger trg_10_forzar_transportista_id
  before insert on public.clientes
  for each row execute function public.fn_forzar_transportista_id();

create trigger trg_20_bloquear_cambio_transportista_id
  before update on public.clientes
  for each row execute function public.fn_bloquear_cambio_transportista_id();

create trigger trg_30_set_updated_at
  before update on public.clientes
  for each row execute function public.fn_set_updated_at();

-- viajes
create trigger trg_10_forzar_transportista_id
  before insert on public.viajes
  for each row execute function public.fn_forzar_transportista_id();

create trigger trg_20_bloquear_cambio_transportista_id
  before update on public.viajes
  for each row execute function public.fn_bloquear_cambio_transportista_id();

create trigger trg_30_set_updated_at
  before update on public.viajes
  for each row execute function public.fn_set_updated_at();

-- entregas
create trigger trg_10_forzar_transportista_id
  before insert on public.entregas
  for each row execute function public.fn_forzar_transportista_id();

create trigger trg_20_bloquear_cambio_transportista_id
  before update on public.entregas
  for each row execute function public.fn_bloquear_cambio_transportista_id();

create trigger trg_30_set_updated_at
  before update on public.entregas
  for each row execute function public.fn_set_updated_at();

-- devoluciones
create trigger trg_10_forzar_transportista_id
  before insert on public.devoluciones
  for each row execute function public.fn_forzar_transportista_id();

create trigger trg_20_bloquear_cambio_transportista_id
  before update on public.devoluciones
  for each row execute function public.fn_bloquear_cambio_transportista_id();

create trigger trg_30_set_updated_at
  before update on public.devoluciones
  for each row execute function public.fn_set_updated_at();

-- categorias_gasto: el mismo trigger de "forzar" también garantiza que
-- ningún INSERT de un usuario autenticado pueda terminar con
-- transportista_id NULL (global): get_mi_transportista_id() nunca
-- devuelve NULL para un miembro válido, así que siempre pisa con un
-- uuid real.
create trigger trg_10_forzar_transportista_id
  before insert on public.categorias_gasto
  for each row execute function public.fn_forzar_transportista_id();

create trigger trg_20_bloquear_cambio_transportista_id
  before update on public.categorias_gasto
  for each row execute function public.fn_bloquear_cambio_transportista_id();

create trigger trg_30_set_updated_at
  before update on public.categorias_gasto
  for each row execute function public.fn_set_updated_at();

-- gastos
create trigger trg_10_forzar_transportista_id
  before insert on public.gastos
  for each row execute function public.fn_forzar_transportista_id();

create trigger trg_15_validar_categoria_gasto
  before insert or update on public.gastos
  for each row execute function public.fn_validar_categoria_gasto();

create trigger trg_20_bloquear_cambio_transportista_id
  before update on public.gastos
  for each row execute function public.fn_bloquear_cambio_transportista_id();

create trigger trg_30_set_updated_at
  before update on public.gastos
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- Onboarding atómico: create_transportista(nombre)
-- ---------------------------------------------------------------------
-- Crea transportistas + miembros (rol admin) en una sola transacción
-- (el cuerpo de la función corre dentro de la transacción del que
-- llama). Falla si no hay sesión, si el nombre es inválido o si el
-- usuario ya pertenece a un tenant.
--
-- Concurrencia: un advisory lock transaccional namespaced por uid
-- serializa dos llamadas concurrentes DEL MISMO usuario (p.ej. doble
-- click); la segunda espera a que la primera termine y después ve que
-- ya existe la fila en miembros y falla. Como último respaldo, incluso
-- sin el lock, el UNIQUE de miembros.user_id (001) haría fallar el
-- INSERT duplicado con unique_violation.
-- ---------------------------------------------------------------------

create function public.create_transportista(p_nombre text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text;
  v_transportista_id uuid;
begin
  if v_uid is null then
    raise exception 'Hay que iniciar sesión para crear un transportista' using errcode = '28000';
  end if;

  v_nombre := trim(coalesce(p_nombre, ''));
  if length(v_nombre) = 0 then
    raise exception 'El nombre no puede estar vacío' using errcode = '22023';
  end if;
  if length(v_nombre) > 200 then
    raise exception 'El nombre no puede superar los 200 caracteres' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('onboarding:' || v_uid::text));

  if exists (select 1 from public.miembros where user_id = v_uid) then
    raise exception 'El usuario ya pertenece a un transportista' using errcode = '23505';
  end if;

  insert into public.transportistas (nombre) values (v_nombre)
    returning id into v_transportista_id;

  insert into public.miembros (user_id, transportista_id, rol)
    values (v_uid, v_transportista_id, 'admin');

  return v_transportista_id;
end;
$$;

comment on function public.create_transportista(text) is
  'Onboarding atómico: crea el transportista y da de alta al usuario actual como admin.';

revoke execute on function public.create_transportista(text) from public, anon, authenticated;
grant execute on function public.create_transportista(text) to authenticated;

-- ---------------------------------------------------------------------
-- Cambio de rol: cambiar_rol_miembro(p_user_id, p_rol)
-- ---------------------------------------------------------------------
-- Solo la puede ejecutar un admin, sobre un miembro de SU MISMO tenant,
-- y nunca puede dejar el tenant sin ningún admin. Un advisory lock
-- namespaced por transportista_id serializa cambios de rol concurrentes
-- dentro del mismo tenant (evita que dos demotes simultáneos a dos
-- admins distintos dejen el tenant sin admins por una carrera de
-- lectura de conteo).
--
-- TOCTOU: el primer chequeo de "quien llama es admin" se hace ANTES de
-- conseguir el lock, así que entre ese chequeo y el lock alguien más
-- pudo habernos degradado (otro admin nos sacó el rol admin). Por eso
-- se vuelve a leer y revalidar el rol del que llama YA CON EL LOCK
-- tomado, antes de tocar nada.
--
-- El mensaje de "el miembro no existe" y el de "es de otro tenant" van
-- UNIFICADOS a propósito (mismo motivo que en fn_validar_categoria_gasto):
-- evita que el mensaje de error sirva de oráculo para saber si un uuid
-- de usuario existe en otro tenant.
-- ---------------------------------------------------------------------

create function public.cambiar_rol_miembro(p_user_id uuid, p_rol public.rol_miembro)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_uid uuid := auth.uid();
  v_admin_tid uuid;
  v_admin_rol public.rol_miembro;
  v_target_tid uuid;
  v_target_rol public.rol_miembro;
  v_admins_restantes int;
begin
  if v_admin_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select transportista_id, rol into v_admin_tid, v_admin_rol
    from public.miembros where user_id = v_admin_uid;

  if v_admin_tid is null then
    raise exception 'No pertenecés a ningún transportista' using errcode = '42501';
  end if;
  if v_admin_rol <> 'admin' then
    raise exception 'Solo un admin puede cambiar roles' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('rol_change:' || v_admin_tid::text));

  -- Re-chequeo post-lock (TOCTOU): releemos nuestro propio rol ya
  -- serializados contra cualquier otro cambiar_rol_miembro() del mismo
  -- tenant.
  select transportista_id, rol into v_admin_tid, v_admin_rol
    from public.miembros where user_id = v_admin_uid;

  if v_admin_tid is null or v_admin_rol <> 'admin' then
    raise exception 'Solo un admin puede cambiar roles' using errcode = '42501';
  end if;

  select transportista_id, rol into v_target_tid, v_target_rol
    from public.miembros where user_id = p_user_id;

  if v_target_tid is null or v_target_tid <> v_admin_tid then
    raise exception 'No podés cambiar el rol de ese miembro' using errcode = '42501';
  end if;

  if v_target_rol = p_rol then
    return;
  end if;

  if v_target_rol = 'admin' and p_rol <> 'admin' then
    select count(*) into v_admins_restantes
      from public.miembros
      where transportista_id = v_admin_tid and rol = 'admin' and user_id <> p_user_id;
    if v_admins_restantes = 0 then
      raise exception 'No se puede quitar el último admin del transportista'
        using errcode = '42501';
    end if;
  end if;

  perform set_config('app.permitir_cambio_rol', 'on', true);
  update public.miembros set rol = p_rol where user_id = p_user_id;
  perform set_config('app.permitir_cambio_rol', 'off', true);
end;
$$;

comment on function public.cambiar_rol_miembro(uuid, public.rol_miembro) is
  'Único camino habilitado para cambiar miembros.rol. Solo admin, mismo tenant, nunca sin admins.';

revoke execute on function public.cambiar_rol_miembro(uuid, public.rol_miembro) from public, anon, authenticated;
grant execute on function public.cambiar_rol_miembro(uuid, public.rol_miembro) to authenticated;
