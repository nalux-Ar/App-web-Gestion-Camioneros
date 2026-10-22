-- =====================================================================
-- 017_tour_version_vista.sql — Elan (recorrido de bienvenida: qué versión vio cada usuario)
-- =====================================================================
-- Qué hace (migración ADITIVA): agrega a public.miembros la columna
-- tour_version_vista (smallint, NOT NULL, default 0): la versión del
-- recorrido de bienvenida que el usuario ya vio, sea que lo terminó o que lo
-- saltó. 0 = nunca lo vio. El front tiene su versión actual del recorrido (una
-- constante) y lo muestra si tour_version_vista es menor; al terminarlo o
-- saltarlo guarda esa versión. Si el recorrido suma pasos, el front sube su
-- versión y cada usuario lo vuelve a ver una vez. La ayuda de cada pantalla
-- (el ícono "i") se abre a pedido y no guarda nada.
--
-- Por qué en miembros y no solo en el navegador: es una preferencia del
-- usuario, como tema, color_acento y camion_activo_id; así el recorrido no
-- reaparece en otro dispositivo ni después de borrar los datos del navegador.
-- Misma policy de "solo tu fila" (miembros_update_propia_fila, 003) y mismo
-- GRANT por columna (003, 012). Sin trigger: el CHECK y el NOT NULL alcanzan.
--
-- Orden de aplicación: 17. Requiere 001 a 003 (miembros, la policy
-- miembros_update_propia_fila y los triggers de 002) y 012 (el trigger
-- trg_15_validar_camion_activo que se menciona abajo). El test de aislamiento
-- completo (sección 25 incluida, y el caso 21.3 con la lista de columnas
-- actualizada) asume 001 a 003 y 005 a 017.
--
-- ---------------------------------------------------------------------
-- Despliegue: 017 -> front del recorrido
-- ---------------------------------------------------------------------
-- * El front publicado hoy no cambia nada: lee miembros con una lista
--   explícita de columnas y nunca escribe esta.
-- * El front del recorrido lee la columna al arrancar: si se publica antes de
--   la 017, la lectura de miembros falla y la app no arranca.
-- * Después de aplicar: regenerar src/lib/database.types.ts.
--
-- ---------------------------------------------------------------------
-- Contrato con el front
-- ---------------------------------------------------------------------
-- * Leer: tour_version_vista en la lectura de miembros del arranque.
-- * Marcar visto (al terminar o al saltar), sin bajar nunca la versión:
--     update miembros set tour_version_vista = <versión del front>
--      where user_id = <el propio> and tour_version_vista < <versión del front>
--   (supabase-js: .update(...).eq('user_id', id).lt('tour_version_vista', v)).
--   0 filas = ya tenía esa versión o una mayor: no es un error.
-- * Errores: 23514 miembros_tour_version_vista_chk (fuera de 0 a 1000),
--   23502 (NULL), 42501 si el UPDATE nombra una columna sin GRANT. El UPDATE
--   de la fila de otro usuario afecta 0 filas (policy de 003).
--
-- ---------------------------------------------------------------------
-- Filas existentes, triggers y funciones
-- ---------------------------------------------------------------------
-- * Las filas existentes y las nuevas quedan en 0: todos (también la cuenta
--   ya existente) ven el recorrido una vez. No hay relleno.
-- * create_transportista y cambiar_rol_miembro no cambian (no nombran la
--   columna). trg_10_bloquear_cambio_rol no la mira,
--   trg_15_validar_camion_activo solo corre con UPDATE OF camion_activo_id y
--   trg_20_set_updated_at avanza updated_at también al marcar el recorrido.
-- * Desde el panel (como postgres) se puede volver a 0 para que un usuario
--   vea el recorrido otra vez: no hay nada que impida bajarla.
--
-- ---------------------------------------------------------------------
-- Locks y reversibilidad
-- ---------------------------------------------------------------------
-- * ADD COLUMN con default constante no reescribe la tabla (solo catálogo),
--   pero toma ACCESS EXCLUSIVE sobre miembros hasta el COMMIT, y miembros se
--   lee en cada request: unos milisegundos. El CHECK se valida al agregarlo
--   (recorre las pocas filas existentes). lock_timeout de 5 s, como las
--   anteriores.
-- * Se deshace a mano, en una transacción:
--     revoke update (tour_version_vista) on public.miembros from authenticated;
--     alter table public.miembros drop column if exists tour_version_vista;
--   Se pierde solo qué versión del recorrido vio cada usuario. Antes, volver
--   al front anterior (el del recorrido no arranca sin la columna).
-- =====================================================================

set local lock_timeout = '5s';

alter table public.miembros
  add column tour_version_vista smallint not null default 0
  constraint miembros_tour_version_vista_chk check (tour_version_vista between 0 and 1000);

comment on column public.miembros.tour_version_vista is
  'Versión del recorrido de bienvenida que el usuario ya vio (lo terminó o lo saltó). 0 = nunca. El front lo muestra si es menor que su versión actual. Lo cambia solo el propio usuario (GRANT por columna + policy de 003). Ver 017.';

grant update (tour_version_vista) on public.miembros to authenticated;
