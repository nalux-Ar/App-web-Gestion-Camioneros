-- =====================================================================
-- 013_bloquear_cambio_de_id.sql — Elan (endurecimiento: hallazgo H1 de la auditoría de la Etapa 5c)
-- =====================================================================
-- Qué hace: reemplaza el cuerpo de public.fn_bloquear_cambio_transportista_id()
-- (002) para que, además de impedir cambiar transportista_id, impida cambiar
-- el id de una fila existente. Misma función, misma firma: los triggers
-- trg_20_bloquear_cambio_transportista_id de las 7 tablas de negocio
-- (camiones, categorias_gasto, clientes, devoluciones, entregas, gastos y
-- viajes) siguen enganchados a ella y no se tocan.
--
-- Por qué (hallazgo H1): 003 da UPDATE de tabla entera a authenticated en
-- las tablas de negocio, y el trigger solo comparaba transportista_id. Un
-- usuario podía reescribir el id de sus propias filas. Si el uuid nuevo ya
-- existía en esa tabla en CUALQUIER cuenta, Postgres respondía 23505
-- (<tabla>_pkey); si no, el UPDATE andaba y el id cambiaba. Era un oráculo de
-- existencia entre cuentas por UPDATE, el mismo que la 002 ya había cerrado
-- para INSERT (fn_forzar_transportista_id pisa el id). Severidad baja: hace
-- falta conocer un uuid candidato y no devuelve datos. Existía desde el
-- Bloque A. En miembros y transportistas no pasa: el GRANT por columna de
-- 003/012 no incluye id (42501 por permiso, antes de ejecutar nada).
--
-- Orden de aplicación: 13. Requiere 001 a 003 (la función y sus triggers);
-- no depende de 005 a 012. El test de aislamiento completo (sección 22
-- incluida) asume 001 a 003 y 005 a 013.
--
-- ---------------------------------------------------------------------
-- Contrato
-- ---------------------------------------------------------------------
-- * UPDATE que cambia el id de una fila de cualquiera de las 7 tablas:
--   42501 "No se puede cambiar el id de un registro existente". Sin
--   constraint, detalle ni hint, y sin ningún dato de la fila ni del uuid:
--   el error es EXACTAMENTE el mismo si el uuid nuevo no existe, si es de
--   una fila de otra cuenta, si es de otra fila propia o si es NULL
--   ("is distinct from" cubre el NULL). Ya no hay 23505 posible por la PK.
-- * "set id = id" (el mismo valor) no falla: no es un cambio.
-- * transportista_id sigue igual: 42501 "No se puede cambiar el
--   transportista_id de un registro existente" (se chequea primero; si un
--   UPDATE cambia las dos cosas, sale ese).
-- * Ningún flujo de la app cambia un id: el front edita por UPDATE con
--   updatePayload, que quita id (y transportista_id, timestamps y
--   client_ref) aunque vengan en el objeto; las funciones
--   crear_viaje_con_entregas, actualizar_viaje_con_entregas y crear_camion,
--   el relleno de la 011 y los triggers de la 010 (default, validación y
--   propagación) nunca escriben id. Tampoco el front congelado de la rama
--   piloto (commit d1130bc), que usa el mismo updatePayload.
-- * Toda tabla que use este trigger tiene que tener columna id (las 7 la
--   tienen). Una tabla futura sin id necesita su propia función.
--
-- ---------------------------------------------------------------------
-- Orden de evaluación
-- ---------------------------------------------------------------------
-- * Los triggers BEFORE ROW corren antes que todo lo demás del UPDATE: el
--   WITH CHECK de RLS, los CHECK y NOT NULL, la unicidad (que se comprueba al
--   insertar en los índices, y ahí salía el 23505) y las FK (que se
--   comprueban al final de la sentencia). Por eso el rechazo llega antes de
--   cualquier chequeo que pueda depender de si el uuid existe.
-- * Entre los BEFORE UPDATE de cada tabla (corren por nombre),
--   trg_20_bloquear_cambio_transportista_id es el primero en 6 de las 7. En
--   gastos lo precede trg_15_validar_categoria_gasto (002), que valida
--   categoria_id contra el tenant de la fila y no mira el id: su respuesta
--   no depende del uuid nuevo, así que no reabre el oráculo. Los demás
--   (trg_21/trg_22 de la 010, trg_25 de client_ref, trg_30 de updated_at)
--   corren después. Un trigger futuro que corra antes de trg_20 en estas
--   tablas no puede responder distinto según new.id (la sección 22 del test
--   de aislamiento lo controla).
--
-- ---------------------------------------------------------------------
-- Contextos de confianza
-- ---------------------------------------------------------------------
-- * Igual que con transportista_id, no hay excepción: el cambio de id se
--   rechaza para todos, también como postgres o service_role.
-- * Salida de emergencia (mantenimiento, previa confirmación escrita): como
--   dueño de la tabla y dentro de UNA transacción,
--     alter table public.<tabla> disable trigger trg_20_bloquear_cambio_transportista_id;
--     update public.<tabla> set id = '<nuevo>' where id = '<viejo>';
--     alter table public.<tabla> enable trigger trg_20_bloquear_cambio_transportista_id;
--   El DISABLE/ENABLE toma un lock SHARE ROW EXCLUSIVE sobre esa tabla hasta
--   el final de la transacción. Las FK siguen valiendo (ON UPDATE NO ACTION):
--   un id que otra fila referencia no se puede cambiar así.
--
-- ---------------------------------------------------------------------
-- Locks, filas existentes y reversibilidad
-- ---------------------------------------------------------------------
-- * CREATE OR REPLACE FUNCTION no toma locks sobre las tablas que usan la
--   función (comprobado en PGlite con pg_locks): solo actualiza su fila en
--   pg_proc. Las otras sesiones toman el cuerpo nuevo en su próxima llamada
--   después del COMMIT. El lock_timeout es por consistencia con 010 a 012
--   (cubre un reemplazo simultáneo de la misma función).
-- * Reemplazar conserva el dueño y los privilegios. Igual se repite el
--   REVOKE de EXECUTE (idempotente), para que quede explícito que nadie más
--   que el dueño (y service_role, como en 002) la ejecuta directamente.
-- * No cambia datos, columnas ni tipos: no hay que regenerar
--   src/lib/database.types.ts ni hace falta una copia previa.
-- * Se deshace a mano, en una transacción, volviendo al cuerpo de 002:
--     create or replace function public.fn_bloquear_cambio_transportista_id()
--     returns trigger
--     language plpgsql
--     set search_path = public
--     as $$
--     begin
--       if new.transportista_id is distinct from old.transportista_id then
--         raise exception 'No se puede cambiar el transportista_id de un registro existente'
--           using errcode = '42501';
--       end if;
--       return new;
--     end;
--     $$;
--     comment on function public.fn_bloquear_cambio_transportista_id() is null;
-- =====================================================================

set local lock_timeout = '5s';

create or replace function public.fn_bloquear_cambio_transportista_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.transportista_id is distinct from old.transportista_id then
    raise exception 'No se puede cambiar el transportista_id de un registro existente'
      using errcode = '42501';
  end if;
  -- El id de una fila existente tampoco cambia (hallazgo H1). "is distinct
  -- from" cubre el NULL. El mensaje no lleva ningún dato de la fila ni del
  -- uuid: es el mismo error exista o no el uuid nuevo, y sea de la cuenta que
  -- sea.
  if new.id is distinct from old.id then
    raise exception 'No se puede cambiar el id de un registro existente'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.fn_bloquear_cambio_transportista_id() is
  'Trigger BEFORE UPDATE (trg_20) de camiones, categorias_gasto, clientes, devoluciones, entregas, gastos y viajes: rechaza con 42501 cambiar transportista_id (002) o id (013) de una fila existente, para todos los roles. El error de id no lleva datos de la fila ni del uuid (cierra el oráculo de existencia por la PK).';

revoke execute on function public.fn_bloquear_cambio_transportista_id() from public, anon, authenticated;
