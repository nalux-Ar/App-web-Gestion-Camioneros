-- =====================================================================
-- 003_rls.sql — Elan (Bloque A: Row Level Security + privilegios)
-- =====================================================================
-- Qué hace: activa RLS en TODAS las tablas de public, revoca los
-- privilegios "ALL" que Supabase otorga por default a anon/authenticated
-- en cada tabla nueva, otorga explícitamente solo lo que corresponde
-- (incluyendo privilegios por columna en transportistas/miembros) y
-- define las policies de aislamiento por tenant.
--
-- Orden de aplicación: 3 de 3 (último). Requiere 001_schema.sql y
-- 002_functions.sql ya aplicados (las policies usan
-- get_mi_transportista_id()).
--
-- Convenciones:
-- * Todas las policies van "to authenticated" y usan
--   (select get_mi_transportista_id()) / (select auth.uid()) —con SELECT
--   envolvente— para que Postgres las evalúe una sola vez por query
--   (recomendación de performance de Supabase), no una vez por fila.
-- * Al principio se repiten el "enable row level security" y el
--   "revoke all ... from anon, authenticated" que ya corrieron al final
--   de 001_schema.sql (son idempotentes). Es a propósito: así este
--   archivo se puede leer/aplicar de forma autocontenida sin tener que
--   ir a buscar ese bloque a 001.
-- * anon no tiene NINGÚN privilegio sobre estas tablas: no hay flujo
--   anónimo en esta app, todo dato de negocio requiere sesión.
-- * transportistas y miembros NO tienen policy de INSERT ni de DELETE:
--   la única vía para crear filas ahí es create_transportista()
--   (SECURITY DEFINER, corre como dueño de la función, no necesita
--   privilegios de tabla del rol authenticated). Tampoco hay GRANT de
--   INSERT/DELETE sobre esas dos tablas para authenticated: doble
--   candado (grant + policy).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enable RLS en todas las tablas de public
-- ---------------------------------------------------------------------

alter table public.transportistas enable row level security;
alter table public.miembros enable row level security;
alter table public.camiones enable row level security;
alter table public.clientes enable row level security;
alter table public.viajes enable row level security;
alter table public.entregas enable row level security;
alter table public.devoluciones enable row level security;
alter table public.categorias_gasto enable row level security;
alter table public.gastos enable row level security;

-- ---------------------------------------------------------------------
-- Limpieza de privilegios por default (Supabase otorga ALL a anon y
-- authenticated en cada tabla nueva de public vía default privileges).
-- Arrancamos de cero y otorgamos explícitamente lo que corresponde.
-- ---------------------------------------------------------------------

revoke all on public.transportistas from anon, authenticated;
revoke all on public.miembros from anon, authenticated;
revoke all on public.camiones from anon, authenticated;
revoke all on public.clientes from anon, authenticated;
revoke all on public.viajes from anon, authenticated;
revoke all on public.entregas from anon, authenticated;
revoke all on public.devoluciones from anon, authenticated;
revoke all on public.categorias_gasto from anon, authenticated;
revoke all on public.gastos from anon, authenticated;

-- anon no recibe ningún GRANT sobre ninguna de estas tablas: queda sin
-- ningún privilegio (ítem 8 del test de aislamiento).

-- transportistas: SELECT de la propia (via policy); UPDATE de una sola
-- columna (nombre), y solo si sos admin (via policy). Sin INSERT/DELETE.
grant select on public.transportistas to authenticated;
grant update (nombre) on public.transportistas to authenticated;

-- miembros: SELECT de los miembros de tu tenant; UPDATE de tema/color_acento
-- únicamente (nunca rol, user_id ni transportista_id vía grant de columna).
-- Sin INSERT/DELETE.
grant select on public.miembros to authenticated;
grant update (tema, color_acento) on public.miembros to authenticated;

-- Tablas de negocio "normales": CRUD completo a nivel de grant, el
-- aislamiento fila-por-fila lo resuelven las policies + los triggers de
-- 002 (transportista_id no se puede falsear ni cambiar aunque el grant
-- de columna sea amplio).
grant select, insert, update, delete on public.camiones to authenticated;
grant select, insert, update, delete on public.clientes to authenticated;
grant select, insert, update, delete on public.viajes to authenticated;
grant select, insert, update, delete on public.entregas to authenticated;
grant select, insert, update, delete on public.devoluciones to authenticated;
grant select, insert, update, delete on public.categorias_gasto to authenticated;
grant select, insert, update, delete on public.gastos to authenticated;

-- ---------------------------------------------------------------------
-- Policies: transportistas
-- ---------------------------------------------------------------------

create policy "transportistas_select_propia"
  on public.transportistas
  for select
  to authenticated
  using (id = (select public.get_mi_transportista_id()));

-- Update del nombre solo si sos admin del propio transportista. No hay
-- policy de insert ni de delete (y tampoco grant): comando bloqueado.
create policy "transportistas_update_nombre_admin"
  on public.transportistas
  for update
  to authenticated
  using (
    id = (select public.get_mi_transportista_id())
    and exists (
      select 1 from public.miembros m
      where m.user_id = (select auth.uid())
        and m.transportista_id = transportistas.id
        and m.rol = 'admin'
    )
  )
  with check (id = (select public.get_mi_transportista_id()));

-- ---------------------------------------------------------------------
-- Policies: miembros
-- ---------------------------------------------------------------------

create policy "miembros_select_mi_tenant"
  on public.miembros
  for select
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()));

-- Update de la fila propia únicamente (el grant de columna ya limita a
-- tema/color_acento; el trigger fn_bloquear_cambio_rol_directo es la
-- segunda barrera contra auto-promoción). No hay policy de insert ni
-- de delete: esas filas solo las crea create_transportista().
create policy "miembros_update_propia_fila"
  on public.miembros
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Policies: tablas de negocio con aislamiento simple por tenant
-- ---------------------------------------------------------------------

create policy "camiones_tenant_isolation"
  on public.camiones
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()))
  with check (transportista_id = (select public.get_mi_transportista_id()));

create policy "clientes_tenant_isolation"
  on public.clientes
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()))
  with check (transportista_id = (select public.get_mi_transportista_id()));

create policy "viajes_tenant_isolation"
  on public.viajes
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()))
  with check (transportista_id = (select public.get_mi_transportista_id()));

create policy "entregas_tenant_isolation"
  on public.entregas
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()))
  with check (transportista_id = (select public.get_mi_transportista_id()));

create policy "devoluciones_tenant_isolation"
  on public.devoluciones
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()))
  with check (transportista_id = (select public.get_mi_transportista_id()));

create policy "gastos_tenant_isolation"
  on public.gastos
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()))
  with check (transportista_id = (select public.get_mi_transportista_id()));

-- ---------------------------------------------------------------------
-- Policies: categorias_gasto (caso especial)
-- ---------------------------------------------------------------------
-- SELECT: globales (transportista_id is null) + propias.
-- INSERT/UPDATE/DELETE: solo propias, nunca globales ni de otro tenant.
--
-- OJO: el brief original sugería una sola policy
--   "for insert, update, delete" — eso NO es sintaxis válida de
-- Postgres: CREATE POLICY acepta un solo comando por policy (ALL,
-- SELECT, INSERT, UPDATE o DELETE), y además INSERT no admite USING
-- (solo WITH CHECK) mientras que DELETE no admite WITH CHECK (solo
-- USING). Por eso van 4 policies separadas.
-- ---------------------------------------------------------------------

create policy "categorias_gasto_select"
  on public.categorias_gasto
  for select
  to authenticated
  using (
    transportista_id is null
    or transportista_id = (select public.get_mi_transportista_id())
  );

-- El trigger fn_forzar_transportista_id (002) ya garantiza que todo
-- INSERT de un authenticated termina con transportista_id = su propio
-- tenant (nunca NULL). Este WITH CHECK queda como defensa adicional y,
-- sobre todo, como documentación explícita de la regla "nunca una
-- categoría global vía INSERT directo".
create policy "categorias_gasto_insert"
  on public.categorias_gasto
  for insert
  to authenticated
  with check (transportista_id = (select public.get_mi_transportista_id()));

create policy "categorias_gasto_update"
  on public.categorias_gasto
  for update
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()))
  with check (transportista_id = (select public.get_mi_transportista_id()));

create policy "categorias_gasto_delete"
  on public.categorias_gasto
  for delete
  to authenticated
  using (transportista_id = (select public.get_mi_transportista_id()));
