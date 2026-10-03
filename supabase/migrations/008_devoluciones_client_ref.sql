-- =====================================================================
-- 008_devoluciones_client_ref.sql — Elan (Bloque C, Etapa 4: Devoluciones)
-- =====================================================================
-- Qué hace: agrega a public.devoluciones la columna opcional client_ref
-- (uuid) con un índice único parcial por tenant, y un trigger que la
-- vuelve inmutable después del INSERT. Es el mismo patrón que gastos (006)
-- y viajes (007). Sirve para que un reintento manual del usuario no
-- duplique una devolución.
--
-- Problema que resuelve: el front guarda cada devolución con retry: 0 y el
-- usuario reintenta a mano. Si el primer INSERT llegó a la base pero la
-- respuesta se perdió (mala señal en ruta), el reintento crearía una
-- segunda devolución igual. El id no sirve de clave de idempotencia: el
-- trigger fn_forzar_transportista_id (002) lo pisa en cada INSERT a
-- propósito (evita el oráculo de existencia por PK entre tenants).
--
-- Orden de aplicación: 8. Requiere 001_schema.sql, 002_functions.sql y
-- 003_rls.sql ya aplicados (usa la tabla devoluciones y el naming de
-- triggers de 002). 004 a 007 no son dependencia, pero el test de
-- aislamiento completo (sección 17 incluida) asume 001 a 003 y 005 a 008.
--
-- Cómo se usa desde el front:
-- * Genera un uuid al abrir el formulario de devolución, lo manda como
--   client_ref, lo mantiene igual en cada "Reintentar" y lo regenera
--   recién después de guardar bien (o al abrir un formulario nuevo).
-- * La devolución se guarda con un INSERT directo (no hay función de base
--   para esto: es una sola fila). Si el INSERT falla con 23505 y el
--   constraint es devoluciones_transportista_client_ref_uidx, la devolución
--   ya estaba guardada: se trata como éxito. Si hace falta el id (o el
--   usuario cambió datos entre intentos), se hace un UPDATE por client_ref
--   con los datos actuales.
-- * Por eso va INSERT + manejo del 23505 y NUNCA upsert: el índice es
--   PARCIAL (where client_ref is not null) y el on_conflict de PostgREST
--   solo recibe nombres de columna (no el predicado del índice), así que
--   un upsert por (transportista_id, client_ref) falla con 42P10.
--
-- Notas de diseño:
-- * Sin oráculo de existencia entre tenants: el índice es por
--   (transportista_id, client_ref) y fn_forzar_transportista_id fija
--   transportista_id ANTES de que se evalúe el índice (los triggers
--   BEFORE INSERT corren primero), aunque el cliente mande el de otro
--   tenant. Un 23505 solo puede ser contra una fila del PROPIO tenant;
--   mandar un client_ref que ya usó otro tenant simplemente funciona.
--   Además, con RLS activo Postgres no incluye en el error el DETAIL con
--   los valores de la clave.
-- * client_ref es inmutable (trigger trg_25_bloquear_cambio_client_ref):
--   un UPDATE que lo cambie falla, incluidos NULL -> valor y valor ->
--   NULL. Motivo: es la clave con la que el front reconoce "esta
--   devolución ya la guardé"; si se pudiera reescribir, un reintento
--   podría duplicar o pisar otra devolución. Igual que fn_bloquear_cambio_
--   transportista_id, no hay excepción para postgres/service_role: si
--   algún día hace falta corregir un client_ref a mano, se hace con el
--   trigger deshabilitado dentro de una transacción de mantenimiento.
-- * Sin cambios de RLS, policies ni grants: el GRANT de tabla de 003
--   cubre la columna nueva y la policy devoluciones_tenant_isolation
--   filtra por fila (por tenant, no por rol: el chofer también guarda).
-- * Filas existentes: client_ref queda NULL y las filas con NULL no
--   participan del índice parcial. Agregar una columna nullable sin
--   default no reescribe la tabla, pero el ALTER TABLE toma un lock
--   ACCESS EXCLUSIVE y, como el CREATE UNIQUE INDEX va en la misma
--   transacción, ese lock se mantiene durante toda la construcción del
--   índice: bloquea lecturas Y escrituras de devoluciones mientras dura.
--   Con el volumen actual (tabla vacía o de pocas filas) es irrelevante.
--   CREATE INDEX CONCURRENTLY no puede correr dentro de la transacción de
--   la migración.
-- * No se agrega nada más a la tabla (ni columnas ni checks): en
--   particular la base NO exige que el cliente de la devolución tenga una
--   entrega en ese viaje. Es una decisión de producto: el front ofrece
--   primero los clientes del viaje pero permite elegir "Otros clientes".
--   La FK compuesta de 001 sigue exigiendo que viaje y cliente sean del
--   propio tenant.
-- * Función propia para devoluciones (no se generaliza la de gastos de 006
--   ni la de viajes de 007: ya están aplicadas y sus mensajes nombran a
--   cada entidad).
-- * Después de aplicar: regenerar src/lib/database.types.ts.
-- =====================================================================

alter table public.devoluciones
  add column client_ref uuid null;

-- Único por tenant. Parcial: las filas sin client_ref (las existentes, y
-- cualquiera cargada sin él) no compiten por el índice.
create unique index devoluciones_transportista_client_ref_uidx
  on public.devoluciones (transportista_id, client_ref)
  where client_ref is not null;

comment on column public.devoluciones.client_ref is
  'Clave de idempotencia generada por el front (un uuid al abrir el formulario de devolución; se mantiene en cada reintento y se regenera tras guardar bien). Única por tenant e inmutable. Se usa con INSERT directo: si falla con 23505 y constraint devoluciones_transportista_client_ref_uidx, la devolución ya estaba guardada y el front lo trata como éxito (y, si el usuario cambió datos entre intentos, hace un UPDATE por client_ref con los datos actuales). El índice es parcial, por eso no sirve para upsert de PostgREST (42P10): se usa INSERT + manejo del 23505. No hay oráculo de existencia entre tenants.';

-- ---------------------------------------------------------------------
-- Trigger: client_ref no se puede cambiar después del INSERT
-- ---------------------------------------------------------------------
-- Mismo estilo que fn_bloquear_cambio_transportista_id (002): plpgsql,
-- SECURITY INVOKER, search_path fijo y EXECUTE revocado a public, anon y
-- authenticated (no hace falta: un trigger no necesita que el usuario
-- tenga EXECUTE sobre su función).
--
-- Orden de disparo (los BEFORE de un mismo evento corren por nombre):
-- trg_20_bloquear_cambio_transportista_id -> trg_25_bloquear_cambio_client_ref
-- -> trg_30_set_updated_at.
-- Es independiente de los demás; queda antes de updated_at para que un
-- UPDATE rechazado no toque nada.

create function public.fn_bloquear_cambio_client_ref_devolucion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.client_ref is distinct from old.client_ref then
    raise exception 'No se puede cambiar el client_ref de una devolución existente'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_bloquear_cambio_client_ref_devolucion() from public, anon, authenticated;

create trigger trg_25_bloquear_cambio_client_ref
  before update on public.devoluciones
  for each row execute function public.fn_bloquear_cambio_client_ref_devolucion();
