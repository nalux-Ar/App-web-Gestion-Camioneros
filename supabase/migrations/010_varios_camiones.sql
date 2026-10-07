-- =====================================================================
-- 010_varios_camiones.sql — Elan (Bloque C, Etapa 5b: Camiones y varios camiones)
-- =====================================================================
-- Qué hace (migración ADITIVA: no rompe el front publicado):
--   1. camiones: quita la regla "un camión por transportista"
--      (camiones_un_por_transportista), agrega activa (archivar en vez de
--      borrar) y deja la patente guardada NORMALIZADA (solo A-Z y 0-9) y
--      única por tenant, incluidos los archivados.
--   2. gastos: agrega camion_id (opcional) con FK compuesta al camión del
--      mismo tenant (ON DELETE RESTRICT) y su índice.
--   3. Triggers que sostienen las reglas en la base, para cualquier camino de
--      escritura (PostgREST directo o las funciones de viajes de la 007, que
--      NO se tocan):
--        * camión por defecto (fn_camion_por_defecto);
--        * camión archivado y coherencia gasto <-> viaje (fn_validar_camion);
--        * si un viaje cambia de camión, sus gastos con camión lo siguen
--          (fn_propagar_camion_viaje).
--   4. crear_camion(...): alta idempotente por patente que, si es el primer
--      camión del tenant, asigna los viajes y los gastos con litros que se
--      cargaron antes sin camión.
--   5. Policies de camiones: lectura para todo el tenant (el chofer incluido)
--      y escritura solo para el admin. Reemplaza camiones_tenant_isolation.
--
-- Por qué: el primer usuario de prueba puede tener más de un camión, y el
-- rendimiento de combustible (Resumen) se calcula por camión, entre cargas
-- de tanque lleno consecutivas del MISMO camión. Para eso cada carga tiene
-- que saber de qué camión es (gastos.camion_id). Decisiones de diseño
-- aprobadas por la responsable del proyecto (plan de la Etapa 5).
--
-- Orden de aplicación: 10. Requiere 001 a 003 y 005 a 009 aplicadas (usa
-- gastos.litros de la 005; el test de aislamiento completo, sección 19
-- incluida, asume 001 a 003 y 005 a 010).
--
-- ---------------------------------------------------------------------
-- Orden de despliegue: 010 -> front -> 011 -> 012
-- ---------------------------------------------------------------------
-- * 010 (esta): aditiva. Con el front publicado sigue todo andando: ese front
--   nunca manda gastos.camion_id, al editar un viaje reenvía el mismo
--   camion_id que tenía y no escribe en camiones.
-- * front: pantallas de camiones, selector y crear_camion.
-- * 011 (después del front): relleno de las cuentas con un solo camión y la
--   regla "un gasto con litros exige camión" (gastos_litros_camion_chk, NOT
--   VALID). No va acá: hoy ninguna cuenta tiene camiones y el front
--   publicado exige litros en Combustible, así que esa regla rompería todas
--   las cargas de combustible.
-- * 012 (cierre de pruebas, con los datos de prueba ya borrados): VALIDATE
--   de ese check.
-- Si el front sale ANTES que la 010: PostgREST no conoce gastos.camion_id ni
-- camiones.activa (PGRST204: se cae el guardado de gastos) ni crear_camion
-- (PGRST202). Las lecturas que no los nombran siguen andando.
-- Después de aplicar: regenerar src/lib/database.types.ts.
--
-- ---------------------------------------------------------------------
-- Contrato con el front
-- ---------------------------------------------------------------------
-- * Alta de camión: SIEMPRE por RPC crear_camion(p_patente, p_marca,
--   p_modelo, p_anio). Devuelve una fila (camion_id, creado,
--   viajes_asignados, gastos_asignados, activa):
--     - creado = true: se creó. Si era el PRIMER camión del tenant (contando
--       archivados), viajes_asignados / gastos_asignados dicen cuántos viajes
--       sin camión y cuántos gastos CON LITROS sin camión quedaron asignados
--       a él (los gastos sin litros no se tocan: pueden ser gastos propios).
--     - creado = false: ya existía un camión con esa patente en el propio
--       tenant (reintento tras una respuesta perdida, o patente repetida). Se
--       devuelve ese camión sin tocar nada; activa = false significa que está
--       archivado (el front ofrece reactivarlo).
--   La patente se normaliza adentro (mayúsculas, sin espacios, guiones ni
--   puntos): "ab 123-cd" se guarda "AB123CD". marca y modelo vacíos quedan
--   NULL.
-- * Editar (patente, marca, modelo, año), archivar y reactivar: UPDATE
--   directo de camiones (solo admin). Archivar = activa false; reactivar =
--   activa true. La patente de un UPDATE directo la manda ya normalizada el
--   front (si no, 23514).
-- * Borrar: DELETE directo (solo admin). Solo se puede si el camión no tiene
--   viajes ni gastos: viajes_camion_fk y gastos_camion_fk son ON DELETE
--   RESTRICT. Si no, se archiva.
-- * La base NO impide archivar el único camión activo: esa regla es del
--   front (decisión de la responsable del proyecto).
-- * gastos.camion_id se manda en el INSERT/UPDATE de gastos; viajes.camion_id
--   sigue yendo por crear_viaje_con_entregas / actualizar_viaje_con_entregas
--   (firmas sin cambios).
-- * Errores (SQLSTATE en error.code):
--     42501  crear_camion de alguien que no es admin ("Solo el administrador
--            puede crear camiones"); un INSERT directo de un chofer cae en la
--            policy (42501, "row-level security"). Un UPDATE/DELETE de un
--            chofer no da error: afecta 0 filas (igual que el nombre de la
--            cuenta).
--     23514  patente inválida (camiones_patente_chk: vacía o de más de 20;
--            camiones_patente_normalizada_chk: no normalizada), o gasto con
--            un camión distinto del de su viaje (mensaje con
--            gastos_camion_viaje_chk).
--     23505  patente repetida en el tenant (camiones_transportista_patente_key),
--            en un INSERT o UPDATE directo.
--     55000  camión archivado asignado a un viaje o a un gasto (mensaje con
--            camion_archivado; hint "Reactivalo o elegí otro camión.").
--     23503  camión de otro tenant o inexistente (gastos_camion_fk /
--            viajes_camion_fk): mismo código, constraint y mensaje en los dos
--            casos, así que no sirve de oráculo de existencia.
--     23503 / 23001  borrar un camión con viajes o gastos (RESTRICT):
--            23503 en PostgreSQL 17 (la base real), 23001 en PostgreSQL 18.
--            El front acepta los dos y mira el constraint.
--
-- ---------------------------------------------------------------------
-- Reglas de los triggers (aprobadas; ninguna toca a otro tenant: todas
-- buscan con transportista_id = el de la fila y corren SECURITY INVOKER,
-- así que además filtra RLS)
-- ---------------------------------------------------------------------
-- * Camión por defecto (fn_camion_por_defecto, trg_21):
--     - viajes: solo al INSERTAR. Si llega sin camión y el tenant tiene
--       EXACTAMENTE un camión activo, se le pone ese. Cubre las pestañas que
--       todavía tienen abierto el front viejo (que no manda camion_id). Al
--       editar no se rellena nada: en actualizar_viaje_con_entregas un null
--       explícito significa "sin camión".
--     - gastos: solo si tienen litros (INSERT y UPDATE). Si llegan sin camión:
--       el camión del viaje, si está activo; si el viaje tiene un camión
--       archivado, no se adivina (queda NULL); si no hay viaje o el viaje no
--       tiene camión, el único activo del tenant. Los gastos sin litros nunca
--       se rellenan (pueden ser gastos propios, no del camión).
--     - Efecto buscado: un camion_id = NULL explícito en un gasto con litros
--       se vuelve a completar (con litros, "sin camión" no es un estado
--       válido a partir de la 011). Y con exactamente un camión activo, un
--       viaje "sin camión" no se puede crear por INSERT (se edita después).
-- * Camión archivado (fn_validar_camion, trg_22): se rechaza con 55000 SOLO
--   cuando camion_id cambia (INSERT con camión, o UPDATE que lo cambia). Un
--   registro viejo conserva su camión archivado y se puede seguir editando:
--   actualizar_viaje_con_entregas reenvía el mismo camion_id y no falla.
-- * Coherencia gasto <-> viaje (fn_validar_camion, trg_22 en gastos): solo si
--   el gasto tiene camión Y viaje Y el viaje tiene camión; ahí tienen que ser
--   el mismo (23514). Un viaje sin camión no bloquea nada. Se lee el viaje
--   con FOR SHARE para serializarse con un cambio de camión del viaje en
--   curso (otra pestaña u otro dispositivo).
-- * Propagación (fn_propagar_camion_viaje, trg_50 AFTER UPDATE en viajes):
--   si un viaje pasa a tener otro camión (no NULL), sus gastos CON camión
--   pasan a ese camión; los gastos sin camión siguen sin camión. Dejar un
--   viaje sin camión no toca sus gastos. No hay historia del camión
--   anterior: el front avisa cuántos gastos se mueven antes de guardar.
--   Alternativa descartada: rechazar el cambio con un error, que traba la
--   edición (el gasto no puede cambiar mientras el viaje tenga el camión
--   viejo, y el viaje no puede cambiar mientras el gasto lo tenga).
--
-- ---------------------------------------------------------------------
-- Filas existentes y relleno defensivo
-- ---------------------------------------------------------------------
-- * En la base real hoy hay 0 camiones, así que esta migración no cambia
--   ninguna fila: activa y camion_id nacen en sus valores por defecto (true y
--   NULL) sin reescribir las tablas.
-- * Igual incluye, ANTES de quitar camiones_un_por_transportista, dos pasos
--   que en la base real tocan 0 filas y hacen que la migración sea correcta
--   en cualquier otro ambiente (local, staging) que ya tenga camiones:
--   normaliza las patentes existentes y asigna a viajes y a gastos con
--   litros sin camión el único camión de su tenant. Mientras rige "un camión
--   por tenant" no hay ambigüedad posible: ni patentes repetidas al
--   normalizar ni dos candidatos para el relleno. Si en algún ambiente una
--   patente quedara vacía al normalizar, la migración falla entera.
--
-- ---------------------------------------------------------------------
-- Locks
-- ---------------------------------------------------------------------
-- * Va en una sola transacción. Los ALTER TABLE toman ACCESS EXCLUSIVE sobre
--   camiones y gastos (y la FK, SHARE ROW EXCLUSIVE sobre camiones); los
--   CREATE TRIGGER sobre viajes y gastos toman SHARE ROW EXCLUSIVE. Como todo
--   va en la misma transacción, esos locks se mantienen hasta el final:
--   bloquean lecturas y escrituras de esas tablas mientras dura. Con el
--   volumen actual (decenas de filas) son milisegundos.
-- * lock_timeout de 5 s: si alguna transacción larga tiene esas tablas, la
--   migración falla entera en vez de quedar en cola bloqueando a todos.
--
-- ---------------------------------------------------------------------
-- Reversibilidad (el plan gratuito no tiene copias de seguridad)
-- ---------------------------------------------------------------------
-- * Hay un script inverso para deshacerla a mano, que no va al repo. Se
--   puede volver atrás del todo solo mientras ninguna cuenta tenga más de un
--   camión (si no, camiones_un_por_transportista no se puede recrear).
-- * NO se recupera al deshacerla: gastos.camion_id (se pierde a qué camión
--   iba cada gasto), activa (qué camiones estaban archivados), el formato
--   original de las patentes normalizadas, ni qué viajes estaban sin camión
--   antes de que crear_camion o la propagación los asignaran (viajes.camion_id
--   ya existía y no se borra). Antes de aplicarla conviene guardar una copia
--   de las tablas de negocio.
-- =====================================================================

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1) camiones: activa, patente normalizada y única por tenant
-- ---------------------------------------------------------------------

-- Fast default: agregar una columna NOT NULL con default constante no
-- reescribe la tabla.
alter table public.camiones
  add column activa boolean not null default true;

comment on column public.camiones.activa is
  'false = camión archivado: conserva sus viajes y gastos, no se le pueden asignar registros nuevos (55000) y se reactiva con activa = true. Archivar en vez de borrar: un camión con viajes o gastos no se puede borrar (RESTRICT).';

-- Relleno defensivo 1/2 (0 filas en la base real): normaliza las patentes
-- existentes. Con camiones_un_por_transportista todavía vigente, no puede
-- haber dos patentes iguales en un tenant después de normalizar.
update public.camiones
   set patente = upper(regexp_replace(patente, '[^0-9A-Za-z]', '', 'g'))
 where patente is distinct from upper(regexp_replace(patente, '[^0-9A-Za-z]', '', 'g'));

-- Solo mayúsculas y dígitos ASCII. Convive con camiones_patente_chk de 001
-- (largo de 1 a 20); con un texto vacío salta primero ese (orden por nombre).
alter table public.camiones
  add constraint camiones_patente_normalizada_chk check (patente ~ '^[A-Z0-9]{1,20}$');

comment on constraint camiones_patente_normalizada_chk on public.camiones is
  'La patente se guarda normalizada: solo A-Z y 0-9, de 1 a 20 caracteres ("AB 123-CD" se guarda "AB123CD"). crear_camion normaliza sola; en un UPDATE directo la normaliza el front.';

-- Única por tenant INCLUYENDO archivados: un mismo camión físico es una sola
-- fila (volver a darlo de alta = reactivarlo). Otro tenant puede tener la
-- misma patente: el trigger de 002 fija transportista_id antes del índice,
-- así que un 23505 solo puede ser contra una fila del propio tenant.
alter table public.camiones
  add constraint camiones_transportista_patente_key unique (transportista_id, patente);

-- ---------------------------------------------------------------------
-- 2) gastos.camion_id + FK compuesta + índice
-- ---------------------------------------------------------------------

alter table public.gastos
  add column camion_id uuid null;

-- Mismo patrón que viajes_camion_fk (001): compuesta con el tenant, para que
-- nunca se pueda apuntar al camión de otro transportista. RESTRICT (no SET
-- NULL): en una FK compuesta, SET NULL anularía también transportista_id.
alter table public.gastos
  add constraint gastos_camion_fk foreign key (transportista_id, camion_id)
  references public.camiones (transportista_id, id) on delete restrict;

-- Sostiene el chequeo del RESTRICT al borrar un camión, la propagación y el
-- relleno (mismo índice que viajes_transportista_camion_idx de 001).
create index gastos_transportista_camion_idx on public.gastos (transportista_id, camion_id);

comment on column public.gastos.camion_id is
  'Camión del gasto (opcional). FK compuesta gastos_camion_fk (mismo tenant, ON DELETE RESTRICT). Si el gasto tiene viaje y el viaje tiene camión, tiene que ser el mismo (23514); si el viaje cambia de camión, el gasto lo sigue. Un gasto con litros sin camión toma por defecto el del viaje o el único camión activo. A partir de la 011, un gasto con litros exige camión.';

-- Relleno defensivo 2/2 (0 filas en la base real): con un solo camión por
-- tenant, los viajes sin camión y los gastos con litros sin camión son de
-- ese camión. Va antes de crear los triggers de abajo.
update public.viajes v
   set camion_id = c.id
  from public.camiones c
 where c.transportista_id = v.transportista_id
   and v.camion_id is null;

update public.gastos g
   set camion_id = c.id
  from public.camiones c
 where c.transportista_id = g.transportista_id
   and g.camion_id is null
   and g.litros is not null;

-- Recién ahora se permite más de un camión por tenant.
-- camiones_transportista_id_key (transportista_id, id) se queda: sostiene las
-- FK compuestas viajes_camion_fk y gastos_camion_fk.
alter table public.camiones
  drop constraint camiones_un_por_transportista;

-- ---------------------------------------------------------------------
-- 3) Triggers de camión
-- ---------------------------------------------------------------------
-- Mismo estilo que los de 002/006 a 009: plpgsql, SECURITY INVOKER (RLS
-- sigue aplicando adentro), search_path fijo y EXECUTE revocado a public,
-- anon y authenticated (un trigger no necesita que el usuario tenga EXECUTE
-- sobre su función).
--
-- Orden de disparo (los de un mismo evento corren por nombre):
--   gastos  BEFORE INSERT: trg_10_forzar_transportista_id -> trg_15_validar_categoria_gasto
--                          -> trg_21_camion_por_defecto -> trg_22_validar_camion
--   gastos  BEFORE UPDATE: trg_15 -> trg_20_bloquear_cambio_transportista_id -> trg_21 -> trg_22
--                          -> trg_25_bloquear_cambio_client_ref -> trg_30_set_updated_at
--   viajes  BEFORE INSERT: trg_10 -> trg_21_camion_por_defecto -> trg_22_validar_camion
--   viajes  BEFORE UPDATE: trg_20 -> trg_22 -> trg_25 -> trg_30
--   viajes  AFTER UPDATE:  trg_50_propagar_camion_a_gastos
-- trg_21 y trg_22 corren después de que el tenant quedó fijado (trg_10 en
-- INSERT) y de que se rechazó un cambio de tenant (trg_20 en UPDATE); el
-- default (21) corre antes que la validación (22), así que un camión puesto
-- por defecto también se valida.

-- 3a) Camión por defecto.
create function public.fn_camion_por_defecto()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_viaje_camion uuid;
  v_ids uuid[];
begin
  if new.camion_id is not null then
    return new;
  end if;

  -- (if anidados: en viajes no existen new.litros ni new.viaje_id, y plpgsql
  -- no puede ni nombrarlos.)
  if tg_table_name = 'gastos' then
    if new.litros is null then
      return new;
    end if;
    if new.viaje_id is not null then
      select v.camion_id into v_viaje_camion
        from public.viajes v
       where v.transportista_id = new.transportista_id and v.id = new.viaje_id;
      if v_viaje_camion is not null then
        if exists (select 1 from public.camiones c
                    where c.transportista_id = new.transportista_id
                      and c.id = v_viaje_camion and c.activa) then
          new.camion_id := v_viaje_camion;
        end if;
        -- Viaje con un camión archivado: no se adivina otro (quedaría
        -- incoherente con el viaje).
        return new;
      end if;
    end if;
  end if;

  -- Exactamente un camión activo en el tenant: ese. (limit 2 alcanza para
  -- distinguir "uno" de "más de uno".)
  select array_agg(x.id) into v_ids
    from (select c.id
            from public.camiones c
           where c.transportista_id = new.transportista_id and c.activa
           limit 2) x;
  if cardinality(v_ids) = 1 then
    new.camion_id := v_ids[1];
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_camion_por_defecto() from public, anon, authenticated;

create trigger trg_21_camion_por_defecto
  before insert on public.viajes
  for each row execute function public.fn_camion_por_defecto();

create trigger trg_21_camion_por_defecto
  before insert or update on public.gastos
  for each row execute function public.fn_camion_por_defecto();

-- 3b) Camión archivado (solo si camion_id cambia) y coherencia gasto <-> viaje.
create function public.fn_validar_camion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_activa boolean;
  v_viaje_camion uuid;
begin
  if new.camion_id is not null
     and (tg_op = 'INSERT' or new.camion_id is distinct from old.camion_id) then
    select c.activa into v_activa
      from public.camiones c
     where c.transportista_id = new.transportista_id and c.id = new.camion_id;
    -- No encontrado (no existe o es de otro tenant): acá no se dice nada; lo
    -- rechaza la FK compuesta con 23503, igual para los dos casos. Así el
    -- 55000 nunca revela si un camión ajeno está archivado.
    if v_activa is false then
      raise exception 'El camión está archivado (camion_archivado)'
        using errcode = '55000', hint = 'Reactivalo o elegí otro camión.';
    end if;
  end if;

  if tg_table_name = 'gastos' then
    if new.camion_id is not null and new.viaje_id is not null
       and (tg_op = 'INSERT'
            or new.camion_id is distinct from old.camion_id
            or new.viaje_id is distinct from old.viaje_id) then
      -- FOR SHARE: si otra transacción está cambiando el camión de este viaje,
      -- se espera a que termine y se compara contra el camión ya guardado.
      select v.camion_id into v_viaje_camion
        from public.viajes v
       where v.transportista_id = new.transportista_id and v.id = new.viaje_id
         for share;
      if v_viaje_camion is not null and v_viaje_camion <> new.camion_id then
        raise exception 'El camión del gasto no coincide con el del viaje (gastos_camion_viaje_chk)'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_validar_camion() from public, anon, authenticated;

create trigger trg_22_validar_camion
  before insert or update on public.viajes
  for each row execute function public.fn_validar_camion();

create trigger trg_22_validar_camion
  before insert or update on public.gastos
  for each row execute function public.fn_validar_camion();

-- 3c) Un viaje cambia de camión: sus gastos con camión lo siguen.
create function public.fn_propagar_camion_viaje()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.camion_id is not null and new.camion_id is distinct from old.camion_id then
    -- Corre como el usuario (RLS) y con el tenant explícito. Cada gasto
    -- movido pasa por los triggers de gastos (el camión nuevo ya se validó
    -- activo en trg_22 de viajes; la coherencia ve el viaje ya actualizado).
    update public.gastos g
       set camion_id = new.camion_id
     where g.transportista_id = new.transportista_id
       and g.viaje_id = new.id
       and g.camion_id is not null
       and g.camion_id <> new.camion_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_propagar_camion_viaje() from public, anon, authenticated;

create trigger trg_50_propagar_camion_a_gastos
  after update on public.viajes
  for each row execute function public.fn_propagar_camion_viaje();

-- ---------------------------------------------------------------------
-- 4) crear_camion
-- ---------------------------------------------------------------------
-- SECURITY INVOKER (como las funciones de viajes de la 007): RLS y los
-- triggers de 002 siguen aplicando adentro; además cada consulta lleva el
-- tenant explícito. EXECUTE solo para authenticated.
-- * Solo admin: se verifica al entrar (mensaje claro); la policy de INSERT
--   de camiones lo vuelve a exigir.
-- * Dos altas simultáneas del mismo tenant (doble toque, dos pestañas o dos
--   dispositivos) se serializan con un advisory lock por tenant: la segunda
--   espera, ve el camión de la primera y no rellena nada (y si es la misma
--   patente, devuelve creado = false).
-- * "Primer camión" = el tenant no tenía NINGÚN camión, contando archivados.
--   Solo entonces asigna los viajes sin camión y los gastos con litros sin
--   camión; nunca pisa un camion_id ya cargado.
-- * Todas las columnas de las tablas van calificadas: los nombres de la
--   salida (camion_id, activa) son variables dentro de la función.

create function public.crear_camion(
  p_patente text,
  p_marca text default null,
  p_modelo text default null,
  p_anio integer default null
)
returns table (camion_id uuid, creado boolean, viajes_asignados integer, gastos_asignados integer, activa boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tid uuid;
  v_patente text;
  v_id uuid;
  v_activa boolean;
  v_primero boolean;
  v_v integer := 0;
  v_g integer := 0;
begin
  v_tid := public.get_mi_transportista_id();
  if v_tid is null then
    raise exception 'No perteneces a ningún transportista: no se puede crear el camión'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.miembros m
                  where m.user_id = auth.uid() and m.transportista_id = v_tid and m.rol = 'admin') then
    raise exception 'Solo el administrador puede crear camiones' using errcode = '42501';
  end if;

  v_patente := upper(regexp_replace(coalesce(p_patente, ''), '[^0-9A-Za-z]', '', 'g'));

  perform pg_advisory_xact_lock(hashtext('elan:camiones:' || v_tid::text));

  -- Reintento o patente repetida: se devuelve el existente sin tocar nada.
  select c.id, c.activa into v_id, v_activa
    from public.camiones c
   where c.transportista_id = v_tid and c.patente = v_patente;
  if found then
    return query select v_id, false, 0, 0, v_activa;
    return;
  end if;

  v_primero := not exists (select 1 from public.camiones c where c.transportista_id = v_tid);

  -- transportista_id e id los completa el trigger fn_forzar_transportista_id.
  -- Una patente vacía o de más de 20 falla acá con 23514 (checks de la tabla).
  insert into public.camiones (patente, marca, modelo, anio)
  values (v_patente, nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''), p_anio)
  returning id into v_id;

  if v_primero then
    update public.viajes v
       set camion_id = v_id
     where v.transportista_id = v_tid and v.camion_id is null;
    get diagnostics v_v = row_count;

    update public.gastos g
       set camion_id = v_id
     where g.transportista_id = v_tid and g.camion_id is null and g.litros is not null;
    get diagnostics v_g = row_count;
  end if;

  return query select v_id, true, v_v, v_g, true;
end;
$$;

comment on function public.crear_camion(text, text, text, integer) is
  'Alta de camión (solo admin; SECURITY INVOKER). Normaliza la patente e idempotente por patente: si ya existe en el propio tenant devuelve (camion_id, creado = false, 0, 0, activa) sin tocar nada. Si es el primer camión del tenant (contando archivados), asigna los viajes sin camión y los gastos con litros sin camión. Altas simultáneas serializadas por tenant. Errores: ver el encabezado de 010.';

revoke execute on function public.crear_camion(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.crear_camion(text, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Policies de camiones: lectura por tenant, escritura solo admin
-- ---------------------------------------------------------------------
-- Mismo patrón que transportistas_update_nombre_admin (003). Para un chofer:
-- SELECT ve los camiones del tenant (los necesita para elegir camión), un
-- INSERT falla con 42501 y un UPDATE o DELETE afecta 0 filas sin error. Los
-- grants de tabla de 003 no cambian. RLS ya está activo en camiones (001/003).

drop policy "camiones_tenant_isolation" on public.camiones;

create policy "camiones_select"
  on public.camiones
  for select
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()));

create policy "camiones_insert_admin"
  on public.camiones
  for insert
  to authenticated
  with check (
    transportista_id = (select public.get_mi_transportista_id())
    and exists (
      select 1 from public.miembros m
      where m.user_id = (select auth.uid())
        and m.transportista_id = camiones.transportista_id
        and m.rol = 'admin'
    )
  );

create policy "camiones_update_admin"
  on public.camiones
  for update
  to authenticated
  using (
    transportista_id = (select public.get_mi_transportista_id())
    and exists (
      select 1 from public.miembros m
      where m.user_id = (select auth.uid())
        and m.transportista_id = camiones.transportista_id
        and m.rol = 'admin'
    )
  )
  with check (transportista_id = (select public.get_mi_transportista_id()));

create policy "camiones_delete_admin"
  on public.camiones
  for delete
  to authenticated
  using (
    transportista_id = (select public.get_mi_transportista_id())
    and exists (
      select 1 from public.miembros m
      where m.user_id = (select auth.uid())
        and m.transportista_id = camiones.transportista_id
        and m.rol = 'admin'
    )
  );
