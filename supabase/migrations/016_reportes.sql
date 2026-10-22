-- =====================================================================
-- 016_reportes.sql — Elan (reportes de problemas desde la app)
-- =====================================================================
-- Qué hace: crea public.reportes, donde un usuario de la app deja un
-- reporte de problema (mensaje, pantalla de origen y contexto técnico). Las
-- cuentas SOLO pueden insertar: no leen, no editan ni borran nada, ni
-- siquiera lo propio. La dueña lee todo desde el panel de Supabase (rol
-- postgres, dueño de la tabla, sin RLS) y ahí mismo cambia estado y nota.
--
-- Por qué solo-insert: el aislamiento entre cuentas no se toca. No hay
-- ningún camino de lectura en la app (ni policy de SELECT, ni funciones de
-- "administración"), así que un reporte nunca se puede ver desde otra
-- cuenta, tampoco por error de configuración del front.
--
-- Orden de aplicación: 16. Requiere 001 a 003 (transportistas, miembros,
-- get_mi_transportista_id y fn_forzar_transportista_id). No depende de 005
-- a 015. El test de aislamiento completo (sección 24 incluida) asume 001 a
-- 003 y 005 a 016.
-- Despliegue: aditiva (tabla nueva, no toca nada existente). La 016 va
-- ANTES del front que manda reportes. Después de aplicar: regenerar
-- src/lib/database.types.ts.
--
-- ---------------------------------------------------------------------
-- Contrato con el front
-- ---------------------------------------------------------------------
-- * INSERT con SOLO estas columnas: mensaje, pantalla, contexto, client_ref.
--   Cualquier otra (id, created_at, transportista_id, user_id, estado, nota)
--   en el INSERT: 42501 por permiso de columna, y no se guarda nada.
-- * Sin "return=representation" (en supabase-js: .insert(...) SIN .select()):
--   la cuenta no tiene SELECT sobre la tabla, así que pedir la fila de vuelta
--   falla con 42501. El INSERT simple (return=minimal) funciona.
-- * mensaje: obligatorio, hasta 2000 caracteres y con algún carácter que no
--   sea espacio (vacío, solo espacios/saltos de línea o más largo: 23514
--   reportes_mensaje_chk).
-- * pantalla: opcional, hasta 300 caracteres (23514 reportes_pantalla_chk).
--   Es la ruta de la pantalla de origen; solo se lee, la app no navega a ella.
-- * contexto: objeto JSON de hasta 4000 bytes (23514 reportes_contexto_chk).
--   Por defecto {}.
-- * client_ref: uuid obligatorio, único por cuenta. Un reintento con el mismo
--   client_ref da 23505 (reportes_transportista_client_ref_uidx): el reporte
--   ya estaba guardado y el front lo trata como éxito (mismo patrón que
--   006/008/009). Un reintento da 23505 aunque el usuario ya esté en el tope.
-- * Tope anti-spam: 30 reportes por usuario en 24 horas. El 31 falla con
--   SQLSTATE PT429 (PostgREST lo devuelve como HTTP 429, error.code
--   'PT429') y el texto fijo:
--     "Llegaste al límite de 30 reportes en 24 horas. Probá de nuevo más tarde."
-- * Usuario sin cuenta (sin fila en miembros): 42501 de fn_forzar_transportista_id
--   ("No pertenecés a ningún transportista: no se puede crear este registro").
--   anon: 42501 por permiso (no tiene ningún privilegio sobre la tabla).
--
-- ---------------------------------------------------------------------
-- Cómo se completa cada fila (BEFORE INSERT, en orden de nombre)
-- ---------------------------------------------------------------------
-- * trg_10_forzar_transportista_id (la función genérica de 002, igual que en
--   las tablas de negocio): pisa transportista_id con el de la cuenta del
--   usuario y el id con uno nuevo. Fuera del contexto de confianza de 002,
--   sin cuenta: 42501.
-- * trg_11_completar_reporte (fn_completar_reporte, SECURITY DEFINER): si
--   hay usuario (auth.uid() no NULL), pisa user_id = auth.uid(),
--   created_at = now(), estado = 'nuevo' y nota = NULL (defensa en
--   profundidad: el permiso de columna ya impide mandarlos), y aplica el
--   tope. SECURITY DEFINER porque contar los reportes del usuario necesita
--   leer la tabla, y la cuenta no tiene SELECT. Sin usuario (auth.uid()
--   NULL) no toca nada: a ese punto solo llega el contexto de confianza que
--   trg_10 ya dejó pasar (conexión directa como postgres/supabase_admin o
--   service_role); en cualquier otro caso trg_10 ya cortó con 42501.
-- * Los BEFORE INSERT corren antes del WITH CHECK de la policy y de la
--   unicidad: por eso el WITH CHECK ve los valores forzados, y por eso el
--   tope deja pasar un client_ref que ya existe (para que el reintento
--   reciba el 23505 de la unicidad y no el error del tope).
-- * Los reportes de un mismo usuario se serializan: antes de contar, trg_11
--   toma un candado de transacción por usuario (pg_advisory_xact_lock sobre
--   un hash del user_id) que dura hasta el COMMIT. Así dos INSERT simultáneos
--   del mismo usuario no pueden pasar los dos con 29 en la ventana: el
--   segundo espera y cuenta 30. No frena a otros usuarios ni bloquea la
--   tabla. Por eso la función es VOLATILE: el conteo, hecho después del
--   candado, ve lo que la otra transacción ya confirmó.
-- * Un INSERT de varias filas (como manda PostgREST con un array) cuenta fila
--   por fila (una función VOLATILE ve las filas anteriores de la misma
--   sentencia): si se pasa del tope, falla entero y no guarda ninguna.
-- * INSERT ... ON CONFLICT DO NOTHING sin columnas funciona igual que el
--   INSERT simple (con un client_ref ya guardado no inserta nada y no da
--   error, sin saltear el tope); con columnas, ON CONSTRAINT o DO UPDATE da
--   42501 por permiso (hace falta SELECT o UPDATE, que la cuenta no tiene).
--
-- ---------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------
-- * RLS activa. UNA sola policy, de INSERT, para authenticated:
--   transportista_id = la cuenta del usuario y user_id = el usuario. Ninguna
--   policy de SELECT, UPDATE ni DELETE.
-- * REVOKE ALL a public, anon y authenticated, y GRANT INSERT por columna
--   (mensaje, pantalla, contexto, client_ref) a authenticated. Sin SELECT,
--   UPDATE ni DELETE. El WITH CHECK y los triggers no necesitan SELECT sobre
--   transportista_id ni user_id (comprobado en PGlite).
-- * service_role conserva los privilegios por defecto de la plataforma (y
--   saltea RLS): es solo para el backend, nunca para el front.
-- * fn_completar_reporte: EXECUTE revocado a public, anon y authenticated
--   (los triggers se disparan igual; así no aparece como RPC ni la marca el
--   linter de funciones SECURITY DEFINER ejecutables).
-- * La tabla no se agrega a ninguna publicación (Realtime no la ve).
--
-- ---------------------------------------------------------------------
-- Consulta de revisión (panel de Supabase, SQL Editor, como postgres)
-- ---------------------------------------------------------------------
--   select r.created_at,
--          t.nombre as cuenta,
--          r.estado,
--          r.pantalla,
--          r.mensaje,
--          r.contexto,
--          r.nota,
--          r.id
--     from public.reportes r
--     left join public.transportistas t on t.id = r.transportista_id
--    order by r.created_at desc
--    limit 100;
--   (cuenta NULL = la cuenta ya se borró; created_at está en UTC: para la hora
--   local, r.created_at at time zone '<zona horaria>'.)
-- Marcar un reporte:
--   update public.reportes set estado = 'visto' where id = '<id>';
--   update public.reportes set estado = 'resuelto', nota = '<texto>' where id = '<id>';
--
-- ---------------------------------------------------------------------
-- Borrado de cuentas y usuarios
-- ---------------------------------------------------------------------
-- * Las dos referencias son ON DELETE SET NULL: borrar la cuenta o el usuario
--   deja el reporte con transportista_id / user_id en NULL y el resto igual.
--   Por eso las dos columnas admiten NULL (en el INSERT nunca llegan NULL).
-- * Índices: (transportista_id, client_ref) único, que también sirve a la FK
--   de transportistas, y (user_id, created_at), que sirve al tope y a la FK
--   de auth.users.
--
-- ---------------------------------------------------------------------
-- Locks y reversibilidad
-- ---------------------------------------------------------------------
-- * CREATE TABLE con FK toma un lock SHARE ROW EXCLUSIVE breve sobre
--   transportistas y auth.users (para crear los triggers de la FK); el
--   lock_timeout corta si alguien los tiene tomados.
-- * En uso, cada INSERT con usuario toma un advisory lock de transacción con
--   la clave hashtextextended(user_id, 0): solo espera otro INSERT del mismo
--   usuario. Los otros advisory locks de la base (alta y cambio de rol en
--   002, alta de camiones en 010) usan hashtext de 32 bits sobre un texto con
--   prefijo; esta clave es un hash de 64 bits, así que en la práctica no
--   chocan (y un choque solo haría esperar, nunca daría un error).
-- * Se deshace a mano, en una transacción (se pierden los reportes: si
--   interesan, copiarlos antes):
--     drop table if exists public.reportes;
--     drop function if exists public.fn_completar_reporte();
--   Después, regenerar src/lib/database.types.ts.
-- =====================================================================

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1) Tabla
-- ---------------------------------------------------------------------
create table public.reportes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  transportista_id uuid null references public.transportistas (id) on delete set null,
  user_id uuid null default auth.uid() references auth.users (id) on delete set null,
  mensaje text not null,
  pantalla text null,
  contexto jsonb not null default '{}'::jsonb,
  client_ref uuid not null,
  estado text not null default 'nuevo',
  nota text null,
  constraint reportes_mensaje_chk check (char_length(mensaje) <= 2000 and mensaje ~ '[^[:space:]]'),
  constraint reportes_pantalla_chk check (char_length(pantalla) <= 300),
  constraint reportes_contexto_chk check (jsonb_typeof(contexto) = 'object' and octet_length(contexto::text) <= 4000),
  constraint reportes_estado_chk check (estado in ('nuevo', 'visto', 'resuelto')),
  constraint reportes_nota_chk check (char_length(nota) <= 2000)
);

create unique index reportes_transportista_client_ref_uidx
  on public.reportes (transportista_id, client_ref);

create index reportes_user_created_idx
  on public.reportes (user_id, created_at);

comment on table public.reportes is
  'Reportes de problemas enviados desde la app. Las cuentas solo insertan (sin SELECT, UPDATE ni DELETE); la dueña los lee y les cambia estado y nota desde el panel. Ver el encabezado de 016.';
comment on column public.reportes.created_at is 'Hora del servidor al guardar el reporte (UTC).';
comment on column public.reportes.transportista_id is 'Cuenta que lo envió (la fuerza trg_10). NULL si la cuenta se borró.';
comment on column public.reportes.user_id is 'Usuario que lo envió (lo fuerza trg_11 = auth.uid()). NULL si el usuario se borró.';
comment on column public.reportes.mensaje is 'Texto del reporte: hasta 2000 caracteres, con algún carácter que no sea espacio.';
comment on column public.reportes.pantalla is 'Ruta de la pantalla desde la que se envió (hasta 300 caracteres). Solo informativo.';
comment on column public.reportes.contexto is 'Contexto técnico que arma el front (versión, navegador, pantalla, conexión, errores recientes). Objeto JSON de hasta 4000 bytes.';
comment on column public.reportes.client_ref is 'Id que genera el front para reintentar sin duplicar: único por cuenta (23505 = ya estaba guardado).';
comment on column public.reportes.estado is 'nuevo | visto | resuelto. Lo cambia solo la dueña desde el panel.';
comment on column public.reportes.nota is 'Nota interna de la dueña (hasta 2000 caracteres). La cuenta no la ve ni la manda.';

-- ---------------------------------------------------------------------
-- 2) Triggers BEFORE INSERT
-- ---------------------------------------------------------------------
create trigger trg_10_forzar_transportista_id
  before insert on public.reportes
  for each row execute function public.fn_forzar_transportista_id();

create function public.fn_completar_reporte()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  -- Sin usuario solo llega el contexto de confianza que trg_10 ya dejó pasar.
  if v_uid is null then
    return new;
  end if;

  new.user_id := v_uid;
  new.created_at := now();
  new.estado := 'nuevo';
  new.nota := null;

  -- Reintento de un reporte ya guardado: que lo resuelva la unicidad (23505).
  if exists (select 1 from public.reportes r
              where r.transportista_id = new.transportista_id and r.client_ref = new.client_ref) then
    return new;
  end if;

  -- Serializa los reportes de un mismo usuario hasta el COMMIT, para que dos
  -- INSERT simultáneos no cuenten los dos 29.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select count(*) into v_n
    from public.reportes r
   where r.user_id = v_uid and r.created_at > now() - interval '24 hours';
  if v_n >= 30 then
    raise exception 'Llegaste al límite de 30 reportes en 24 horas. Probá de nuevo más tarde.'
      using errcode = 'PT429';
  end if;

  return new;
end;
$$;

comment on function public.fn_completar_reporte() is
  'Trigger BEFORE INSERT (trg_11) de reportes: con usuario, fuerza user_id = auth.uid(), created_at, estado y nota, y aplica el tope de 30 reportes por usuario en 24 horas (PT429), serializado por usuario con un candado de transacción. SECURITY DEFINER solo para contar los reportes del usuario. Ver el encabezado de 016.';

revoke execute on function public.fn_completar_reporte() from public, anon, authenticated;

create trigger trg_11_completar_reporte
  before insert on public.reportes
  for each row execute function public.fn_completar_reporte();

-- ---------------------------------------------------------------------
-- 3) RLS y permisos
-- ---------------------------------------------------------------------
alter table public.reportes enable row level security;

create policy "reportes_insert_propio"
  on public.reportes
  for insert
  to authenticated
  with check (
    transportista_id = (select public.get_mi_transportista_id())
    and user_id = (select auth.uid())
  );

revoke all on public.reportes from public, anon, authenticated;
grant insert (mensaje, pantalla, contexto, client_ref) on public.reportes to authenticated;
