-- =====================================================================
-- 012_camion_activo.sql — Elan (Bloque C, Etapa 5c: camión activo por usuario)
-- =====================================================================
-- Qué hace (migración ADITIVA):
--   1. Agrega a public.miembros la columna camion_activo_id (uuid, opcional):
--      el camión con el que está trabajando ese usuario. Es una preferencia
--      por usuario, como tema y color_acento: el front la usa para elegir el
--      camión por defecto en viajes y cargas cuando la cuenta tiene más de un
--      camión activo. NULL = ninguno elegido.
--   2. FK compuesta miembros_camion_activo_fk (transportista_id,
--      camion_activo_id) -> camiones (transportista_id, id), con
--      ON DELETE SET NULL (camion_activo_id): borrar un camión deja sin camión
--      activo a los usuarios que lo tenían, y nada más.
--   3. Índice parcial miembros_camion_activo_idx para ese SET NULL.
--   4. GRANT UPDATE de la columna a authenticated: cada usuario cambia SOLO la
--      suya (la policy miembros_update_propia_fila de 003 ya limita a la fila
--      propia).
--   5. Trigger trg_15_validar_camion_activo: un camión archivado no se puede
--      elegir como camión activo (55000, el mismo error de la 010).
--
-- Por qué una columna en miembros y no en otra tabla: es un dato del usuario
-- (una preferencia personal, como tema y color_acento), y miembros ya tiene
-- la policy de "solo tu fila" y el patrón de GRANT por columna de tema y
-- color_acento. No hace falta una tabla nueva con su RLS.
--
-- Alcance (2026-10-09): el modelo es una cuenta = una persona. El rol chofer
-- sigue existiendo en la base por el diseño original, pero en la práctica
-- siempre hay un solo admin y nunca un chofer; por eso las menciones al
-- chofer de más abajo (y los casos con chofer de la sección 21 del test)
-- describen el diseño de la base, no un uso real. Ver CONTEXT.md.
--
-- Orden de aplicación: 12. Requiere 001 a 003 y 005 a 011 aplicadas (usa
-- miembros, camiones y el texto de error de la 010). El test de aislamiento
-- completo (sección 21 incluida) asume 001 a 003 y 005 a 012.
--
-- ---------------------------------------------------------------------
-- Orden de despliegue: 012 -> front de la Etapa 5c
-- ---------------------------------------------------------------------
-- * La 012 se aplica ANTES de publicar el front de la 5c: ese front lee
--   miembros.camion_activo_id al arrancar, y sin la columna PostgREST
--   responde 42703 / PGRST204 y la app no arranca.
-- * Con el front publicado hoy y con el front congelado de la rama piloto
--   (commit d1130bc) no cambia nada: leen miembros con una lista explícita de
--   columnas (rol, tema, color_acento, transportista_id, transportistas(nombre))
--   y nunca escriben camion_activo_id.
-- * No cambia ninguna función existente: create_transportista crea el miembro
--   con camion_activo_id NULL (no lo nombra), cambiar_rol_miembro solo toca
--   rol y no dispara el trigger nuevo, y el trigger de updated_at de miembros
--   (trg_20_set_updated_at, sin lista de columnas) también avanza updated_at
--   cuando cambia el camión activo.
-- * Después de aplicar: regenerar src/lib/database.types.ts.
--
-- ---------------------------------------------------------------------
-- Contrato con el front
-- ---------------------------------------------------------------------
-- * Leer: select camion_activo_id from miembros where user_id = <el propio>
--   (la policy de SELECT de 003 deja ver los miembros de la propia cuenta;
--   ninguna otra cuenta ve estas filas).
-- * Elegir / cambiar: UPDATE de la fila propia con camion_activo_id = <camión
--   de la cuenta>. Quitar: camion_activo_id = NULL. Volver a mandar el mismo
--   valor no falla. El UPDATE de la fila de OTRO usuario afecta 0 filas, sin
--   error (policy de 003).
-- * Errores (SQLSTATE en error.code):
--     55000  el camión elegido está archivado: mensaje con el texto fijo
--            camion_archivado y hint "Reactivalo o elegí otro camión."
--            (los mismos que la 010; el front ya los mapea). Solo cuando el
--            valor CAMBIA: si el camión se archiva después de elegirlo, la
--            fila conserva el puntero y se puede seguir editando (tema, color,
--            o reenviar el mismo camión).
--     23503  el camión no existe o es de otra cuenta
--            (miembros_camion_activo_fk). Mismo código, constraint y mensaje
--            en los dos casos: no sirve de oráculo de existencia.
--     42501  intentar cambiar cualquier otra columna que no sea tema,
--            color_acento o camion_activo_id (GRANT por columna).
-- * Borrar un camión (solo admin; solo si no tiene viajes ni gastos, por los
--   RESTRICT de la 010) deja en NULL el camión activo de los usuarios que lo
--   tenían. La acción de la FK corre como dueño de la tabla, así que lo hace
--   aunque quien borra no pueda escribir las filas de esos usuarios.
-- * Archivar un camión NO toca camion_activo_id: el front decide qué mostrar
--   cuando el camión activo de un usuario está archivado.
--
-- ---------------------------------------------------------------------
-- Detalles de la FK y del trigger
-- ---------------------------------------------------------------------
-- * ON DELETE SET NULL (camion_activo_id), con lista de columnas
--   (PostgreSQL 15 o más; la base real es 17). Sin la lista, SET NULL anularía
--   también transportista_id, que es NOT NULL, y el borrado fallaría (por eso
--   la 001 y la 010 usan RESTRICT en sus FK compuestas opcionales).
-- * MATCH SIMPLE (el default): con camion_activo_id NULL la FK no se chequea.
-- * Se agrega validada de una (sin NOT VALID + VALIDATE): la columna es nueva
--   y está entera en NULL, y la tabla tiene una fila por usuario (hoy, una
--   sola fila real), así que la validación es instantánea.
-- * El trigger es SECURITY INVOKER: cualquier miembro (también un chofer) lee
--   los camiones de su cuenta por la policy camiones_select de la 010. Busca
--   el camión con el transportista_id de la fila, así que nunca mira camiones
--   de otra cuenta, ni siquiera desde una conexión que saltee RLS: un camión
--   ajeno o inexistente lo rechaza la FK (23503), nunca el 55000.
-- * Sin FOR SHARE al leer el camión, igual que el chequeo de archivado de la
--   010: un SELECT ... FOR SHARE exige pasar también la policy de UPDATE de
--   camiones (solo admin), y para un chofer el camión "desaparecería" y el
--   chequeo dejaría pasar un archivado. La carrera con un archivado
--   simultáneo solo puede dejar el puntero en un camión archivado, que es un
--   estado válido de todos modos (el que se da cuando se archiva después de
--   elegirlo).
-- * Orden de los BEFORE UPDATE de miembros (por nombre):
--   trg_10_bloquear_cambio_rol -> trg_15_validar_camion_activo
--   -> trg_20_set_updated_at. Si el camión es rechazado, la fila no cambia.
--
-- ---------------------------------------------------------------------
-- Filas existentes y locks
-- ---------------------------------------------------------------------
-- * Las filas existentes quedan con camion_activo_id NULL y ningún otro dato
--   cambia: la columna es nullable y sin default (no reescribe la tabla) y no
--   hay relleno.
-- * Va en una sola transacción. ADD COLUMN toma ACCESS EXCLUSIVE sobre
--   miembros hasta el final. Ojo: miembros se lee en CADA request (todas las
--   policies pasan por get_mi_transportista_id()), así que mientras dura la
--   migración toda la app espera. Con una fila son milisegundos. La FK toma
--   además SHARE ROW EXCLUSIVE sobre camiones (frena altas y ediciones de
--   camiones ese mismo instante).
-- * lock_timeout de 5 s: si alguna transacción larga tiene esas tablas, la
--   migración falla entera en vez de quedar en cola bloqueando a todos.
--
-- ---------------------------------------------------------------------
-- Reversibilidad
-- ---------------------------------------------------------------------
-- * Se deshace a mano, en una transacción, con:
--     revoke update (camion_activo_id) on public.miembros from authenticated;
--     drop trigger if exists trg_15_validar_camion_activo on public.miembros;
--     drop function if exists public.fn_validar_camion_activo();
--     drop index if exists public.miembros_camion_activo_idx;
--     alter table public.miembros drop constraint if exists miembros_camion_activo_fk;
--     alter table public.miembros drop column if exists camion_activo_id;
--   Se pierde solo la preferencia de camión activo de cada usuario. El
--   front de la 5c deja de arrancar: volver antes al front anterior.
-- =====================================================================

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1) Columna, FK compuesta e índice
-- ---------------------------------------------------------------------

alter table public.miembros
  add column camion_activo_id uuid null;

alter table public.miembros
  add constraint miembros_camion_activo_fk foreign key (transportista_id, camion_activo_id)
  references public.camiones (transportista_id, id)
  on delete set null (camion_activo_id);

-- Sostiene el SET NULL al borrar un camión (mismo criterio que
-- gastos_transportista_camion_idx de la 010). Parcial: casi todas las filas
-- tienen el camión activo en NULL al principio.
create index miembros_camion_activo_idx
  on public.miembros (transportista_id, camion_activo_id)
  where camion_activo_id is not null;

comment on column public.miembros.camion_activo_id is
  'Camión activo del usuario (preferencia, como tema y color_acento): el que el front propone por defecto en viajes y cargas. NULL = ninguno. Cada usuario cambia solo el suyo (GRANT por columna + policy de fila propia). Tiene que ser un camión de la misma cuenta (miembros_camion_activo_fk, 23503) y, al elegirlo, no estar archivado (55000 camion_archivado; un puntero a un camión que se archivó después se conserva). Borrar el camión lo deja en NULL (ON DELETE SET NULL de esta columna sola).';

-- ---------------------------------------------------------------------
-- 2) Trigger: no se elige un camión archivado
-- ---------------------------------------------------------------------
-- Mismo estilo que los triggers de 002/006 a 010: plpgsql, SECURITY INVOKER,
-- search_path fijo y EXECUTE revocado a public, anon y authenticated (un
-- trigger no necesita que el usuario tenga EXECUTE sobre su función). Solo
-- dispara si el INSERT o el UPDATE nombran camion_activo_id (UPDATE OF), y
-- adentro solo actúa si el valor cambia.

create function public.fn_validar_camion_activo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_activa boolean;
begin
  if new.camion_activo_id is not null
     and (tg_op = 'INSERT' or new.camion_activo_id is distinct from old.camion_activo_id) then
    select c.activa into v_activa
      from public.camiones c
     where c.transportista_id = new.transportista_id and c.id = new.camion_activo_id;
    -- No encontrado (no existe o es de otra cuenta): acá no se dice nada; lo
    -- rechaza la FK compuesta con 23503, igual para los dos casos.
    if v_activa is false then
      raise exception 'El camión está archivado (camion_archivado)'
        using errcode = '55000', hint = 'Reactivalo o elegí otro camión.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_validar_camion_activo() from public, anon, authenticated;

create trigger trg_15_validar_camion_activo
  before insert or update of camion_activo_id on public.miembros
  for each row execute function public.fn_validar_camion_activo();

-- ---------------------------------------------------------------------
-- 3) Permiso: cada usuario cambia su propio camión activo
-- ---------------------------------------------------------------------
-- Queda el UPDATE por columna de authenticated sobre miembros exactamente en
-- (tema, color_acento, camion_activo_id). La fila propia la asegura la policy
-- miembros_update_propia_fila de 003; rol, user_id y transportista_id siguen
-- bloqueados por el GRANT y por fn_bloquear_cambio_rol_directo (002). No se
-- agregan ni se tocan policies.
grant update (camion_activo_id) on public.miembros to authenticated;
