-- =====================================================================
-- aislamiento.sql — Elan (Bloque A: test de aislamiento multi-tenant)
-- =====================================================================
-- Qué hace: crea 2 tenants (A y B) más un chofer en A y un usuario sin
-- tenant, y verifica —simulando cada usuario con set local role +
-- request.jwt.claims— que el aislamiento entre tenants, el anti
-- auto-promoción de rol y las FK anti-referencia-cruzada funcionan. Las
-- secciones 11 a 17 cubren además las migraciones 005 a 008, el vínculo
-- gasto <-> viaje de la Etapa 3 (que no tiene migración propia) y las
-- devoluciones de la Etapa 4 (la 008 agrega su client_ref).
--
-- Cómo correrlo: pegar el archivo ENTERO en el SQL Editor de Supabase
-- (conectado como el rol `postgres`) y ejecutarlo de una sola vez,
-- DESPUÉS de aplicar 001_schema.sql, 002_functions.sql, 003_rls.sql,
-- 005_gastos_combustible.sql, 006_gastos_client_ref.sql,
-- 007_viajes_client_ref_y_funciones.sql y 008_devoluciones_client_ref.sql
-- (las secciones 11 a 17 usan sus columnas y funciones; la 16 no necesita
-- ninguna migración propia; la 004 no hace falta para este test). NO agregar
-- BEGIN/COMMIT: el SQL Editor ya manda todo
-- el script como una única simple-query, que Postgres envuelve
-- automáticamente en una transacción implícita. El bloque final SIEMPRE
-- lanza una excepción a propósito (pasen o no los tests) para forzar el
-- ROLLBACK de esa transacción: el script NO deja ni un dato en la base,
-- ni usuarios de prueba en auth.users, pase lo que pase.
--
-- Cómo leer el resultado: mirar el mensaje de error final devuelto por
-- el SQL Editor.
--   "OK: N/N tests pasaron — este error es intencional, fuerza el ROLLBACK"
--     -> todos los tests pasaron, no hay que hacer nada más.
--   "FALLARON k tests: <lista de casos con su detalle>"
--     -> hay que revisar las migraciones antes de dar el bloque por bueno.
-- Cualquier OTRO error (uno que no empiece con "OK:" ni "FALLARON")
-- significa que el script se rompió antes de llegar al resumen final
-- (typo, migración no aplicada, etc.) — también hace ROLLBACK solo, pero
-- hay que leer el mensaje real de Postgres para diagnosticarlo.
--
-- Los tests que esperan que "algo falle" (RLS, triggers, grants) usan
-- bloques DO con BEGIN/EXCEPTION: plpgsql crea un savepoint implícito
-- en cada bloque, así que un fallo esperado (o inesperado) en un caso
-- no aborta el resto del script.
--
-- OJO — sección 10 (la única que toca la sesión; le siguen las secciones 11 a 17 y el resumen): intenta
-- simular de verdad cómo se conecta PostgREST (rol 'authenticator', con
-- SET ROLE por request) usando SET SESSION AUTHORIZATION, pero SOLO si
-- el rol con el que está conectado el SQL Editor es superuser. En
-- Supabase alojado, `postgres` NO es superuser, así que ese caso puntual
-- queda OMITIDO ahí mismo (sin tocar la sesión) y registrado como OK con
-- el motivo en el detalle — el escenario real queda cubierto por la
-- validación con PGlite, que sí corre como superuser. Si alguna vez esto
-- se corre contra un Postgres/Supabase local donde `postgres` SÍ es
-- superuser, el bloque restaura la sesión a su identidad original
-- (`reset role` + `set session authorization <usuario original>`) apenas termina, tanto
-- si el test pasa como si tira una excepción inesperada — la conexión
-- del SQL Editor nunca debería quedar "gastada".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Infraestructura del test (se cae sola con el ROLLBACK final)
-- ---------------------------------------------------------------------

create temporary table _test_resultados (
  id serial primary key,
  caso text not null,
  ok boolean not null,
  detalle text
);

create temporary table _test_ctx (
  clave text primary key,
  valor text
);

-- security definer + search_path con pg_temp primero: estas 3 funciones
-- las vamos a llamar impersonando authenticated/anon (después de "set
-- local role"), y esos roles no tienen ningún privilegio sobre las
-- tablas temporales de este script (las creó postgres). SECURITY
-- DEFINER hace que siempre corran con los privilegios de postgres,
-- sin importar qué rol esté activo en la sesión en ese momento.
create or replace function public._test_chk(p_caso text, p_ok boolean, p_detalle text default null)
returns void language plpgsql security definer set search_path = pg_temp, public as $$
begin
  -- coalesce: una condición que da NULL (p.ej. porque faltó un dato) cuenta como fallo.
  insert into _test_resultados (caso, ok, detalle) values (p_caso, coalesce(p_ok, false), p_detalle);
end;
$$;

create or replace function public._test_set(p_clave text, p_valor text)
returns void language plpgsql security definer set search_path = pg_temp, public as $$
begin
  insert into _test_ctx (clave, valor) values (p_clave, p_valor)
    on conflict (clave) do update set valor = excluded.valor;
end;
$$;

create or replace function public._test_get(p_clave text)
returns text language sql security definer set search_path = pg_temp, public as $$
  select valor from _test_ctx where clave = p_clave
$$;

-- El resumen final (sección 9) también va por SECURITY DEFINER, definida
-- ACÁ (todavía como postgres). El test de la sección 10 ahora siempre
-- restaura la sesión a su identidad original apenas termina (o la omite
-- directamente si no es superuser), así que en el camino normal esto ya
-- no haría falta — se deja como red de seguridad nomás: si algún día ese
-- restore fallara por lo que sea, el resumen final igual puede leer
-- _test_resultados sin depender de qué rol haya quedado activo.
create or replace function public._test_resumen()
returns void language plpgsql security definer set search_path = pg_temp, public as $$
declare
  v_total int;
  v_fail int;
  v_lista text;
begin
  select count(*) into v_total from _test_resultados;
  select count(*) into v_fail from _test_resultados where not ok;
  select string_agg(caso || ' :: ' || coalesce(detalle, '(sin detalle)'), E'\n' order by id)
    into v_lista
    from _test_resultados where not ok;

  if v_fail = 0 then
    raise exception 'OK: %/% tests pasaron — este error es intencional, fuerza el ROLLBACK', v_total, v_total;
  else
    raise exception E'FALLARON % tests:\n%', v_fail, v_lista;
  end if;
end;
$$;

-- UUIDs fijos de los usuarios de prueba.
select public._test_set('uid_a_admin',   'aaaaaaaa-0000-0000-0000-000000000001');
select public._test_set('uid_a_chofer',  'aaaaaaaa-0000-0000-0000-000000000002');
select public._test_set('uid_b_admin',   'bbbbbbbb-0000-0000-0000-000000000001');
select public._test_set('uid_sin_tenant','cccccccc-0000-0000-0000-000000000001');

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', (public._test_get('uid_a_admin'))::uuid,    'authenticated','authenticated','admin-a@test.elan'),
  ('00000000-0000-0000-0000-000000000000', (public._test_get('uid_a_chofer'))::uuid,   'authenticated','authenticated','chofer-a@test.elan'),
  ('00000000-0000-0000-0000-000000000000', (public._test_get('uid_b_admin'))::uuid,    'authenticated','authenticated','admin-b@test.elan'),
  ('00000000-0000-0000-0000-000000000000', (public._test_get('uid_sin_tenant'))::uuid, 'authenticated','authenticated','sintenant@test.elan');

-- ---------------------------------------------------------------------
-- 1) Onboarding: A y B crean su transportista vía create_transportista()
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

with ins as (
  select public.create_transportista('Transportes A SRL') as id
)
select public._test_set('tenant_a_id', id::text) from ins;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

with ins as (
  select public.create_transportista('Transportes B SRL') as id
)
select public._test_set('tenant_b_id', id::text) from ins;

reset role;

-- Chofer de A: insertado directo por postgres (no hay flujo de invitación todavía).
insert into public.miembros (user_id, transportista_id, rol)
values ((public._test_get('uid_a_chofer'))::uuid, (public._test_get('tenant_a_id'))::uuid, 'chofer');

do $$
begin
  perform public._test_chk(
    '0.1 setup: create_transportista devolvió ids distintos para A y B',
    public._test_get('tenant_a_id') is not null
      and public._test_get('tenant_b_id') is not null
      and public._test_get('tenant_a_id') <> public._test_get('tenant_b_id')
  );
end
$$;

-- ---------------------------------------------------------------------
-- 2) Datos de prueba en A (como admin de A) y en B (como admin de B)
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

with ins as (insert into public.clientes (nombre, contacto_telefono) values ('Cliente A', '111') returning id)
select public._test_set('cliente_a_id', id::text) from ins;

with ins as (insert into public.camiones (patente, marca, modelo, anio) values ('AA111AA', 'Ford', 'Cargo', 2015) returning id)
select public._test_set('camion_a_id', id::text) from ins;

with ins as (
  insert into public.viajes (origen, destino, camion_id)
  values ('Rosario', 'Córdoba', (public._test_get('camion_a_id'))::uuid)
  returning id
)
select public._test_set('viaje_a_id', id::text) from ins;

with ins as (
  insert into public.entregas (viaje_id, cliente_id, incidencias)
  values ((public._test_get('viaje_a_id'))::uuid, (public._test_get('cliente_a_id'))::uuid, null)
  returning id
)
select public._test_set('entrega_a_id', id::text) from ins;

with ins as (
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
  values ((public._test_get('viaje_a_id'))::uuid, (public._test_get('cliente_a_id'))::uuid, 'otro', 'prueba')
  returning id
)
select public._test_set('devolucion_a_id', id::text) from ins;

with ins as (insert into public.categorias_gasto (nombre) values ('Categoría Propia A') returning id)
select public._test_set('categoria_a_id', id::text) from ins;

select public._test_set('categoria_global_peajes_id',
  (select id::text from public.categorias_gasto where transportista_id is null and nombre = 'Peajes'));
select public._test_set('categoria_global_combustible_id',
  (select id::text from public.categorias_gasto where transportista_id is null and nombre = 'Combustible'));

with ins as (
  insert into public.gastos (categoria_id, monto, viaje_id)
  values ((public._test_get('categoria_global_peajes_id'))::uuid, 1000, (public._test_get('viaje_a_id'))::uuid)
  returning id
)
select public._test_set('gasto_a_id', id::text) from ins;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

with ins as (insert into public.clientes (nombre) values ('Cliente B') returning id)
select public._test_set('cliente_b_id', id::text) from ins;

with ins as (insert into public.camiones (patente, marca, modelo, anio) values ('BB222BB', 'Iveco', 'Tector', 2018) returning id)
select public._test_set('camion_b_id', id::text) from ins;

with ins as (
  insert into public.viajes (origen, destino, camion_id)
  values ('Santa Fe', 'Buenos Aires', (public._test_get('camion_b_id'))::uuid)
  returning id
)
select public._test_set('viaje_b_id', id::text) from ins;

reset role;

do $$
begin
  perform public._test_chk('0.2 setup: datos base de A y B creados sin excepciones', true);
exception when others then
  perform public._test_chk('0.2 setup: datos base de A y B creados sin excepciones', false, sqlerrm);
end
$$;

-- ---------------------------------------------------------------------
-- 1) AISLAMIENTO TOTAL: B no ve ni puede tocar nada de A (y viceversa)
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.transportistas;
  perform public._test_chk('1.1 B ve exactamente 1 transportista (el propio)', v_n = 1, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.transportistas where id = (public._test_get('tenant_a_id'))::uuid;
  perform public._test_chk('1.2 B no ve el transportista de A', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.miembros;
  perform public._test_chk('1.3 B ve exactamente 1 miembro (el propio)', v_n = 1, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.miembros where transportista_id = (public._test_get('tenant_a_id'))::uuid;
  perform public._test_chk('1.4 B no ve miembros de A', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.clientes where id = (public._test_get('cliente_a_id'))::uuid;
  perform public._test_chk('1.5 B no ve el cliente de A', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.camiones where id = (public._test_get('camion_a_id'))::uuid;
  perform public._test_chk('1.6 B no ve el camión de A', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.viajes where id = (public._test_get('viaje_a_id'))::uuid;
  perform public._test_chk('1.7 B no ve el viaje de A', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.entregas where id = (public._test_get('entrega_a_id'))::uuid;
  perform public._test_chk('1.8 B no ve la entrega de A', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.devoluciones where id = (public._test_get('devolucion_a_id'))::uuid;
  perform public._test_chk('1.9 B no ve la devolución de A', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.gastos where id = (public._test_get('gasto_a_id'))::uuid;
  perform public._test_chk('1.10 B no ve el gasto de A', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.categorias_gasto where id = (public._test_get('categoria_a_id'))::uuid;
  perform public._test_chk('1.11 B no ve la categoría propia de A', v_n = 0, 'vio ' || v_n);
end $$;

-- UPDATE/DELETE de B sobre filas de A: 0 filas afectadas.
do $$
declare v_rows int;
begin
  update public.clientes set nombre = 'Hackeado por B' where id = (public._test_get('cliente_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.12 UPDATE de B sobre cliente de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  update public.viajes set observaciones = 'Hackeado por B' where id = (public._test_get('viaje_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.13 UPDATE de B sobre viaje de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  update public.camiones set patente = 'HACKEADO' where id = (public._test_get('camion_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.14 UPDATE de B sobre camión de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  update public.entregas set incidencias = 'Hackeado por B' where id = (public._test_get('entrega_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.15 UPDATE de B sobre entrega de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  update public.devoluciones set descripcion = 'Hackeado por B' where id = (public._test_get('devolucion_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.16 UPDATE de B sobre devolución de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  update public.transportistas set nombre = 'Hackeado por B' where id = (public._test_get('tenant_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.17 UPDATE de B sobre transportistas de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  delete from public.clientes where id = (public._test_get('cliente_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.18 DELETE de B sobre cliente de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  delete from public.camiones where id = (public._test_get('camion_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.19 DELETE de B sobre camión de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  delete from public.entregas where id = (public._test_get('entrega_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.20 DELETE de B sobre entrega de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  delete from public.devoluciones where id = (public._test_get('devolucion_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.21 DELETE de B sobre devolución de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  delete from public.gastos where id = (public._test_get('gasto_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.22 DELETE de B sobre gasto de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  delete from public.categorias_gasto where id = (public._test_get('categoria_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.23 DELETE de B sobre categoría propia de A afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

reset role;

-- Viceversa: A intenta tocar datos de B.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_rows int;
begin
  update public.clientes set nombre = 'Hackeado por A' where id = (public._test_get('cliente_b_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.24 UPDATE de A sobre cliente de B afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  delete from public.viajes where id = (public._test_get('viaje_b_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('1.25 DELETE de A sobre viaje de B afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end $$;

reset role;

-- Como postgres: confirmar que los datos de A y B siguen intactos.
do $$
declare
  v_nombre_cliente_a text;
  v_obs_viaje_a text;
  v_patente_camion_a text;
  v_incidencias_entrega_a text;
  v_descripcion_devolucion_a text;
  v_nombre_tenant_a text;
  v_existe_gasto_a boolean;
  v_existe_categoria_a boolean;
  v_nombre_cliente_b text;
  v_existe_viaje_b boolean;
begin
  select nombre into v_nombre_cliente_a from public.clientes where id = (public._test_get('cliente_a_id'))::uuid;
  select observaciones into v_obs_viaje_a from public.viajes where id = (public._test_get('viaje_a_id'))::uuid;
  select patente into v_patente_camion_a from public.camiones where id = (public._test_get('camion_a_id'))::uuid;
  select incidencias into v_incidencias_entrega_a from public.entregas where id = (public._test_get('entrega_a_id'))::uuid;
  select descripcion into v_descripcion_devolucion_a from public.devoluciones where id = (public._test_get('devolucion_a_id'))::uuid;
  select nombre into v_nombre_tenant_a from public.transportistas where id = (public._test_get('tenant_a_id'))::uuid;
  select exists(select 1 from public.gastos where id = (public._test_get('gasto_a_id'))::uuid) into v_existe_gasto_a;
  select exists(select 1 from public.categorias_gasto where id = (public._test_get('categoria_a_id'))::uuid) into v_existe_categoria_a;
  select nombre into v_nombre_cliente_b from public.clientes where id = (public._test_get('cliente_b_id'))::uuid;
  select exists(select 1 from public.viajes where id = (public._test_get('viaje_b_id'))::uuid) into v_existe_viaje_b;

  perform public._test_chk('1.26 Datos de A intactos tras los intentos de B',
    v_nombre_cliente_a = 'Cliente A'
      and v_obs_viaje_a is null
      and v_patente_camion_a = 'AA111AA'
      and v_incidencias_entrega_a is null
      and v_descripcion_devolucion_a = 'prueba'
      and v_nombre_tenant_a = 'Transportes A SRL'
      and v_existe_gasto_a
      and v_existe_categoria_a,
    format('cliente=%s obs=%s camion=%s entrega=%s devolucion=%s tenant=%s gasto=%s categoria=%s',
      v_nombre_cliente_a, v_obs_viaje_a, v_patente_camion_a, v_incidencias_entrega_a,
      v_descripcion_devolucion_a, v_nombre_tenant_a, v_existe_gasto_a, v_existe_categoria_a));

  perform public._test_chk('1.27 Datos de B intactos tras los intentos de A',
    v_nombre_cliente_b = 'Cliente B' and v_existe_viaje_b,
    format('cliente=%s viaje_existe=%s', v_nombre_cliente_b, v_existe_viaje_b));
end
$$;

-- ---------------------------------------------------------------------
-- 2) transportista_id: el cliente nunca lo manda, y no se puede tocar
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_tid uuid;
begin
  insert into public.clientes (nombre) values ('Cliente A Sin TID') returning transportista_id into v_tid;
  perform public._test_chk('2.1 INSERT sin transportista_id queda en el tenant propio',
    v_tid = (public._test_get('tenant_a_id'))::uuid, 'quedó en ' || v_tid);
end $$;

do $$
declare v_tid uuid;
begin
  insert into public.clientes (transportista_id, nombre)
    values ((public._test_get('tenant_b_id'))::uuid, 'Intento Colado En B')
    returning transportista_id into v_tid;
  perform public._test_chk('2.2 INSERT mandando transportista_id de otro tenant no cuela ahí',
    v_tid = (public._test_get('tenant_a_id'))::uuid, 'quedó en ' || v_tid);
end $$;

do $$
begin
  update public.clientes set transportista_id = (public._test_get('tenant_b_id'))::uuid
    where id = (public._test_get('cliente_a_id'))::uuid;
  perform public._test_chk('2.3 UPDATE cambiando transportista_id de una fila propia falla', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('2.3 UPDATE cambiando transportista_id de una fila propia falla', true, sqlerrm);
end
$$;

reset role;

-- ---------------------------------------------------------------------
-- 3) Referencias cruzadas entre tenants bloqueadas (FK compuestas + trigger)
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  insert into public.entregas (viaje_id, cliente_id)
    values ((public._test_get('viaje_a_id'))::uuid, (public._test_get('cliente_b_id'))::uuid);
  perform public._test_chk('3.1 B no puede crear entrega referenciando un viaje de A', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('3.1 B no puede crear entrega referenciando un viaje de A', true, sqlerrm);
end
$$;

do $$
begin
  insert into public.entregas (viaje_id, cliente_id)
    values ((public._test_get('viaje_b_id'))::uuid, (public._test_get('cliente_a_id'))::uuid);
  perform public._test_chk('3.2 B no puede crear entrega referenciando un cliente de A', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('3.2 B no puede crear entrega referenciando un cliente de A', true, sqlerrm);
end
$$;

do $$
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo)
    values ((public._test_get('viaje_a_id'))::uuid, (public._test_get('cliente_b_id'))::uuid, 'otro');
  perform public._test_chk('3.3 B no puede crear devolución referenciando un viaje de A', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('3.3 B no puede crear devolución referenciando un viaje de A', true, sqlerrm);
end
$$;

do $$
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo)
    values ((public._test_get('viaje_b_id'))::uuid, (public._test_get('cliente_a_id'))::uuid, 'otro');
  perform public._test_chk('3.4 B no puede crear devolución referenciando un cliente de A', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('3.4 B no puede crear devolución referenciando un cliente de A', true, sqlerrm);
end
$$;

do $$
begin
  insert into public.gastos (viaje_id, categoria_id, monto)
    values ((public._test_get('viaje_a_id'))::uuid, (public._test_get('categoria_global_peajes_id'))::uuid, 100);
  perform public._test_chk('3.5 B no puede crear gasto referenciando un viaje de A', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('3.5 B no puede crear gasto referenciando un viaje de A', true, sqlerrm);
end
$$;

do $$
begin
  insert into public.gastos (categoria_id, monto)
    values ((public._test_get('categoria_a_id'))::uuid, 100);
  perform public._test_chk('3.6 B no puede crear gasto con la categoría PROPIA de A', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('3.6 B no puede crear gasto con la categoría PROPIA de A', true, sqlerrm);
end
$$;

do $$
begin
  insert into public.viajes (origen, destino, camion_id)
    values ('X', 'Y', (public._test_get('camion_a_id'))::uuid);
  perform public._test_chk('3.7 B no puede crear viaje referenciando el camión de A', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('3.7 B no puede crear viaje referenciando el camión de A', true, sqlerrm);
end
$$;

do $$
declare v_tid uuid;
begin
  insert into public.gastos (categoria_id, monto)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 200)
    returning transportista_id into v_tid;
  perform public._test_chk('3.8 B SÍ puede crear un gasto con una categoría global',
    v_tid = (public._test_get('tenant_b_id'))::uuid, 'quedó en ' || v_tid);
exception when others then
  perform public._test_chk('3.8 B SÍ puede crear un gasto con una categoría global', false, sqlerrm);
end
$$;

-- Oráculo de existencia por PK: si el trigger no pisara new.id, este
-- INSERT rompería por duplicate_key (revelando que ese id existe en
-- otro tenant, sin tener SELECT sobre esa fila).
do $$
declare v_nuevo_id uuid;
begin
  insert into public.clientes (id, nombre)
    values ((public._test_get('cliente_a_id'))::uuid, 'Cliente B Con Id De A')
    returning id into v_nuevo_id;
  perform public._test_chk(
    '3.9 B insertando con el id de un cliente de A no falla por duplicate key y termina con otro id',
    v_nuevo_id is not null and v_nuevo_id <> (public._test_get('cliente_a_id'))::uuid,
    'id resultante=' || v_nuevo_id
  );
exception when others then
  perform public._test_chk(
    '3.9 B insertando con el id de un cliente de A no falla por duplicate key y termina con otro id',
    false, sqlerrm
  );
end
$$;

reset role;

-- ---------------------------------------------------------------------
-- 4) Chofer de A: sin privilegios de rol, sí de sus propias preferencias
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_chofer'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  update public.miembros set rol = 'admin' where user_id = (public._test_get('uid_a_chofer'))::uuid;
  perform public._test_chk('4.1 El chofer no puede auto-promoverse (UPDATE directo de rol)', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('4.1 El chofer no puede auto-promoverse (UPDATE directo de rol)', true, sqlerrm);
end
$$;

do $$
begin
  perform public.cambiar_rol_miembro((public._test_get('uid_a_chofer'))::uuid, 'admin');
  perform public._test_chk('4.2 El chofer no puede usar cambiar_rol_miembro', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('4.2 El chofer no puede usar cambiar_rol_miembro', true, sqlerrm);
end
$$;

do $$
declare v_rows int;
begin
  update public.miembros set tema = 'light', color_acento = '#112233'
    where user_id = (public._test_get('uid_a_chofer'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('4.3 El chofer sí puede cambiar su tema/color_acento', v_rows = 1, 'afectó ' || v_rows);
exception when others then
  perform public._test_chk('4.3 El chofer sí puede cambiar su tema/color_acento', false, sqlerrm);
end
$$;

do $$
declare v_rows int;
begin
  update public.miembros set tema = 'light' where user_id = (public._test_get('uid_a_admin'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('4.4 El chofer no puede tocar preferencias de otro miembro', v_rows = 0, 'afectó ' || v_rows);
end
$$;

do $$
begin
  update public.miembros set color_acento = 'rojo' where user_id = (public._test_get('uid_a_chofer'))::uuid;
  perform public._test_chk('4.5 color_acento inválido falla', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('4.5 color_acento inválido falla', true, sqlerrm);
end
$$;

reset role;

-- Como postgres: confirmar que el chofer sigue siendo chofer y el admin no se tocó.
do $$
declare v_rol_chofer public.rol_miembro; v_tema_admin text;
begin
  select rol into v_rol_chofer from public.miembros where user_id = (public._test_get('uid_a_chofer'))::uuid;
  select tema into v_tema_admin from public.miembros where user_id = (public._test_get('uid_a_admin'))::uuid;
  perform public._test_chk('4.6 Tras la sección 4: chofer sigue en rol chofer y admin sin cambios',
    v_rol_chofer = 'chofer' and v_tema_admin = 'dark',
    format('rol_chofer=%s tema_admin=%s', v_rol_chofer, v_tema_admin));
end
$$;

-- ---------------------------------------------------------------------
-- 5) Admin de A: cambiar_rol_miembro (con guardia de "último admin")
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_rol public.rol_miembro;
begin
  perform public.cambiar_rol_miembro((public._test_get('uid_a_chofer'))::uuid, 'admin');
  select rol into v_rol from public.miembros where user_id = (public._test_get('uid_a_chofer'))::uuid;
  perform public._test_chk('5.1 Admin A puede promover al chofer de A a admin', v_rol = 'admin', 'quedó en ' || v_rol);
exception when others then
  perform public._test_chk('5.1 Admin A puede promover al chofer de A a admin', false, sqlerrm);
end
$$;

do $$
declare v_rol public.rol_miembro;
begin
  perform public.cambiar_rol_miembro((public._test_get('uid_a_chofer'))::uuid, 'chofer');
  select rol into v_rol from public.miembros where user_id = (public._test_get('uid_a_chofer'))::uuid;
  perform public._test_chk('5.2 Admin A puede volver a degradarlo a chofer (todavía queda otro admin)',
    v_rol = 'chofer', 'quedó en ' || v_rol);
exception when others then
  perform public._test_chk('5.2 Admin A puede volver a degradarlo a chofer (todavía queda otro admin)', false, sqlerrm);
end
$$;

do $$
begin
  perform public.cambiar_rol_miembro((public._test_get('uid_a_admin'))::uuid, 'chofer');
  perform public._test_chk('5.3 Admin A no puede degradarse siendo el último admin', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('5.3 Admin A no puede degradarse siendo el último admin', true, sqlerrm);
end
$$;

do $$
begin
  perform public.cambiar_rol_miembro((public._test_get('uid_b_admin'))::uuid, 'chofer');
  perform public._test_chk('5.4 Admin A no puede cambiar el rol de un miembro de B', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('5.4 Admin A no puede cambiar el rol de un miembro de B', true, sqlerrm);
end
$$;

reset role;

-- ---------------------------------------------------------------------
-- 6) Categorías globales: nadie las edita, borra ni crea directamente
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_rows int;
begin
  update public.categorias_gasto set nombre = 'Hackeada' where nombre = 'Peajes' and transportista_id is null;
  get diagnostics v_rows = row_count;
  perform public._test_chk('6.1 Nadie edita una categoría global', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  delete from public.categorias_gasto where nombre = 'Combustible' and transportista_id is null;
  get diagnostics v_rows = row_count;
  perform public._test_chk('6.2 Nadie borra una categoría global', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_rows int;
begin
  update public.categorias_gasto set nombre = 'Hackeada2' where id = (public._test_get('categoria_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('6.3 B no edita la categoría propia de A', v_rows = 0, 'afectó ' || v_rows);
end $$;

do $$
declare v_tid uuid;
begin
  insert into public.categorias_gasto (transportista_id, nombre) values (null, 'Categoria Global Trucha')
    returning transportista_id into v_tid;
  perform public._test_chk('6.4 Nadie logra crear una categoría global (queda forzada al tenant propio)',
    v_tid = (public._test_get('tenant_b_id'))::uuid, 'quedó transportista_id=' || v_tid);
exception when others then
  perform public._test_chk('6.4 Nadie logra crear una categoría global (queda forzada al tenant propio)', false, sqlerrm);
end
$$;

reset role;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.categorias_gasto where transportista_id is null;
  perform public._test_chk('6.5 Siguen existiendo exactamente 4 categorías globales', v_n = 4, 'hay ' || v_n);
end
$$;

-- Contexto de confianza sin JWT: el responsable del proyecto (rol postgres, sin request.jwt.claims)
-- tiene que poder seguir agregando categorías globales a mano desde el
-- SQL Editor. Limpiamos el jwt.claims que hubiera quedado del bloque B
-- para simular un rol realmente sin sesión.
select set_config('request.jwt.claims', '', true);

do $$
declare v_id uuid; v_tid uuid;
begin
  insert into public.categorias_gasto (nombre) values ('Categoría Global Nueva (test)')
    returning id, transportista_id into v_id, v_tid;
  -- Guardamos session_user/current_user en el detalle a propósito: si en
  -- el Supabase real el SQL Editor conecta con otro rol de login (no
  -- 'postgres'), este test va a fallar y el detalle va a decir
  -- exactamente con qué rol, en vez de dejar que se adivine.
  perform public._test_chk(
    '6.6 Como postgres (sin JWT) se puede insertar una categoría global nueva',
    v_id is not null and v_tid is null,
    format('id=%s transportista_id=%s session_user=%s current_user=%s', v_id, v_tid, session_user, current_user)
  );
exception when others then
  perform public._test_chk(
    '6.6 Como postgres (sin JWT) se puede insertar una categoría global nueva',
    false,
    format('session_user=%s current_user=%s :: %s', session_user, current_user, sqlerrm)
  );
end
$$;

-- Guardamos cuántas categorías globales hay AHORA (4 del seed + la que
-- acabamos de insertar en 6.6) para no hardcodear el número en la
-- sección 8 y que quede claro por qué ya no son 4.
select public._test_set('total_categorias_globales',
  (select count(*)::text from public.categorias_gasto where transportista_id is null));

-- ---------------------------------------------------------------------
-- 7) INSERT/DELETE directo bloqueado en miembros/transportistas +
--    doble onboarding
-- ---------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  insert into public.miembros (user_id, transportista_id, rol)
    values (gen_random_uuid(), (public._test_get('tenant_a_id'))::uuid, 'admin');
  perform public._test_chk('7.1 INSERT directo en miembros como authenticated falla', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('7.1 INSERT directo en miembros como authenticated falla', true, sqlerrm);
end
$$;

do $$
begin
  insert into public.transportistas (nombre) values ('Tenant Trucho');
  perform public._test_chk('7.2 INSERT directo en transportistas como authenticated falla', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('7.2 INSERT directo en transportistas como authenticated falla', true, sqlerrm);
end
$$;

do $$
begin
  delete from public.miembros where user_id = (public._test_get('uid_a_admin'))::uuid;
  perform public._test_chk('7.3 DELETE directo en miembros como authenticated falla', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('7.3 DELETE directo en miembros como authenticated falla', true, sqlerrm);
end
$$;

do $$
begin
  delete from public.transportistas where id = (public._test_get('tenant_a_id'))::uuid;
  perform public._test_chk('7.4 DELETE directo en transportistas como authenticated falla', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('7.4 DELETE directo en transportistas como authenticated falla', true, sqlerrm);
end
$$;

do $$
begin
  perform public.create_transportista('Segundo intento de A');
  perform public._test_chk('7.5 create_transportista() por segunda vez falla (admin ya tiene tenant)', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('7.5 create_transportista() por segunda vez falla (admin ya tiene tenant)', true, sqlerrm);
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_chofer'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.create_transportista('Intento del chofer');
  perform public._test_chk('7.6 create_transportista() falla para un miembro existente (el chofer de A)', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('7.6 create_transportista() falla para un miembro existente (el chofer de A)', true, sqlerrm);
end
$$;

reset role;

-- ---------------------------------------------------------------------
-- 8) anon no lee nada; usuario sin tenant no ve/inserta nada de negocio
-- ---------------------------------------------------------------------

set local role anon;

do $$
begin
  perform count(*) from public.clientes;
  perform public._test_chk('8.1 anon no puede leer clientes', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.1 anon no puede leer clientes', true, sqlerrm);
end
$$;

do $$
begin
  perform count(*) from public.miembros;
  perform public._test_chk('8.2 anon no puede leer miembros', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.2 anon no puede leer miembros', true, sqlerrm);
end
$$;

do $$
begin
  perform count(*) from public.transportistas;
  perform public._test_chk('8.3 anon no puede leer transportistas', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.3 anon no puede leer transportistas', true, sqlerrm);
end
$$;

do $$
begin
  perform count(*) from public.categorias_gasto;
  perform public._test_chk('8.4 anon no puede leer categorias_gasto', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.4 anon no puede leer categorias_gasto', true, sqlerrm);
end
$$;

do $$
begin
  perform count(*) from public.camiones;
  perform public._test_chk('8.5 anon no puede leer camiones', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.5 anon no puede leer camiones', true, sqlerrm);
end
$$;

do $$
begin
  perform count(*) from public.viajes;
  perform public._test_chk('8.6 anon no puede leer viajes', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.6 anon no puede leer viajes', true, sqlerrm);
end
$$;

do $$
begin
  perform count(*) from public.entregas;
  perform public._test_chk('8.7 anon no puede leer entregas', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.7 anon no puede leer entregas', true, sqlerrm);
end
$$;

do $$
begin
  perform count(*) from public.devoluciones;
  perform public._test_chk('8.8 anon no puede leer devoluciones', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.8 anon no puede leer devoluciones', true, sqlerrm);
end
$$;

do $$
begin
  perform count(*) from public.gastos;
  perform public._test_chk('8.9 anon no puede leer gastos', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.9 anon no puede leer gastos', true, sqlerrm);
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_sin_tenant'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.clientes;
  perform public._test_chk('8.10 Usuario sin tenant no ve clientes', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.viajes;
  perform public._test_chk('8.11 Usuario sin tenant no ve viajes', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.miembros;
  perform public._test_chk('8.12 Usuario sin tenant no ve miembros', v_n = 0, 'vio ' || v_n);
end $$;

do $$
declare v_n int; v_esperado int;
begin
  -- Las categorías globales SÍ son visibles (no pertenecen a ningún tenant,
  -- no hay fuga de datos ajenos): tiene que ver todas las globales (4 del
  -- seed + la que se agregó en 6.6) y ninguna privada de A o B.
  select count(*) into v_n from public.categorias_gasto;
  v_esperado := (public._test_get('total_categorias_globales'))::int;
  perform public._test_chk('8.13 Usuario sin tenant solo ve las categorías globales',
    v_n = v_esperado, format('vio %s, esperaba %s', v_n, v_esperado));
end $$;

do $$
begin
  insert into public.clientes (nombre) values ('No debería existir');
  perform public._test_chk('8.14 Usuario sin tenant no puede insertar (sin transportista_id)', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.14 Usuario sin tenant no puede insertar (sin transportista_id)', true, sqlerrm);
end
$$;

do $$
begin
  insert into public.clientes (transportista_id, nombre)
    values ((public._test_get('tenant_a_id'))::uuid, 'Intento colado sin tenant');
  perform public._test_chk('8.15 Usuario sin tenant no puede colarse mandando un transportista_id ajeno', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.15 Usuario sin tenant no puede colarse mandando un transportista_id ajeno', true, sqlerrm);
end
$$;

do $$
begin
  perform public.cambiar_rol_miembro((public._test_get('uid_a_chofer'))::uuid, 'admin');
  perform public._test_chk('8.16 Usuario sin tenant no puede usar cambiar_rol_miembro', false, 'no lanzó excepción');
exception when others then
  perform public._test_chk('8.16 Usuario sin tenant no puede usar cambiar_rol_miembro', true, sqlerrm);
end
$$;

reset role;

-- ---------------------------------------------------------------------
-- 10) Blindaje del "contexto de confianza sin JWT" de
--     fn_forzar_transportista_id contra una función SECURITY DEFINER
--     mal armada (hallazgo de appsec: allow-list por session_user, no
--     deny-list por current_user — current_user cambia a postgres
--     DENTRO de cualquier SECURITY DEFINER, session_user no).
-- ---------------------------------------------------------------------
-- Este test simula de verdad cómo se conecta PostgREST (rol
-- 'authenticator' como session_user, que hace SET ROLE al rol del JWT
-- por request) usando SET SESSION AUTHORIZATION. Eso REQUIERE superuser
-- en Postgres. En Supabase alojado el rol `postgres` del SQL Editor NO
-- es superuser (rolsuper = false) — si intentáramos igual, el SET
-- SESSION AUTHORIZATION tiraría "permission denied to set session
-- authorization" y el script se rompería ANTES de llegar al resumen
-- final. Por eso todo esto va adentro de un solo DO que primero chequea
-- rolsuper y, si no es superuser, OMITE el escenario (test 10.1 queda
-- registrado como OK con el motivo en el detalle, sin tocar la sesión
-- para nada). El escenario real queda cubierto por la validación en
-- PGlite, que sí corre como superuser.
--
-- Si sí es superuser (típicamente un Postgres/Supabase local), se
-- ejecuta el escenario completo y la sesión se restaura SIEMPRE
-- (reset role + set session authorization <usuario original>) apenas termina, tanto en
-- el camino feliz como en el handler de excepción — la conexión del SQL
-- Editor nunca debería quedar en otro rol distinto al que arrancó.

-- Función SECURITY DEFINER temporal (dueño postgres, se cae con el
-- ROLLBACK final igual que el resto) que simula una futura función de
-- negocio mal armada: inserta directo en clientes con el
-- transportista_id que le pasen, sin pasar por create_transportista ni
-- por ningún chequeo propio — depende 100% de que el trigger
-- fn_forzar_transportista_id la blinde igual.
create function public._test_fn_insertar_cliente_trucho(p_transportista_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.clientes (transportista_id, nombre)
    values (p_transportista_id, 'Cliente Colado Vía Definer Sin Sub')
    returning id into v_id;
  return v_id;
end;
$$;

do $$
declare
  v_session_user_original text := session_user;
  v_es_superuser boolean;
  v_id uuid;
begin
  select rolsuper into v_es_superuser from pg_roles where rolname = session_user;

  if not coalesce(v_es_superuser, false) then
    perform public._test_chk(
      '10.1 SECURITY DEFINER (dueño postgres) invocada sin sub en el JWT no cuela un INSERT sin forzar transportista_id',
      true,
      'OMITIDO: requiere superuser para simular la sesión de PostgREST (authenticator). Cubierto en la validación con PGlite.'
    );
  else
    begin
      -- Simulamos la conexión real de PostgREST: se autentica como
      -- 'authenticator' (session_user) y por request hace SET ROLE al
      -- rol que corresponda según el JWT (current_user). Simulamos un
      -- request "authenticated" pero SIN 'sub' en el JWT (JWT vencido,
      -- mal formado, etc. — igual matchea el rol pero no trae claims
      -- utilizables).
      execute 'set session authorization authenticator';
      execute 'set role authenticated';
      perform set_config('request.jwt.claims', '', true);

      v_id := public._test_fn_insertar_cliente_trucho((public._test_get('tenant_b_id'))::uuid);

      -- Restaurar la sesión ANTES de registrar el resultado (camino feliz).
      execute 'reset role';
      execute format('set session authorization %I', v_session_user_original);

      perform public._test_chk(
        '10.1 SECURITY DEFINER (dueño postgres) invocada sin sub en el JWT no cuela un INSERT sin forzar transportista_id',
        false,
        format('sesión original=%s :: no lanzó excepción, insertó id=%s', v_session_user_original, v_id)
      );
    exception when others then
      -- Restaurar la sesión también acá: pase lo que pase, no queremos
      -- dejar la conexión en 'authenticator'/'authenticated'.
      execute 'reset role';
      execute format('set session authorization %I', v_session_user_original);

      perform public._test_chk(
        '10.1 SECURITY DEFINER (dueño postgres) invocada sin sub en el JWT no cuela un INSERT sin forzar transportista_id',
        true,
        format('sesión original=%s :: %s', v_session_user_original, sqlerrm)
      );
    end;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 11) Combustible (migración 005): km_odometro / tanque_lleno en gastos
-- ---------------------------------------------------------------------
-- Requiere 005_gastos_combustible.sql aplicada. Las columnas nuevas no
-- llevan policy ni grant propios: las cubren el grant de tabla y la
-- policy por fila de gastos (por eso se prueba el aislamiento acá). Los
-- casos 11.4 y 11.5 cubren el check de coherencia
-- gastos_tanque_lleno_litros_chk (tanque_lleno = true exige litros).

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_id uuid; v_tid uuid; v_km numeric; v_lleno boolean;
begin
  insert into public.gastos (categoria_id, monto, litros, precio_por_litro, km_odometro, tanque_lleno)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 60000, 50.5, 1200, 123456.7, true)
    returning id, transportista_id, km_odometro, tanque_lleno into v_id, v_tid, v_km, v_lleno;
  perform public._test_set('gasto_comb_a_id', v_id::text);
  perform public._test_chk(
    '11.1 A carga un gasto de combustible con km_odometro y tanque_lleno y queda en su tenant',
    v_tid = (public._test_get('tenant_a_id'))::uuid and v_km = 123456.7 and v_lleno is true,
    format('tenant=%s km=%s lleno=%s', v_tid, v_km, v_lleno));
exception when others then
  perform public._test_chk(
    '11.1 A carga un gasto de combustible con km_odometro y tanque_lleno y queda en su tenant',
    false, sqlerrm);
end
$$;

do $$
begin
  insert into public.gastos (categoria_id, monto, litros, km_odometro)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 1000, 10, -1);
  perform public._test_chk('11.2 km_odometro negativo falla', false, 'no lanzó excepción');
exception
  when check_violation then
    perform public._test_chk('11.2 km_odometro negativo falla',
      sqlerrm like '%gastos_km_odometro_chk%', sqlerrm);
  when others then
    perform public._test_chk('11.2 km_odometro negativo falla', false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_km numeric; v_lleno boolean;
begin
  insert into public.gastos (categoria_id, monto)
    values ((public._test_get('categoria_global_peajes_id'))::uuid, 500)
    returning km_odometro, tanque_lleno into v_km, v_lleno;
  perform public._test_chk('11.3 Un gasto sin las columnas nuevas sigue funcionando y las deja en NULL',
    v_km is null and v_lleno is null, format('km=%s lleno=%s', v_km, v_lleno));
exception when others then
  perform public._test_chk('11.3 Un gasto sin las columnas nuevas sigue funcionando y las deja en NULL', false, sqlerrm);
end
$$;

do $$
begin
  insert into public.gastos (categoria_id, monto, km_odometro, tanque_lleno)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 1000, 123500, true);
  perform public._test_chk('11.4 tanque_lleno = true sin litros falla', false, 'no lanzó excepción');
exception
  when check_violation then
    perform public._test_chk('11.4 tanque_lleno = true sin litros falla',
      sqlerrm like '%gastos_tanque_lleno_litros_chk%', sqlerrm);
  when others then
    perform public._test_chk('11.4 tanque_lleno = true sin litros falla', false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

-- Borrar litros de una carga "llena" falla y la fila queda intacta; borrar
-- litros Y tanque_lleno juntos sí se puede.
do $$
declare v_fallo boolean := false; v_litros numeric; v_lleno boolean; v_rows int;
begin
  begin
    update public.gastos set litros = null
      where id = (public._test_get('gasto_comb_a_id'))::uuid;
  exception when check_violation then
    v_fallo := true;
  end;

  select litros, tanque_lleno into v_litros, v_lleno
    from public.gastos where id = (public._test_get('gasto_comb_a_id'))::uuid;

  update public.gastos set litros = null, tanque_lleno = null
    where id = (public._test_get('gasto_comb_a_id'))::uuid;
  get diagnostics v_rows = row_count;

  -- Se restaura la fila para los casos siguientes.
  update public.gastos set litros = 50.5, tanque_lleno = true
    where id = (public._test_get('gasto_comb_a_id'))::uuid;

  perform public._test_chk('11.5 UPDATE que borra litros de una carga con tanque_lleno = true falla',
    v_fallo and v_litros = 50.5 and v_lleno is true and v_rows = 1,
    format('fallo=%s; tras el fallo litros=%s lleno=%s; borrar ambos juntos afectó %s fila(s)', v_fallo, v_litros, v_lleno, v_rows));
exception when others then
  perform public._test_chk('11.5 UPDATE que borra litros de una carga con tanque_lleno = true falla',
    false, sqlerrm);
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_con_km int; v_de_a int;
begin
  insert into public.gastos (categoria_id, monto, litros, km_odometro, tanque_lleno)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 30000, 25, 50000.0, true);
  select count(*) into v_con_km from public.gastos where km_odometro is not null;
  select count(*) into v_de_a from public.gastos where id = (public._test_get('gasto_comb_a_id'))::uuid;
  perform public._test_chk(
    '11.6 B, con su propio gasto de combustible, ve 1 solo gasto con km_odometro (el suyo) y ninguno de A',
    v_con_km = 1 and v_de_a = 0, format('con_km=%s de_a=%s', v_con_km, v_de_a));
exception when others then
  perform public._test_chk(
    '11.6 B, con su propio gasto de combustible, ve 1 solo gasto con km_odometro (el suyo) y ninguno de A',
    false, sqlerrm);
end
$$;

do $$
declare v_rows int;
begin
  update public.gastos set km_odometro = 1, tanque_lleno = false
    where id = (public._test_get('gasto_comb_a_id'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('11.7 UPDATE de B sobre km_odometro/tanque_lleno de un gasto de A afecta 0 filas',
    v_rows = 0, 'afectó ' || v_rows);
end
$$;

reset role;

-- Como postgres: el gasto de A quedó intacto tras los intentos de B.
do $$
declare v_km numeric; v_lleno boolean; v_litros numeric;
begin
  select km_odometro, tanque_lleno, litros into v_km, v_lleno, v_litros
    from public.gastos where id = (public._test_get('gasto_comb_a_id'))::uuid;
  perform public._test_chk('11.8 El gasto de combustible de A quedó intacto tras los intentos de B',
    v_km = 123456.7 and v_lleno is true and v_litros = 50.5,
    format('km=%s lleno=%s litros=%s', v_km, v_lleno, v_litros));
end
$$;

-- ---------------------------------------------------------------------
-- 12) client_ref (migración 006): idempotencia de reintentos en gastos
-- ---------------------------------------------------------------------
-- Requiere 006_gastos_client_ref.sql aplicada. client_ref es un uuid que
-- genera el front: un reintento con el mismo valor choca contra el índice
-- único parcial (transportista_id, client_ref) y no duplica el gasto.
-- Referencias usadas: X (la usan A y B, cada uno la suya), Y (la usa A; B
-- la manda forzando el transportista_id de A) y V (solo A). W es un valor
-- nuevo para intentar reescribir un client_ref.

select public._test_set('cref_x', 'dddddddd-0000-4000-8000-000000000001');
select public._test_set('cref_y', 'dddddddd-0000-4000-8000-000000000002');
select public._test_set('cref_v', 'dddddddd-0000-4000-8000-000000000003');
select public._test_set('cref_w', 'dddddddd-0000-4000-8000-000000000004');

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_id uuid; v_tid_x uuid; v_ref_x uuid; v_tid_y uuid; v_tid_v uuid;
begin
  insert into public.gastos (categoria_id, monto, client_ref)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 1001, (public._test_get('cref_x'))::uuid)
    returning id, transportista_id, client_ref into v_id, v_tid_x, v_ref_x;
  perform public._test_set('gasto_ref_x_a_id', v_id::text);

  insert into public.gastos (categoria_id, monto, client_ref)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 1002, (public._test_get('cref_y'))::uuid)
    returning transportista_id into v_tid_y;

  insert into public.gastos (categoria_id, monto, client_ref)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 1003, (public._test_get('cref_v'))::uuid)
    returning id, transportista_id into v_id, v_tid_v;
  perform public._test_set('gasto_ref_v_a_id', v_id::text);

  perform public._test_chk(
    '12.1 A inserta gastos con client_ref (X, Y, V): quedan en su tenant con el client_ref intacto',
    v_tid_x = (public._test_get('tenant_a_id'))::uuid
      and v_tid_y = (public._test_get('tenant_a_id'))::uuid
      and v_tid_v = (public._test_get('tenant_a_id'))::uuid
      and v_ref_x = (public._test_get('cref_x'))::uuid,
    format('tenants=%s/%s/%s ref_x=%s', v_tid_x, v_tid_y, v_tid_v, v_ref_x));
exception when others then
  perform public._test_chk(
    '12.1 A inserta gastos con client_ref (X, Y, V): quedan en su tenant con el client_ref intacto',
    false, sqlerrm);
end
$$;

do $$
declare v_constraint text; v_n int;
begin
  insert into public.gastos (categoria_id, monto, client_ref)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 1001, (public._test_get('cref_x'))::uuid);
  perform public._test_chk(
    '12.2 Reintento con el mismo client_ref falla con 23505 (índice gastos_transportista_client_ref_uidx) y sigue habiendo 1 fila',
    false, 'no lanzó excepción');
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    select count(*) into v_n from public.gastos where client_ref = (public._test_get('cref_x'))::uuid;
    perform public._test_chk(
      '12.2 Reintento con el mismo client_ref falla con 23505 (índice gastos_transportista_client_ref_uidx) y sigue habiendo 1 fila',
      v_constraint = 'gastos_transportista_client_ref_uidx' and v_n = 1,
      format('constraint=%s filas=%s :: %s', v_constraint, v_n, sqlerrm));
  when others then
    perform public._test_chk(
      '12.2 Reintento con el mismo client_ref falla con 23505 (índice gastos_transportista_client_ref_uidx) y sigue habiendo 1 fila',
      false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_ref uuid;
begin
  update public.gastos set client_ref = (public._test_get('cref_w'))::uuid
    where id = (public._test_get('gasto_ref_x_a_id'))::uuid;
  perform public._test_chk('12.3 UPDATE que cambia client_ref (valor -> otro valor) falla', false, 'no lanzó excepción');
exception
  when insufficient_privilege then
    select client_ref into v_ref from public.gastos where id = (public._test_get('gasto_ref_x_a_id'))::uuid;
    perform public._test_chk('12.3 UPDATE que cambia client_ref (valor -> otro valor) falla',
      sqlerrm like 'No se puede cambiar el client_ref%' and v_ref = (public._test_get('cref_x'))::uuid, sqlerrm);
  when others then
    perform public._test_chk('12.3 UPDATE que cambia client_ref (valor -> otro valor) falla', false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_ref uuid;
begin
  update public.gastos set client_ref = null
    where id = (public._test_get('gasto_ref_x_a_id'))::uuid;
  perform public._test_chk('12.4 UPDATE que borra client_ref (valor -> NULL) falla', false, 'no lanzó excepción');
exception
  when insufficient_privilege then
    select client_ref into v_ref from public.gastos where id = (public._test_get('gasto_ref_x_a_id'))::uuid;
    perform public._test_chk('12.4 UPDATE que borra client_ref (valor -> NULL) falla',
      sqlerrm like 'No se puede cambiar el client_ref%' and v_ref = (public._test_get('cref_x'))::uuid, sqlerrm);
  when others then
    perform public._test_chk('12.4 UPDATE que borra client_ref (valor -> NULL) falla', false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_ref uuid;
begin
  -- gasto_a_id es el gasto de peaje del setup, cargado sin client_ref.
  update public.gastos set client_ref = (public._test_get('cref_w'))::uuid
    where id = (public._test_get('gasto_a_id'))::uuid;
  perform public._test_chk('12.5 UPDATE que asigna client_ref a una fila que no tenía (NULL -> valor) falla', false, 'no lanzó excepción');
exception
  when insufficient_privilege then
    select client_ref into v_ref from public.gastos where id = (public._test_get('gasto_a_id'))::uuid;
    perform public._test_chk('12.5 UPDATE que asigna client_ref a una fila que no tenía (NULL -> valor) falla',
      sqlerrm like 'No se puede cambiar el client_ref%' and v_ref is null, sqlerrm);
  when others then
    perform public._test_chk('12.5 UPDATE que asigna client_ref a una fila que no tenía (NULL -> valor) falla', false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_rows1 int; v_rows2 int; v_ref uuid; v_monto numeric; v_desc text;
begin
  update public.gastos set descripcion = 'editado'
    where id = (public._test_get('gasto_ref_x_a_id'))::uuid;
  get diagnostics v_rows1 = row_count;
  -- Mandar el mismo client_ref de nuevo (como haría un formulario que reenvía todo) tampoco molesta.
  update public.gastos set monto = 1234, client_ref = client_ref
    where id = (public._test_get('gasto_ref_x_a_id'))::uuid;
  get diagnostics v_rows2 = row_count;
  select client_ref, monto, descripcion into v_ref, v_monto, v_desc
    from public.gastos where id = (public._test_get('gasto_ref_x_a_id'))::uuid;
  perform public._test_chk('12.6 UPDATE de otras columnas (con o sin reenviar el mismo client_ref) sigue funcionando',
    v_rows1 = 1 and v_rows2 = 1 and v_ref = (public._test_get('cref_x'))::uuid and v_monto = 1234 and v_desc = 'editado',
    format('filas=%s/%s ref=%s monto=%s desc=%s', v_rows1, v_rows2, v_ref, v_monto, v_desc));
exception when others then
  perform public._test_chk('12.6 UPDATE de otras columnas (con o sin reenviar el mismo client_ref) sigue funcionando', false, sqlerrm);
end
$$;

do $$
declare v_rows int;
begin
  update public.gastos set descripcion = 'editado por A'
    where client_ref = (public._test_get('cref_v'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('12.7 UPDATE ... WHERE client_ref = V del dueño (A) afecta 1 fila', v_rows = 1, 'afectó ' || v_rows);
end
$$;

do $$
declare v_antes int; v_despues int;
begin
  select count(*) into v_antes from public.gastos where client_ref is null;
  insert into public.gastos (categoria_id, monto)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 10);
  insert into public.gastos (categoria_id, monto)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 11);
  insert into public.gastos (categoria_id, monto, client_ref)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 12, null);
  select count(*) into v_despues from public.gastos where client_ref is null;
  perform public._test_chk('12.8 Varias filas con client_ref NULL conviven (el índice parcial las ignora)',
    v_despues = v_antes + 3, format('antes=%s despues=%s', v_antes, v_despues));
exception when others then
  perform public._test_chk('12.8 Varias filas con client_ref NULL conviven (el índice parcial las ignora)', false, sqlerrm);
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_tid uuid; v_ref uuid;
begin
  insert into public.gastos (categoria_id, monto, client_ref)
    values ((public._test_get('categoria_global_combustible_id'))::uuid, 777, (public._test_get('cref_x'))::uuid)
    returning transportista_id, client_ref into v_tid, v_ref;
  perform public._test_chk('12.9 B inserta con el MISMO client_ref X que ya usó A: funciona y queda en su tenant',
    v_tid = (public._test_get('tenant_b_id'))::uuid and v_ref = (public._test_get('cref_x'))::uuid,
    format('tenant=%s ref=%s', v_tid, v_ref));
exception when others then
  perform public._test_chk('12.9 B inserta con el MISMO client_ref X que ya usó A: funciona y queda en su tenant', false, sqlerrm);
end
$$;

do $$
declare v_n int; v_tid uuid; v_monto numeric;
begin
  select count(*), min(transportista_id::text)::uuid, min(monto) into v_n, v_tid, v_monto
    from public.gastos where client_ref = (public._test_get('cref_x'))::uuid;
  perform public._test_chk('12.10 B ve una sola fila con client_ref X y es la suya (no la de A)',
    v_n = 1 and v_tid = (public._test_get('tenant_b_id'))::uuid and v_monto = 777,
    format('filas=%s tenant=%s monto=%s', v_n, v_tid, v_monto));
end
$$;

-- Sin oráculo de existencia: B manda el transportista_id de A y un client_ref
-- que A ya usó (Y). Si el índice se evaluara contra el tenant de A, daría 23505
-- y B sabría que Y existe en A. El trigger pisa transportista_id antes.
do $$
declare v_tid uuid;
begin
  insert into public.gastos (transportista_id, categoria_id, monto, client_ref)
    values ((public._test_get('tenant_a_id'))::uuid,
            (public._test_get('categoria_global_combustible_id'))::uuid, 555,
            (public._test_get('cref_y'))::uuid)
    returning transportista_id into v_tid;
  perform public._test_chk(
    '12.11 B forzando el transportista_id de A + un client_ref que A ya usó: sin error (sin oráculo) y la fila queda en B',
    v_tid = (public._test_get('tenant_b_id'))::uuid, 'quedó en ' || v_tid);
exception
  when unique_violation then
    perform public._test_chk(
      '12.11 B forzando el transportista_id de A + un client_ref que A ya usó: sin error (sin oráculo) y la fila queda en B',
      false, 'B recibió 23505: hay oráculo de existencia :: ' || sqlerrm);
  when others then
    perform public._test_chk(
      '12.11 B forzando el transportista_id de A + un client_ref que A ya usó: sin error (sin oráculo) y la fila queda en B',
      false, sqlerrm);
end
$$;

do $$
declare v_rows int;
begin
  update public.gastos set descripcion = 'editado por B'
    where client_ref = (public._test_get('cref_v'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('12.12 UPDATE ... WHERE client_ref = V de B (V es solo de A) afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_nx int; v_monto_x numeric; v_ny int; v_monto_y numeric;
begin
  select count(*), min(monto) into v_nx, v_monto_x
    from public.gastos where client_ref = (public._test_get('cref_x'))::uuid;
  select count(*), min(monto) into v_ny, v_monto_y
    from public.gastos where client_ref = (public._test_get('cref_y'))::uuid;
  perform public._test_chk('12.13 A ve una sola fila con client_ref X y una con Y, las suyas (no las de B)',
    v_nx = 1 and v_monto_x = 1234 and v_ny = 1 and v_monto_y = 1002,
    format('X: filas=%s monto=%s | Y: filas=%s monto=%s', v_nx, v_monto_x, v_ny, v_monto_y));
end
$$;

reset role;

-- Como postgres: X e Y existen una vez por tenant, V solo en A, no hay
-- duplicados por (tenant, client_ref) y V conserva la edición de A (no la de B).
do $$
declare v_x int; v_y int; v_v int; v_dups int; v_desc text;
begin
  select count(*) into v_x from public.gastos where client_ref = (public._test_get('cref_x'))::uuid;
  select count(*) into v_y from public.gastos where client_ref = (public._test_get('cref_y'))::uuid;
  select count(*) into v_v from public.gastos where client_ref = (public._test_get('cref_v'))::uuid;
  select count(*) into v_dups from (
    select transportista_id, client_ref from public.gastos
      where client_ref is not null group by 1, 2 having count(*) > 1
  ) d;
  select descripcion into v_desc from public.gastos where client_ref = (public._test_get('cref_v'))::uuid;
  perform public._test_chk(
    '12.14 Como postgres: X e Y una vez por tenant, V solo en A, sin duplicados por (tenant, client_ref) y V conserva la edición de A',
    v_x = 2 and v_y = 2 and v_v = 1 and v_dups = 0 and v_desc = 'editado por A',
    format('X=%s Y=%s V=%s duplicados=%s desc_v=%s', v_x, v_y, v_v, v_dups, v_desc));
end
$$;

-- ---------------------------------------------------------------------
-- 13) client_ref de viajes (migración 007)
-- ---------------------------------------------------------------------
-- Requiere 007_viajes_client_ref_y_funciones.sql aplicada. Mismo contrato
-- que gastos (sección 12): único por tenant (índice parcial), sin oráculo
-- de existencia entre tenants e inmutable en todos los sentidos. Acá se
-- prueba con INSERT/UPDATE directos; el uso desde la función de creación
-- está en la sección 14.
-- Referencias: X (la usan A y B, cada uno la suya), Y (la usa A; B la manda
-- forzando el transportista_id de A), W (solo A) y N (un valor nuevo con el
-- que se intenta reescribir un client_ref).

-- Ejecuta una sentencia y devuelve 'OK' o 'sqlstate|constraint|mensaje'.
-- SECURITY INVOKER (por defecto): corre con el rol activo de la sesión, así
-- que sirve para probar permisos y RLS. El savepoint implícito del bloque
-- EXCEPTION deshace lo que haya hecho la sentencia si falla.
create or replace function public._test_sqlstate(p_sql text)
returns text language plpgsql as $$
declare v_state text; v_msg text; v_cons text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_cons = constraint_name;
  return v_state || '|' || coalesce(v_cons, '') || '|' || v_msg;
end;
$$;

select public._test_set('vref_x', 'eeeeeeee-0000-4000-8000-000000000001');
select public._test_set('vref_y', 'eeeeeeee-0000-4000-8000-000000000002');
select public._test_set('vref_w', 'eeeeeeee-0000-4000-8000-000000000003');
select public._test_set('vref_n', 'eeeeeeee-0000-4000-8000-000000000009');

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_id uuid; v_tid_x uuid; v_ref_x uuid; v_tid_y uuid; v_tid_w uuid;
begin
  insert into public.viajes (origen, destino, client_ref)
    values ('Origen X', 'Destino X', (public._test_get('vref_x'))::uuid)
    returning id, transportista_id, client_ref into v_id, v_tid_x, v_ref_x;
  perform public._test_set('viaje_ref_x_a_id', v_id::text);

  insert into public.viajes (origen, destino, client_ref)
    values ('Origen Y', 'Destino Y', (public._test_get('vref_y'))::uuid)
    returning transportista_id into v_tid_y;

  insert into public.viajes (origen, destino, client_ref)
    values ('Origen W', 'Destino W', (public._test_get('vref_w'))::uuid)
    returning id, transportista_id into v_id, v_tid_w;
  perform public._test_set('viaje_ref_w_a_id', v_id::text);

  perform public._test_chk(
    '13.1 A inserta viajes con client_ref (X, Y, W): quedan en su tenant con el client_ref intacto',
    v_tid_x = (public._test_get('tenant_a_id'))::uuid
      and v_tid_y = (public._test_get('tenant_a_id'))::uuid
      and v_tid_w = (public._test_get('tenant_a_id'))::uuid
      and v_ref_x = (public._test_get('vref_x'))::uuid,
    format('tenants=%s/%s/%s ref_x=%s', v_tid_x, v_tid_y, v_tid_w, v_ref_x));
exception when others then
  perform public._test_chk(
    '13.1 A inserta viajes con client_ref (X, Y, W): quedan en su tenant con el client_ref intacto',
    false, sqlerrm);
end
$$;

do $$
declare v_constraint text; v_n int;
begin
  insert into public.viajes (origen, destino, client_ref)
    values ('Origen X', 'Destino X', (public._test_get('vref_x'))::uuid);
  perform public._test_chk(
    '13.2 Reintento (INSERT directo) con el mismo client_ref falla con 23505 (índice viajes_transportista_client_ref_uidx) y sigue habiendo 1 fila',
    false, 'no lanzó excepción');
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    select count(*) into v_n from public.viajes where client_ref = (public._test_get('vref_x'))::uuid;
    perform public._test_chk(
      '13.2 Reintento (INSERT directo) con el mismo client_ref falla con 23505 (índice viajes_transportista_client_ref_uidx) y sigue habiendo 1 fila',
      v_constraint = 'viajes_transportista_client_ref_uidx' and v_n = 1,
      format('constraint=%s filas=%s :: %s', v_constraint, v_n, sqlerrm));
  when others then
    perform public._test_chk(
      '13.2 Reintento (INSERT directo) con el mismo client_ref falla con 23505 (índice viajes_transportista_client_ref_uidx) y sigue habiendo 1 fila',
      false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_ref uuid;
begin
  update public.viajes set client_ref = (public._test_get('vref_n'))::uuid
    where id = (public._test_get('viaje_ref_x_a_id'))::uuid;
  perform public._test_chk('13.3 UPDATE que cambia client_ref de un viaje (valor -> otro valor) falla', false, 'no lanzó excepción');
exception
  when insufficient_privilege then
    select client_ref into v_ref from public.viajes where id = (public._test_get('viaje_ref_x_a_id'))::uuid;
    perform public._test_chk('13.3 UPDATE que cambia client_ref de un viaje (valor -> otro valor) falla',
      sqlerrm like 'No se puede cambiar el client_ref de un viaje%' and v_ref = (public._test_get('vref_x'))::uuid, sqlerrm);
  when others then
    perform public._test_chk('13.3 UPDATE que cambia client_ref de un viaje (valor -> otro valor) falla', false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_ref uuid;
begin
  update public.viajes set client_ref = null
    where id = (public._test_get('viaje_ref_x_a_id'))::uuid;
  perform public._test_chk('13.4 UPDATE que borra client_ref de un viaje (valor -> NULL) falla', false, 'no lanzó excepción');
exception
  when insufficient_privilege then
    select client_ref into v_ref from public.viajes where id = (public._test_get('viaje_ref_x_a_id'))::uuid;
    perform public._test_chk('13.4 UPDATE que borra client_ref de un viaje (valor -> NULL) falla',
      sqlerrm like 'No se puede cambiar el client_ref de un viaje%' and v_ref = (public._test_get('vref_x'))::uuid, sqlerrm);
  when others then
    perform public._test_chk('13.4 UPDATE que borra client_ref de un viaje (valor -> NULL) falla', false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_ref uuid;
begin
  -- viaje_a_id es el viaje del setup, cargado sin client_ref.
  update public.viajes set client_ref = (public._test_get('vref_n'))::uuid
    where id = (public._test_get('viaje_a_id'))::uuid;
  perform public._test_chk('13.5 UPDATE que asigna client_ref a un viaje que no tenía (NULL -> valor) falla', false, 'no lanzó excepción');
exception
  when insufficient_privilege then
    select client_ref into v_ref from public.viajes where id = (public._test_get('viaje_a_id'))::uuid;
    perform public._test_chk('13.5 UPDATE que asigna client_ref a un viaje que no tenía (NULL -> valor) falla',
      sqlerrm like 'No se puede cambiar el client_ref de un viaje%' and v_ref is null, sqlerrm);
  when others then
    perform public._test_chk('13.5 UPDATE que asigna client_ref a un viaje que no tenía (NULL -> valor) falla', false, 'falló por otro motivo: ' || sqlerrm);
end
$$;

do $$
declare v_rows1 int; v_rows2 int; v_ref uuid; v_destino text; v_obs text;
begin
  update public.viajes set destino = 'Destino X editado'
    where id = (public._test_get('viaje_ref_x_a_id'))::uuid;
  get diagnostics v_rows1 = row_count;
  -- Reenviar el mismo client_ref (como haría un formulario que manda todo) tampoco molesta.
  update public.viajes set observaciones = 'editado', client_ref = client_ref
    where id = (public._test_get('viaje_ref_x_a_id'))::uuid;
  get diagnostics v_rows2 = row_count;
  select client_ref, destino, observaciones into v_ref, v_destino, v_obs
    from public.viajes where id = (public._test_get('viaje_ref_x_a_id'))::uuid;
  perform public._test_chk('13.6 UPDATE de otras columnas del viaje (con o sin reenviar el mismo client_ref) sigue funcionando',
    v_rows1 = 1 and v_rows2 = 1 and v_ref = (public._test_get('vref_x'))::uuid
      and v_destino = 'Destino X editado' and v_obs = 'editado',
    format('filas=%s/%s ref=%s destino=%s obs=%s', v_rows1, v_rows2, v_ref, v_destino, v_obs));
exception when others then
  perform public._test_chk('13.6 UPDATE de otras columnas del viaje (con o sin reenviar el mismo client_ref) sigue funcionando', false, sqlerrm);
end
$$;

do $$
declare v_antes int; v_despues int;
begin
  select count(*) into v_antes from public.viajes where client_ref is null;
  insert into public.viajes (origen, destino) values ('Sin ref 1', 'D');
  insert into public.viajes (origen, destino) values ('Sin ref 2', 'D');
  insert into public.viajes (origen, destino, client_ref) values ('Sin ref 3', 'D', null);
  select count(*) into v_despues from public.viajes where client_ref is null;
  perform public._test_chk('13.7 Varios viajes con client_ref NULL conviven (el índice parcial los ignora)',
    v_despues = v_antes + 3, format('antes=%s despues=%s', v_antes, v_despues));
exception when others then
  perform public._test_chk('13.7 Varios viajes con client_ref NULL conviven (el índice parcial los ignora)', false, sqlerrm);
end
$$;

do $$
declare v_rows int;
begin
  update public.viajes set observaciones = 'editado por A'
    where client_ref = (public._test_get('vref_w'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('13.8 UPDATE ... WHERE client_ref = W del dueño (A) afecta 1 fila', v_rows = 1, 'afectó ' || v_rows);
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_tid uuid; v_ref uuid; v_n int; v_tid_vista uuid; v_origen text;
begin
  insert into public.viajes (origen, destino, client_ref)
    values ('Origen B', 'Destino B', (public._test_get('vref_x'))::uuid)
    returning transportista_id, client_ref into v_tid, v_ref;
  select count(*), min(transportista_id::text)::uuid, min(origen)
    into v_n, v_tid_vista, v_origen
    from public.viajes where client_ref = (public._test_get('vref_x'))::uuid;
  perform public._test_chk(
    '13.9 B inserta con el MISMO client_ref X que ya usó A: funciona, queda en su tenant y ve solo su fila',
    v_tid = (public._test_get('tenant_b_id'))::uuid and v_ref = (public._test_get('vref_x'))::uuid
      and v_n = 1 and v_tid_vista = (public._test_get('tenant_b_id'))::uuid and v_origen = 'Origen B',
    format('tenant=%s filas=%s vista_de=%s origen=%s', v_tid, v_n, v_tid_vista, v_origen));
exception when others then
  perform public._test_chk(
    '13.9 B inserta con el MISMO client_ref X que ya usó A: funciona, queda en su tenant y ve solo su fila',
    false, sqlerrm);
end
$$;

-- Sin oráculo de existencia: B manda el transportista_id de A y un client_ref
-- que A ya usó (Y). El trigger pisa transportista_id antes de evaluar el índice.
do $$
declare v_tid uuid;
begin
  insert into public.viajes (transportista_id, origen, destino, client_ref)
    values ((public._test_get('tenant_a_id'))::uuid, 'Origen B2', 'Destino B2',
            (public._test_get('vref_y'))::uuid)
    returning transportista_id into v_tid;
  perform public._test_chk(
    '13.10 B forzando el transportista_id de A + un client_ref que A ya usó: sin error (sin oráculo) y la fila queda en B',
    v_tid = (public._test_get('tenant_b_id'))::uuid, 'quedó en ' || v_tid);
exception
  when unique_violation then
    perform public._test_chk(
      '13.10 B forzando el transportista_id de A + un client_ref que A ya usó: sin error (sin oráculo) y la fila queda en B',
      false, 'B recibió 23505: hay oráculo de existencia :: ' || sqlerrm);
  when others then
    perform public._test_chk(
      '13.10 B forzando el transportista_id de A + un client_ref que A ya usó: sin error (sin oráculo) y la fila queda en B',
      false, sqlerrm);
end
$$;

do $$
declare v_rows int;
begin
  update public.viajes set observaciones = 'editado por B'
    where client_ref = (public._test_get('vref_w'))::uuid;
  get diagnostics v_rows = row_count;
  perform public._test_chk('13.11 UPDATE ... WHERE client_ref = W de B (W es solo de A) afecta 0 filas', v_rows = 0, 'afectó ' || v_rows);
end
$$;

reset role;

-- Como postgres: X e Y una vez por tenant, W solo en A (con la edición de A),
-- y ningún (tenant, client_ref) duplicado.
do $$
declare v_x int; v_y int; v_w int; v_dups int; v_obs text;
begin
  select count(*) into v_x from public.viajes where client_ref = (public._test_get('vref_x'))::uuid;
  select count(*) into v_y from public.viajes where client_ref = (public._test_get('vref_y'))::uuid;
  select count(*) into v_w from public.viajes where client_ref = (public._test_get('vref_w'))::uuid;
  select count(*) into v_dups from (
    select transportista_id, client_ref from public.viajes
      where client_ref is not null group by 1, 2 having count(*) > 1
  ) d;
  select observaciones into v_obs from public.viajes where client_ref = (public._test_get('vref_w'))::uuid;
  perform public._test_chk(
    '13.12 Como postgres: X e Y una vez por tenant, W solo en A, sin duplicados por (tenant, client_ref) y W conserva la edición de A',
    v_x = 2 and v_y = 2 and v_w = 1 and v_dups = 0 and v_obs = 'editado por A',
    format('X=%s Y=%s W=%s duplicados=%s obs_w=%s', v_x, v_y, v_w, v_dups, v_obs));
end
$$;

-- ---------------------------------------------------------------------
-- 14) crear_viaje_con_entregas (migración 007)
-- ---------------------------------------------------------------------
-- La función es SECURITY INVOKER: corre con los privilegios de quien llama,
-- así que RLS y los triggers (transportista_id e id forzados) siguen
-- aplicando adentro. Se prueba el camino feliz, la idempotencia por
-- client_ref (devuelve el viaje existente y no reaplica nada), la
-- atomicidad (si algo falla no queda ni el viaje ni parte de las entregas),
-- que no sirva de oráculo entre tenants y los permisos de EXECUTE.
-- Nota: las pruebas de atomicidad corren dentro de un bloque con
-- EXCEPTION, que deshace la sentencia fallida igual que lo hace la
-- transacción de una llamada RPC (PostgREST).

select public._test_set('vref_f',   'eeeeeeee-0000-4000-8000-000000000011');
select public._test_set('vref_at1', 'eeeeeeee-0000-4000-8000-000000000012');
select public._test_set('vref_at2', 'eeeeeeee-0000-4000-8000-000000000013');
select public._test_set('vref_at3', 'eeeeeeee-0000-4000-8000-000000000014');
select public._test_set('vref_km',  'eeeeeeee-0000-4000-8000-000000000015');
select public._test_set('vref_cam', 'eeeeeeee-0000-4000-8000-000000000016');
select public._test_set('vref_100', 'eeeeeeee-0000-4000-8000-000000000017');
select public._test_set('vref_ign', 'eeeeeeee-0000-4000-8000-000000000018');
select public._test_set('vref_vac', 'eeeeeeee-0000-4000-8000-000000000019');
select public._test_set('vref_o1',  'eeeeeeee-0000-4000-8000-00000000001a');
select public._test_set('vref_o2',  'eeeeeeee-0000-4000-8000-00000000001b');
select public._test_set('vref_o3',  'eeeeeeee-0000-4000-8000-00000000001c');

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

-- Clientes extra de A para armar entregas (cliente_a_id viene del setup).
with ins as (insert into public.clientes (nombre) values ('Cliente A2 (viajes)') returning id)
select public._test_set('cliente_a2_id', id::text) from ins;
with ins as (insert into public.clientes (nombre) values ('Cliente A3 (viajes)') returning id)
select public._test_set('cliente_a3_id', id::text) from ins;

do $$
declare r record; v public.viajes%rowtype;
begin
  select * into r from public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_f'))::uuid,
    p_fecha => date '2026-03-10',
    p_origen => 'Rosario',
    p_destino => 'Mendoza',
    p_camion_id => (public._test_get('camion_a_id'))::uuid,
    p_km_inicial => 1000.0,
    p_km_final => 1500.5,
    p_observaciones => 'Carga completa',
    p_ingreso => 250000,
    p_entregas => jsonb_build_array(
      jsonb_build_object('cliente_id', public._test_get('cliente_a_id'),  'incidencias', '  Faltante de 2 cajas  '),
      jsonb_build_object('cliente_id', public._test_get('cliente_a2_id'), 'incidencias', '   '),
      jsonb_build_object('cliente_id', public._test_get('cliente_a3_id'))));
  perform public._test_set('viaje_f_id', r.viaje_id::text);
  select * into v from public.viajes where id = r.viaje_id;
  perform public._test_chk(
    '14.1 A crea un viaje con entregas: devuelve creado = true y el viaje queda en su tenant con todos los datos',
    r.creado is true
      and v.transportista_id = (public._test_get('tenant_a_id'))::uuid
      and v.client_ref = (public._test_get('vref_f'))::uuid
      and v.fecha = date '2026-03-10' and v.origen = 'Rosario' and v.destino = 'Mendoza'
      and v.camion_id = (public._test_get('camion_a_id'))::uuid
      and v.km_inicial = 1000.0 and v.km_final = 1500.5 and v.km_recorridos is null
      and v.observaciones = 'Carga completa' and v.ingreso = 250000,
    format('creado=%s tenant=%s fecha=%s km=%s/%s ingreso=%s', r.creado, v.transportista_id, v.fecha, v.km_inicial, v.km_final, v.ingreso));
exception when others then
  perform public._test_chk(
    '14.1 A crea un viaje con entregas: devuelve creado = true y el viaje queda en su tenant con todos los datos',
    false, sqlerrm);
end
$$;

do $$
declare v_n int; v_tids int; v_inc text[]; v_cli text[];
begin
  select count(*), count(*) filter (where e.transportista_id = (public._test_get('tenant_a_id'))::uuid),
         array_agg(e.incidencias order by e.created_at, e.id),
         array_agg(e.cliente_id::text order by e.created_at, e.id)
    into v_n, v_tids, v_inc, v_cli
    from public.entregas e
   where e.viaje_id = (public._test_get('viaje_f_id'))::uuid;
  perform public._test_chk(
    '14.2 Las 3 entregas quedan en el tenant de A, en el orden enviado y con las incidencias recortadas (vacías = NULL)',
    v_n = 3 and v_tids = 3
      and v_inc is not distinct from array['Faltante de 2 cajas', null, null]::text[]
      and v_cli = array[public._test_get('cliente_a_id'), public._test_get('cliente_a2_id'), public._test_get('cliente_a3_id')],
    format('n=%s tenant_a=%s incidencias=%s clientes=%s', v_n, v_tids, v_inc, v_cli));
end
$$;

-- Idempotencia: la misma llamada otra vez (reintento después de una respuesta perdida).
do $$
declare r record; v_viajes int; v_entregas int;
begin
  select * into r from public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_f'))::uuid,
    p_fecha => date '2026-03-10', p_origen => 'Rosario', p_destino => 'Mendoza',
    p_camion_id => (public._test_get('camion_a_id'))::uuid,
    p_km_inicial => 1000.0, p_km_final => 1500.5, p_observaciones => 'Carga completa', p_ingreso => 250000,
    p_entregas => jsonb_build_array(
      jsonb_build_object('cliente_id', public._test_get('cliente_a_id'),  'incidencias', '  Faltante de 2 cajas  '),
      jsonb_build_object('cliente_id', public._test_get('cliente_a2_id'), 'incidencias', '   '),
      jsonb_build_object('cliente_id', public._test_get('cliente_a3_id'))));
  select count(*) into v_viajes from public.viajes where client_ref = (public._test_get('vref_f'))::uuid;
  select count(*) into v_entregas from public.entregas where viaje_id = (public._test_get('viaje_f_id'))::uuid;
  perform public._test_chk(
    '14.3 Reintento con el mismo client_ref: devuelve el viaje existente con creado = false y no duplica el viaje ni las entregas',
    r.viaje_id = (public._test_get('viaje_f_id'))::uuid and r.creado is false and v_viajes = 1 and v_entregas = 3,
    format('viaje=%s creado=%s viajes=%s entregas=%s', r.viaje_id, r.creado, v_viajes, v_entregas));
exception when others then
  perform public._test_chk(
    '14.3 Reintento con el mismo client_ref: devuelve el viaje existente con creado = false y no duplica el viaje ni las entregas',
    false, sqlerrm);
end
$$;

-- Reintento con datos DISTINTOS: no se reaplican (ni siquiera se validan).
do $$
declare r record; v public.viajes%rowtype; v_entregas int;
begin
  select * into r from public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_f'))::uuid,
    p_fecha => date '2030-01-01', p_origen => 'Otro origen', p_destino => 'Otro destino',
    p_ingreso => 1,
    p_entregas => '[]'::jsonb);
  select * into v from public.viajes where id = (public._test_get('viaje_f_id'))::uuid;
  select count(*) into v_entregas from public.entregas where viaje_id = (public._test_get('viaje_f_id'))::uuid;
  perform public._test_chk(
    '14.4 Reintento con datos distintos: creado = false y el viaje conserva sus datos y sus 3 entregas (la creación no reaplica nada)',
    r.viaje_id = (public._test_get('viaje_f_id'))::uuid and r.creado is false
      and v.destino = 'Mendoza' and v.fecha = date '2026-03-10' and v.ingreso = 250000 and v_entregas = 3,
    format('creado=%s destino=%s fecha=%s ingreso=%s entregas=%s', r.creado, v.destino, v.fecha, v.ingreso, v_entregas));
exception when others then
  perform public._test_chk(
    '14.4 Reintento con datos distintos: creado = false y el viaje conserva sus datos y sus 3 entregas (la creación no reaplica nada)',
    false, sqlerrm);
end
$$;

-- Atomicidad 1: un cliente de OTRO tenant entre las entregas.
do $$
declare v_state text; v_msg text; v_n int; v_e0 int; v_e1 int;
begin
  select count(*) into v_e0 from public.entregas;
  perform public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_at1'))::uuid,
    p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
    p_entregas => jsonb_build_array(
      jsonb_build_object('cliente_id', public._test_get('cliente_a_id')),
      jsonb_build_object('cliente_id', public._test_get('cliente_b_id'))));
  perform public._test_chk('14.5 Cliente de otro tenant entre las entregas: falla con 23503 y no queda ni el viaje ni ninguna entrega', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select count(*) into v_n from public.viajes where client_ref = (public._test_get('vref_at1'))::uuid;
  select count(*) into v_e1 from public.entregas;
  perform public._test_set('err_cliente_invalido', v_state || '|' || v_msg);
  perform public._test_chk('14.5 Cliente de otro tenant entre las entregas: falla con 23503 y no queda ni el viaje ni ninguna entrega',
    v_state = '23503' and v_n = 0 and v_e0 = v_e1,
    format('sqlstate=%s viajes=%s entregas antes=%s despues=%s :: %s', v_state, v_n, v_e0, v_e1, v_msg));
end
$$;

-- Sin oráculo: un cliente que NO EXISTE da exactamente el mismo error que uno de otro tenant.
do $$
declare v_state text; v_msg text; v_n int;
begin
  perform public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_at3'))::uuid,
    p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
    p_entregas => jsonb_build_array(jsonb_build_object('cliente_id', gen_random_uuid()::text)));
  perform public._test_chk('14.6 Cliente inexistente: mismo SQLSTATE y mismo mensaje que un cliente de otro tenant (sin oráculo)', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select count(*) into v_n from public.viajes where client_ref = (public._test_get('vref_at3'))::uuid;
  perform public._test_chk('14.6 Cliente inexistente: mismo SQLSTATE y mismo mensaje que un cliente de otro tenant (sin oráculo)',
    (v_state || '|' || v_msg) = public._test_get('err_cliente_invalido') and v_n = 0,
    format('este=%s | el de otro tenant=%s | viajes=%s', v_state || '|' || v_msg, public._test_get('err_cliente_invalido'), v_n));
end
$$;

-- Atomicidad 2: la falla llega tarde (incidencias de 2001 caracteres en la 3ra entrega).
do $$
declare v_state text; v_msg text; v_n int; v_e0 int; v_e1 int;
begin
  select count(*) into v_e0 from public.entregas;
  perform public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_at2'))::uuid,
    p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
    p_entregas => jsonb_build_array(
      jsonb_build_object('cliente_id', public._test_get('cliente_a_id'),  'incidencias', 'ok'),
      jsonb_build_object('cliente_id', public._test_get('cliente_a2_id'), 'incidencias', 'ok'),
      jsonb_build_object('cliente_id', public._test_get('cliente_a3_id'), 'incidencias', repeat('x', 2001))));
  perform public._test_chk('14.7 Incidencias de 2001 caracteres en la 3ra entrega: falla con 23514 y no queda ni el viaje ni las 2 primeras entregas', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select count(*) into v_n from public.viajes where client_ref = (public._test_get('vref_at2'))::uuid;
  select count(*) into v_e1 from public.entregas;
  perform public._test_chk('14.7 Incidencias de 2001 caracteres en la 3ra entrega: falla con 23514 y no queda ni el viaje ni las 2 primeras entregas',
    v_state = '23514' and v_msg like '%entregas_incidencias_chk%' and v_n = 0 and v_e0 = v_e1,
    format('sqlstate=%s viajes=%s entregas antes=%s despues=%s :: %s', v_state, v_n, v_e0, v_e1, v_msg));
end
$$;

-- Atomicidad 3 y 4: el viaje mismo es inválido (modo de km mezclado / camión de otro tenant).
do $$
declare v_state text; v_msg text; v_n int; v_e0 int; v_e1 int;
begin
  select count(*) into v_e0 from public.entregas;
  perform public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_km'))::uuid,
    p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
    p_km_inicial => 10, p_km_recorridos => 100,
    p_entregas => jsonb_build_array(jsonb_build_object('cliente_id', public._test_get('cliente_a_id'))));
  perform public._test_chk('14.8 Viaje con km mezclados (recorridos + inicial): falla con 23514 viajes_chk_modo_km y no queda nada', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select count(*) into v_n from public.viajes where client_ref = (public._test_get('vref_km'))::uuid;
  select count(*) into v_e1 from public.entregas;
  perform public._test_chk('14.8 Viaje con km mezclados (recorridos + inicial): falla con 23514 viajes_chk_modo_km y no queda nada',
    v_state = '23514' and v_msg like '%viajes_chk_modo_km%' and v_n = 0 and v_e0 = v_e1,
    format('sqlstate=%s viajes=%s entregas antes=%s despues=%s :: %s', v_state, v_n, v_e0, v_e1, v_msg));
end
$$;

do $$
declare v_state text; v_msg text; v_n int; v_e0 int; v_e1 int;
begin
  select count(*) into v_e0 from public.entregas;
  perform public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_cam'))::uuid,
    p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
    p_camion_id => (public._test_get('camion_b_id'))::uuid,
    p_entregas => jsonb_build_array(jsonb_build_object('cliente_id', public._test_get('cliente_a_id'))));
  perform public._test_chk('14.9 Camión de otro tenant: falla con 23503 (viajes_camion_fk) y no queda nada', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select count(*) into v_n from public.viajes where client_ref = (public._test_get('vref_cam'))::uuid;
  select count(*) into v_e1 from public.entregas;
  perform public._test_chk('14.9 Camión de otro tenant: falla con 23503 (viajes_camion_fk) y no queda nada',
    v_state = '23503' and v_msg like '%viajes_camion_fk%' and v_n = 0 and v_e0 = v_e1,
    format('sqlstate=%s viajes=%s entregas antes=%s despues=%s :: %s', v_state, v_n, v_e0, v_e1, v_msg));
end
$$;

-- Origen y destino obligatorios (los exigen la NOT NULL y los checks de la tabla).
do $$
declare v_a text; v_b text; v_c text; v_n int;
begin
  v_a := public._test_sqlstate(format($q$select * from public.crear_viaje_con_entregas(
    p_client_ref => %L::uuid, p_fecha => current_date, p_origen => '   ', p_destino => 'Y')$q$, public._test_get('vref_o1')));
  v_b := public._test_sqlstate(format($q$select * from public.crear_viaje_con_entregas(
    p_client_ref => %L::uuid, p_fecha => current_date, p_origen => 'X', p_destino => null)$q$, public._test_get('vref_o2')));
  v_c := public._test_sqlstate(format($q$select * from public.crear_viaje_con_entregas(
    p_client_ref => %L::uuid, p_fecha => current_date, p_origen => %L, p_destino => 'Y')$q$, public._test_get('vref_o3'), repeat('o', 201)));
  select count(*) into v_n from public.viajes
    where client_ref in ((public._test_get('vref_o1'))::uuid, (public._test_get('vref_o2'))::uuid, (public._test_get('vref_o3'))::uuid);
  perform public._test_chk(
    '14.10 Origen en blanco (23514 viajes_origen_chk), destino nulo (23502) y origen de 201 caracteres (23514): se rechazan y no queda nada',
    v_a like '23514|%viajes_origen_chk%' and v_b like '23502|%' and v_c like '23514|%viajes_origen_chk%' and v_n = 0,
    format('a=%s | b=%s | c=%s | viajes=%s', v_a, v_b, v_c, v_n));
end
$$;

-- Parámetros inválidos: todos 22023.
do $$
declare
  v_cli text := public._test_get('cliente_a_id');
  v_sqls text[];
  v_res text[] := '{}';
  v_s text; v_ok boolean := true;
begin
  v_sqls := array[
    -- 1) client_ref nulo
    $q$select * from public.crear_viaje_con_entregas(p_client_ref => null::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'Y')$q$,
    -- 2) fecha nula
    format($q$select * from public.crear_viaje_con_entregas(p_client_ref => gen_random_uuid(), p_fecha => null::date, p_origen => 'X', p_destino => 'Y')$q$),
    -- 3) entregas nulo
    format($q$select * from public.crear_viaje_con_entregas(p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y', p_entregas => null::jsonb)$q$),
    -- 4) entregas es un objeto y no una lista
    format($q$select * from public.crear_viaje_con_entregas(p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y', p_entregas => '{"cliente_id":"x"}'::jsonb)$q$),
    -- 5) 101 entregas
    format($q$select * from public.crear_viaje_con_entregas(p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
      p_entregas => (select jsonb_agg(jsonb_build_object('cliente_id', %L)) from generate_series(1, 101)))$q$, v_cli),
    -- 6) elemento sin cliente_id
    format($q$select * from public.crear_viaje_con_entregas(p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y', p_entregas => '[{"incidencias":"x"}]'::jsonb)$q$),
    -- 7) cliente_id que no es un uuid
    format($q$select * from public.crear_viaje_con_entregas(p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y', p_entregas => '[{"cliente_id":"no-es-un-uuid"}]'::jsonb)$q$),
    -- 8) incidencias que no es texto
    format($q$select * from public.crear_viaje_con_entregas(p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
      p_entregas => jsonb_build_array(jsonb_build_object('cliente_id', %L, 'incidencias', 5)))$q$, v_cli),
    -- 9) elemento que no es un objeto
    format($q$select * from public.crear_viaje_con_entregas(p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y', p_entregas => '[1]'::jsonb)$q$)
  ];
  foreach v_s in array v_sqls loop
    v_res := v_res || public._test_sqlstate(v_s);
  end loop;
  select bool_and(r like '22023|%') into v_ok from unnest(v_res) as r;
  perform public._test_chk(
    '14.11 Parámetros inválidos (client_ref/fecha nulos, entregas nulo/objeto/101/mal formadas/incidencias no texto): todos fallan con 22023',
    v_ok, array_to_string(v_res, E'\n'));
end
$$;

-- El límite es de 100: exactamente 100 entregas pasan (con created_at escalonado).
do $$
declare r record; v_n int; v_distintos int;
begin
  select * into r from public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_100'))::uuid,
    p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
    p_entregas => (select jsonb_agg(jsonb_build_object('cliente_id', public._test_get('cliente_a_id'))) from generate_series(1, 100)));
  select count(*), count(distinct created_at) into v_n, v_distintos
    from public.entregas where viaje_id = r.viaje_id;
  perform public._test_chk('14.12 Exactamente 100 entregas se aceptan (creado = true, 100 entregas con created_at escalonado)',
    r.creado is true and v_n = 100 and v_distintos = 100,
    format('creado=%s entregas=%s created_at distintos=%s', r.creado, v_n, v_distintos));
exception when others then
  perform public._test_chk('14.12 Exactamente 100 entregas se aceptan (creado = true, 100 entregas con created_at escalonado)', false, sqlerrm);
end
$$;

-- El cliente nunca decide el tenant ni el id: las claves ajenas dentro de las entregas se ignoran.
do $$
declare r record; v_n int; v_tid uuid; v_id uuid; v_viaje uuid; v_vieja_viaje uuid;
begin
  select * into r from public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_ign'))::uuid,
    p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
    p_entregas => jsonb_build_array(jsonb_build_object(
      'id', public._test_get('entrega_a_id'),
      'transportista_id', public._test_get('tenant_b_id'),
      'viaje_id', public._test_get('viaje_b_id'),
      'cliente_id', public._test_get('cliente_a_id'),
      'incidencias', 'con claves ajenas')));
  select count(*), min(e.id::text)::uuid, min(e.transportista_id::text)::uuid, min(e.viaje_id::text)::uuid
    into v_n, v_id, v_tid, v_viaje
    from public.entregas e where e.viaje_id = r.viaje_id;
  select viaje_id into v_vieja_viaje from public.entregas where id = (public._test_get('entrega_a_id'))::uuid;
  perform public._test_chk('14.13 Claves ajenas dentro de las entregas (id, transportista_id, viaje_id) se ignoran: la entrega nace en el viaje nuevo, en el tenant de A y con id nuevo',
    v_n = 1 and v_id <> (public._test_get('entrega_a_id'))::uuid
      and v_tid = (public._test_get('tenant_a_id'))::uuid and v_viaje = r.viaje_id
      and v_vieja_viaje = (public._test_get('viaje_a_id'))::uuid,
    format('n=%s tenant=%s viaje_de_la_entrega_vieja=%s', v_n, v_tid, v_vieja_viaje));
exception when others then
  perform public._test_chk('14.13 Claves ajenas dentro de las entregas (id, transportista_id, viaje_id) se ignoran: la entrega nace en el viaje nuevo, en el tenant de A y con id nuevo', false, sqlerrm);
end
$$;

-- Sin p_entregas (default []) el viaje se crea sin entregas.
do $$
declare r record; v_n int;
begin
  select * into r from public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_vac'))::uuid,
    p_fecha => current_date, p_origen => 'X', p_destino => 'Y');
  select count(*) into v_n from public.entregas where viaje_id = r.viaje_id;
  perform public._test_chk('14.14 Sin p_entregas (valor por defecto) se crea el viaje sin entregas',
    r.creado is true and v_n = 0, format('creado=%s entregas=%s', r.creado, v_n));
exception when others then
  perform public._test_chk('14.14 Sin p_entregas (valor por defecto) se crea el viaje sin entregas', false, sqlerrm);
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

-- B usa el MISMO client_ref que A (vref_f): sin oráculo, es una creación normal.
do $$
declare r record; v_n int; v_tid uuid;
begin
  select * into r from public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_f'))::uuid,
    p_fecha => current_date, p_origen => 'Origen de B', p_destino => 'Destino de B',
    p_entregas => jsonb_build_array(jsonb_build_object('cliente_id', public._test_get('cliente_b_id'))));
  select count(*), min(transportista_id::text)::uuid into v_n, v_tid
    from public.viajes where client_ref = (public._test_get('vref_f'))::uuid;
  perform public._test_chk(
    '14.15 B crea con el MISMO client_ref que A: creado = true (indistinguible de una creación normal), en su tenant, y ve una sola fila con ese client_ref',
    r.creado is true and r.viaje_id <> (public._test_get('viaje_f_id'))::uuid
      and v_n = 1 and v_tid = (public._test_get('tenant_b_id'))::uuid,
    format('creado=%s viajes_vistos=%s tenant=%s', r.creado, v_n, v_tid));
exception when others then
  perform public._test_chk(
    '14.15 B crea con el MISMO client_ref que A: creado = true (indistinguible de una creación normal), en su tenant, y ve una sola fila con ese client_ref',
    false, sqlerrm);
end
$$;

reset role;

-- Permisos: anon no puede ejecutar ninguna de las dos funciones.
set local role anon;

do $$
declare v_ok1 boolean := false; v_ok2 boolean := false; v_m1 text; v_m2 text;
begin
  begin
    perform public.crear_viaje_con_entregas(
      p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y');
  exception when insufficient_privilege then
    v_ok1 := true; v_m1 := sqlerrm;
  when others then
    v_m1 := 'otro error: ' || sqlerrm;
  end;
  begin
    perform public.actualizar_viaje_con_entregas(
      p_viaje_id => (public._test_get('viaje_a_id'))::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
      p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null,
      p_observaciones => null, p_ingreso => null, p_entregas => '[]'::jsonb);
  exception when insufficient_privilege then
    v_ok2 := true; v_m2 := sqlerrm;
  when others then
    v_m2 := 'otro error: ' || sqlerrm;
  end;
  perform public._test_chk('14.16 anon no puede ejecutar crear_viaje_con_entregas ni actualizar_viaje_con_entregas (permission denied)',
    v_ok1 and v_ok2, format('crear: %s | actualizar: %s', v_m1, v_m2));
end
$$;

reset role;

-- Un usuario autenticado sin transportista no puede usar ninguna de las dos.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_sin_tenant'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_a text; v_b text;
begin
  v_a := public._test_sqlstate($q$select * from public.crear_viaje_con_entregas(
    p_client_ref => gen_random_uuid(), p_fecha => current_date, p_origen => 'X', p_destino => 'Y')$q$);
  v_b := public._test_sqlstate(format($q$select public.actualizar_viaje_con_entregas(
    p_viaje_id => %L::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'Y', p_camion_id => null,
    p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
    p_entregas => '[]'::jsonb)$q$, public._test_get('viaje_a_id')));
  perform public._test_chk('14.17 Un usuario sin transportista no puede crear ni actualizar viajes con las funciones (42501)',
    v_a like '42501|%No perteneces%' and v_b like '42501|%No perteneces%', format('crear: %s | actualizar: %s', v_a, v_b));
end
$$;

reset role;

-- Como postgres: definición de las funciones y de sus privilegios.
do $$
declare v_n int; v_invoker int; v_path int; v_anon int; v_public int; v_auth int;
begin
  select count(*),
         count(*) filter (where not p.prosecdef),
         count(*) filter (where p.proconfig::text like '%search_path=public%'),
         count(*) filter (where has_function_privilege('anon', p.oid, 'execute')),
         count(*) filter (where has_function_privilege('public', p.oid, 'execute')),
         count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))
    into v_n, v_invoker, v_path, v_anon, v_public, v_auth
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('crear_viaje_con_entregas', 'actualizar_viaje_con_entregas');
  perform public._test_chk(
    '14.18 Las 2 funciones son SECURITY INVOKER con search_path fijo, y EXECUTE solo para authenticated (no anon ni public)',
    v_n = 2 and v_invoker = 2 and v_path = 2 and v_anon = 0 and v_public = 0 and v_auth = 2,
    format('funciones=%s invoker=%s search_path=%s anon=%s public=%s authenticated=%s', v_n, v_invoker, v_path, v_anon, v_public, v_auth));
end
$$;

-- ---------------------------------------------------------------------
-- 15) actualizar_viaje_con_entregas (migración 007)
-- ---------------------------------------------------------------------
-- Reemplazo completo del viaje + sincronización de la lista de entregas:
-- con id se actualiza, sin id se inserta, las existentes que no vienen se
-- borran. Se prueba además que no toque entregas de otro viaje ni de otro
-- tenant, que no sirva de oráculo, que sea atómica, y el comportamiento de
-- las FK (borrar un viaje arrastra sus entregas; un gasto vinculado lo
-- frena).

select public._test_set('vref_u', 'eeeeeeee-0000-4000-8000-000000000021');

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

-- Viaje de trabajo U con 3 entregas (uno / dos / tres), creado con la función.
do $$
declare r record; v_ids uuid[];
begin
  select * into r from public.crear_viaje_con_entregas(
    p_client_ref => (public._test_get('vref_u'))::uuid,
    p_fecha => date '2026-04-01', p_origen => 'Santa Fe', p_destino => 'Salta', p_km_inicial => 500,
    p_entregas => jsonb_build_array(
      jsonb_build_object('cliente_id', public._test_get('cliente_a_id'),  'incidencias', 'uno'),
      jsonb_build_object('cliente_id', public._test_get('cliente_a2_id'), 'incidencias', 'dos'),
      jsonb_build_object('cliente_id', public._test_get('cliente_a3_id'), 'incidencias', 'tres')));
  perform public._test_set('viaje_u_id', r.viaje_id::text);
  select array_agg(e.id order by e.created_at, e.id) into v_ids from public.entregas e where e.viaje_id = r.viaje_id;
  perform public._test_set('entrega_u1_id', v_ids[1]::text);
  perform public._test_set('entrega_u2_id', v_ids[2]::text);
  perform public._test_set('entrega_u3_id', v_ids[3]::text);
  perform public._test_set('n_entregas_viaje_a',
    (select count(*)::text from public.entregas where viaje_id = (public._test_get('viaje_a_id'))::uuid));
  perform public._test_chk('15.0 setup: viaje U con 3 entregas (uno/dos/tres) creado con la función',
    r.creado is true and cardinality(v_ids) = 3, format('creado=%s entregas=%s', r.creado, cardinality(v_ids)));
exception when others then
  perform public._test_chk('15.0 setup: viaje U con 3 entregas (uno/dos/tres) creado con la función', false, sqlerrm);
end
$$;

-- Sincronización completa: e1 se edita, e2 desaparece (no viene), e3 cambia de
-- cliente y borra su incidencia (JSON null), y entra una entrega nueva. El viaje
-- se reemplaza entero (pasa del modo km inicial/final al modo km recorridos).
do $$
declare
  v public.viajes%rowtype; v_n int; v_tids int; v_e1 public.entregas%rowtype; v_e3 public.entregas%rowtype;
  v_e2_existe boolean; v_nuevas int; v_nueva_ok boolean;
begin
  perform public.actualizar_viaje_con_entregas(
    p_viaje_id => (public._test_get('viaje_u_id'))::uuid,
    p_fecha => date '2026-04-02',
    p_origen => 'Santa Fe II',
    p_destino => 'Jujuy',
    p_camion_id => null,
    p_km_inicial => null,
    p_km_final => null,
    p_km_recorridos => 321.5,
    p_observaciones => null,
    p_ingreso => 99,
    p_entregas => jsonb_build_array(
      jsonb_build_object('id', public._test_get('entrega_u1_id'), 'cliente_id', public._test_get('cliente_a_id'), 'incidencias', 'uno editado'),
      jsonb_build_object('id', public._test_get('entrega_u3_id'), 'cliente_id', public._test_get('cliente_a_id'), 'incidencias', null::text),
      jsonb_build_object('cliente_id', public._test_get('cliente_a2_id'), 'incidencias', 'nueva')));
  select * into v from public.viajes where id = (public._test_get('viaje_u_id'))::uuid;
  select * into v_e1 from public.entregas where id = (public._test_get('entrega_u1_id'))::uuid;
  select * into v_e3 from public.entregas where id = (public._test_get('entrega_u3_id'))::uuid;
  select exists(select 1 from public.entregas where id = (public._test_get('entrega_u2_id'))::uuid) into v_e2_existe;
  select count(*), count(*) filter (where transportista_id = (public._test_get('tenant_a_id'))::uuid)
    into v_n, v_tids from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  select count(*), coalesce(bool_and(e.cliente_id = (public._test_get('cliente_a2_id'))::uuid and e.incidencias = 'nueva'), false)
    into v_nuevas, v_nueva_ok
    from public.entregas e
   where e.viaje_id = (public._test_get('viaje_u_id'))::uuid
     and e.id not in ((public._test_get('entrega_u1_id'))::uuid, (public._test_get('entrega_u2_id'))::uuid, (public._test_get('entrega_u3_id'))::uuid);
  perform public._test_chk(
    '15.1 Sincronización: la entrega con id se actualiza, la que no viene se borra, la sin id se inserta (y los datos del viaje se reemplazan, null explícito incluido)',
    v.fecha = date '2026-04-02' and v.origen = 'Santa Fe II' and v.destino = 'Jujuy'
      and v.camion_id is null and v.km_inicial is null and v.km_final is null and v.km_recorridos = 321.5
      and v.observaciones is null and v.ingreso = 99
      and v.client_ref = (public._test_get('vref_u'))::uuid
      and v_e1.cliente_id = (public._test_get('cliente_a_id'))::uuid and v_e1.incidencias = 'uno editado'
      and v_e3.cliente_id = (public._test_get('cliente_a_id'))::uuid and v_e3.incidencias is null
      and not v_e2_existe and v_n = 3 and v_tids = 3 and v_nuevas = 1 and v_nueva_ok,
    format('viaje(%s/%s/%s km_rec=%s ingreso=%s) e1=%s/%s e3=%s/%s e2_existe=%s total=%s nuevas=%s',
      v.fecha, v.origen, v.destino, v.km_recorridos, v.ingreso, v_e1.cliente_id, v_e1.incidencias, v_e3.cliente_id, v_e3.incidencias,
      v_e2_existe, v_n, v_nuevas));
exception when others then
  perform public._test_chk(
    '15.1 Sincronización: la entrega con id se actualiza, la que no viene se borra, la sin id se inserta (y los datos del viaje se reemplazan, null explícito incluido)',
    false, sqlerrm);
end
$$;

-- No toca entregas de otros viajes del mismo tenant.
do $$
declare v_n_a int; v_viaje_vieja uuid; v_n_f int;
begin
  select count(*) into v_n_a from public.entregas where viaje_id = (public._test_get('viaje_a_id'))::uuid;
  select viaje_id into v_viaje_vieja from public.entregas where id = (public._test_get('entrega_a_id'))::uuid;
  select count(*) into v_n_f from public.entregas where viaje_id = (public._test_get('viaje_f_id'))::uuid;
  perform public._test_chk('15.2 Actualizar el viaje U no toca las entregas de otros viajes del mismo tenant (viaje del setup y viaje de 14.1)',
    v_n_a = (public._test_get('n_entregas_viaje_a'))::int
      and v_viaje_vieja = (public._test_get('viaje_a_id'))::uuid and v_n_f = 3,
    format('entregas del viaje del setup=%s (antes %s) entregas del viaje de 14.1=%s', v_n_a, public._test_get('n_entregas_viaje_a'), v_n_f));
end
$$;

-- Un id de entrega de OTRO viaje del mismo tenant no se mueve ni se borra: P0002.
do $$
declare v_state text; v_msg text; v_ids_antes uuid[]; v_ids_despues uuid[]; v_viaje_vieja uuid; v_destino text;
begin
  select array_agg(id order by id) into v_ids_antes from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  perform public.actualizar_viaje_con_entregas(
    p_viaje_id => (public._test_get('viaje_u_id'))::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'CAMBIO FALLIDO',
    p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
    p_entregas => jsonb_build_array(
      jsonb_build_object('id', public._test_get('entrega_a_id'), 'cliente_id', public._test_get('cliente_a_id'))));
  perform public._test_chk('15.3 Un id de entrega de otro viaje del mismo tenant: falla con P0002 y no se mueve, ni se borra nada', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select array_agg(id order by id) into v_ids_despues from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  select viaje_id into v_viaje_vieja from public.entregas where id = (public._test_get('entrega_a_id'))::uuid;
  select destino into v_destino from public.viajes where id = (public._test_get('viaje_u_id'))::uuid;
  perform public._test_chk('15.3 Un id de entrega de otro viaje del mismo tenant: falla con P0002 y no se mueve, ni se borra nada',
    v_state = 'P0002' and v_ids_antes = v_ids_despues and v_viaje_vieja = (public._test_get('viaje_a_id'))::uuid and v_destino = 'Jujuy',
    format('sqlstate=%s destino=%s :: %s', v_state, v_destino, v_msg));
end
$$;

-- Atomicidad: el viaje es válido pero una entrega nueva trae incidencias de 2001 caracteres.
do $$
declare v_state text; v_msg text; v_ids_antes uuid[]; v_ids_despues uuid[]; v_destino text; v_inc text;
begin
  select array_agg(id order by id) into v_ids_antes from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  perform public.actualizar_viaje_con_entregas(
    p_viaje_id => (public._test_get('viaje_u_id'))::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'CAMBIO FALLIDO',
    p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
    p_entregas => jsonb_build_array(
      jsonb_build_object('id', public._test_get('entrega_u1_id'), 'cliente_id', public._test_get('cliente_a_id'), 'incidencias', 'tocada'),
      jsonb_build_object('cliente_id', public._test_get('cliente_a2_id'), 'incidencias', repeat('x', 2001))));
  perform public._test_chk('15.4 Atomicidad: una entrega nueva con incidencias de 2001 caracteres hace fallar todo (23514) y el viaje y las entregas quedan como estaban', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select array_agg(id order by id) into v_ids_despues from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  select destino into v_destino from public.viajes where id = (public._test_get('viaje_u_id'))::uuid;
  select incidencias into v_inc from public.entregas where id = (public._test_get('entrega_u1_id'))::uuid;
  perform public._test_chk('15.4 Atomicidad: una entrega nueva con incidencias de 2001 caracteres hace fallar todo (23514) y el viaje y las entregas quedan como estaban',
    v_state = '23514' and v_msg like '%entregas_incidencias_chk%' and v_ids_antes = v_ids_despues
      and v_destino = 'Jujuy' and v_inc = 'uno editado',
    format('sqlstate=%s destino=%s incidencias_e1=%s :: %s', v_state, v_destino, v_inc, v_msg));
end
$$;

-- Un cliente de otro tenant: 23503 (mismo error que un cliente inexistente) y nada cambia.
do $$
declare v_state text; v_msg text; v_destino text; v_n int;
begin
  perform public.actualizar_viaje_con_entregas(
    p_viaje_id => (public._test_get('viaje_u_id'))::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'CAMBIO FALLIDO',
    p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
    p_entregas => jsonb_build_array(
      jsonb_build_object('id', public._test_get('entrega_u1_id'), 'cliente_id', public._test_get('cliente_b_id'))));
  perform public._test_chk('15.5 Cliente de otro tenant en una entrega existente: falla con 23503 (mismo error que en la creación) y nada cambia', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select destino into v_destino from public.viajes where id = (public._test_get('viaje_u_id'))::uuid;
  select count(*) into v_n from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  perform public._test_chk('15.5 Cliente de otro tenant en una entrega existente: falla con 23503 (mismo error que en la creación) y nada cambia',
    (v_state || '|' || v_msg) = public._test_get('err_cliente_invalido') and v_destino = 'Jujuy' and v_n = 3,
    format('%s | destino=%s entregas=%s', v_state || '|' || v_msg, v_destino, v_n));
end
$$;

-- Parámetros inválidos: todos 22023.
do $$
declare
  v_viaje text := public._test_get('viaje_u_id');
  v_e1 text := public._test_get('entrega_u1_id');
  v_cli text := public._test_get('cliente_a_id');
  v_base text;
  v_sqls text[];
  v_res text[] := '{}';
  v_s text; v_ok boolean;
begin
  v_base := $q$select public.actualizar_viaje_con_entregas(p_viaje_id => %L::uuid, p_fecha => %s, p_origen => 'X', p_destino => 'Y',
    p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
    p_entregas => %s)$q$;
  v_sqls := array[
    -- 1) ids repetidos
    format(v_base, v_viaje, 'current_date',
      format($q$jsonb_build_array(jsonb_build_object('id', %L, 'cliente_id', %L), jsonb_build_object('id', %L, 'cliente_id', %L))$q$, v_e1, v_cli, v_e1, v_cli)),
    -- 2) id que no es un uuid
    format(v_base, v_viaje, 'current_date',
      format($q$jsonb_build_array(jsonb_build_object('id', 'no-es-un-uuid', 'cliente_id', %L))$q$, v_cli)),
    -- 3) entregas nulo
    format(v_base, v_viaje, 'current_date', 'null::jsonb'),
    -- 4) entregas no es una lista
    format(v_base, v_viaje, 'current_date', $q$'{"cliente_id":"x"}'::jsonb$q$),
    -- 5) viaje_id nulo
    format(replace(v_base, '%L::uuid', '%s'), 'null::uuid', 'current_date', '''[]''::jsonb'),
    -- 6) fecha nula
    format(v_base, v_viaje, 'null::date', '''[]''::jsonb'),
    -- 7) 101 entregas
    format(v_base, v_viaje, 'current_date',
      format($q$(select jsonb_agg(jsonb_build_object('cliente_id', %L)) from generate_series(1, 101))$q$, v_cli))
  ];
  foreach v_s in array v_sqls loop
    v_res := v_res || public._test_sqlstate(v_s);
  end loop;
  select bool_and(r like '22023|%') into v_ok from unnest(v_res) as r;
  perform public._test_chk(
    '15.6 Parámetros inválidos (ids repetidos o mal formados, entregas nulo/objeto/101, viaje_id o fecha nulos): todos fallan con 22023',
    v_ok, array_to_string(v_res, E'\n'));
end
$$;

-- El viaje es inválido (km mezclados): falla y las entregas no se tocan.
do $$
declare v_state text; v_msg text; v_ids_antes uuid[]; v_ids_despues uuid[]; v_inc text;
begin
  select array_agg(id order by id) into v_ids_antes from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  perform public.actualizar_viaje_con_entregas(
    p_viaje_id => (public._test_get('viaje_u_id'))::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'Y',
    p_camion_id => null, p_km_inicial => 1, p_km_final => null, p_km_recorridos => 5, p_observaciones => null, p_ingreso => null,
    p_entregas => '[]'::jsonb);
  perform public._test_chk('15.7 Viaje con km mezclados: falla con 23514 viajes_chk_modo_km y las entregas no se tocan (la lista vacía no llegó a borrarlas)', false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select array_agg(id order by id) into v_ids_despues from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  perform public._test_chk('15.7 Viaje con km mezclados: falla con 23514 viajes_chk_modo_km y las entregas no se tocan (la lista vacía no llegó a borrarlas)',
    v_state = '23514' and v_msg like '%viajes_chk_modo_km%' and v_ids_antes = v_ids_despues and cardinality(v_ids_despues) = 3,
    format('sqlstate=%s entregas=%s :: %s', v_state, cardinality(v_ids_despues), v_msg));
end
$$;

-- Reemplazo completo: omitir un parámetro no borra datos en silencio, falla (42883).
do $$
declare v_res text; v_destino text;
begin
  v_res := public._test_sqlstate(format($q$select public.actualizar_viaje_con_entregas(
    p_viaje_id => %L::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'Y', p_camion_id => null,
    p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null,
    p_entregas => '[]'::jsonb)$q$, public._test_get('viaje_u_id')));  -- falta p_ingreso
  select destino into v_destino from public.viajes where id = (public._test_get('viaje_u_id'))::uuid;
  perform public._test_chk('15.8 Omitir un parámetro de la actualización falla (42883, función no encontrada) en vez de vaciar el campo en silencio',
    v_res like '42883|%' and v_destino = 'Jujuy', format('%s | destino=%s', v_res, v_destino));
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

-- B no puede actualizar el viaje de A, y el error es idéntico al de un viaje inexistente.
do $$
declare v_state text; v_msg text; v_state2 text; v_msg2 text;
begin
  begin
    perform public.actualizar_viaje_con_entregas(
      p_viaje_id => (public._test_get('viaje_u_id'))::uuid, p_fecha => current_date, p_origen => 'HACKEADO', p_destino => 'HACKEADO',
      p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
      p_entregas => '[]'::jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  begin
    perform public.actualizar_viaje_con_entregas(
      p_viaje_id => gen_random_uuid(), p_fecha => current_date, p_origen => 'HACKEADO', p_destino => 'HACKEADO',
      p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
      p_entregas => '[]'::jsonb);
  exception when others then
    get stacked diagnostics v_state2 = returned_sqlstate, v_msg2 = message_text;
  end;
  perform public._test_chk('15.9 B no puede actualizar el viaje de A: P0002 "No se encontró el viaje", idéntico al error de un viaje inexistente (sin oráculo)',
    v_state = 'P0002' and v_msg = 'No se encontró el viaje' and v_state = v_state2 and v_msg = v_msg2,
    format('viaje de A: %s|%s | inexistente: %s|%s', v_state, v_msg, v_state2, v_msg2));
end
$$;

-- B manda el id de una entrega de A dentro de SU PROPIO viaje: P0002, igual que un id inexistente.
do $$
declare v_state text; v_msg text; v_state2 text; v_msg2 text; v_destino text;
begin
  begin
    perform public.actualizar_viaje_con_entregas(
      p_viaje_id => (public._test_get('viaje_b_id'))::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'CAMBIO FALLIDO',
      p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
      p_entregas => jsonb_build_array(jsonb_build_object('id', public._test_get('entrega_u1_id'), 'cliente_id', public._test_get('cliente_b_id'))));
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  begin
    perform public.actualizar_viaje_con_entregas(
      p_viaje_id => (public._test_get('viaje_b_id'))::uuid, p_fecha => current_date, p_origen => 'X', p_destino => 'CAMBIO FALLIDO',
      p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => null, p_observaciones => null, p_ingreso => null,
      p_entregas => jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'cliente_id', public._test_get('cliente_b_id'))));
  exception when others then
    get stacked diagnostics v_state2 = returned_sqlstate, v_msg2 = message_text;
  end;
  select destino into v_destino from public.viajes where id = (public._test_get('viaje_b_id'))::uuid;
  perform public._test_chk('15.10 B manda el id de una entrega de A en su propio viaje: P0002, idéntico al de un id inexistente, y su viaje no cambia',
    v_state = 'P0002' and v_state = v_state2 and v_msg = v_msg2 and v_destino <> 'CAMBIO FALLIDO',
    format('entrega de A: %s|%s | inexistente: %s|%s | destino=%s', v_state, v_msg, v_state2, v_msg2, v_destino));
end
$$;

-- Camino feliz de B sobre su propio viaje (la función no lo "castiga" por existir A).
do $$
declare v_n int; v_tid uuid; v_inc text;
begin
  perform public.actualizar_viaje_con_entregas(
    p_viaje_id => (public._test_get('viaje_b_id'))::uuid, p_fecha => date '2026-05-01', p_origen => 'Santa Fe', p_destino => 'Buenos Aires',
    p_camion_id => (public._test_get('camion_b_id'))::uuid, p_km_inicial => null, p_km_final => null, p_km_recorridos => 480,
    p_observaciones => null, p_ingreso => null,
    p_entregas => jsonb_build_array(jsonb_build_object('cliente_id', public._test_get('cliente_b_id'), 'incidencias', 'de B')));
  select count(*), min(transportista_id::text)::uuid, min(incidencias)
    into v_n, v_tid, v_inc from public.entregas where viaje_id = (public._test_get('viaje_b_id'))::uuid;
  perform public._test_chk('15.11 B actualiza su propio viaje y agrega una entrega: queda en el tenant de B',
    v_n = 1 and v_tid = (public._test_get('tenant_b_id'))::uuid and v_inc = 'de B',
    format('entregas=%s tenant=%s incidencias=%s', v_n, v_tid, v_inc));
exception when others then
  perform public._test_chk('15.11 B actualiza su propio viaje y agrega una entrega: queda en el tenant de B', false, sqlerrm);
end
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

-- Lista vacía: se borran todas las entregas, el viaje y su client_ref siguen.
do $$
declare v_n int; v public.viajes%rowtype;
begin
  perform public.actualizar_viaje_con_entregas(
    p_viaje_id => (public._test_get('viaje_u_id'))::uuid, p_fecha => date '2026-04-02', p_origen => 'Santa Fe II', p_destino => 'Jujuy',
    p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => 321.5, p_observaciones => null, p_ingreso => 99,
    p_entregas => '[]'::jsonb);
  select count(*) into v_n from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  select * into v from public.viajes where id = (public._test_get('viaje_u_id'))::uuid;
  perform public._test_chk('15.12 Con una lista vacía se borran todas las entregas del viaje; el viaje y su client_ref siguen',
    v_n = 0 and v.id is not null and v.client_ref = (public._test_get('vref_u'))::uuid and v.destino = 'Jujuy',
    format('entregas=%s destino=%s', v_n, v.destino));
exception when others then
  perform public._test_chk('15.12 Con una lista vacía se borran todas las entregas del viaje; el viaje y su client_ref siguen', false, sqlerrm);
end
$$;

-- FK: borrar un viaje (DELETE directo) arrastra sus entregas (CASCADE) y no toca las de otros viajes.
do $$
declare v_antes int; v_despues int; v_otra boolean;
begin
  select count(*) into v_antes from public.entregas where viaje_id = (public._test_get('viaje_f_id'))::uuid;
  delete from public.viajes where id = (public._test_get('viaje_f_id'))::uuid;
  select count(*) into v_despues from public.entregas where viaje_id = (public._test_get('viaje_f_id'))::uuid;
  select exists(select 1 from public.entregas where id = (public._test_get('entrega_a_id'))::uuid) into v_otra;
  perform public._test_chk('15.13 Borrar el viaje de 14.1 borra en cascada sus 3 entregas y no toca la entrega de otro viaje',
    v_antes = 3 and v_despues = 0 and v_otra, format('entregas antes=%s despues=%s otra_entrega_existe=%s', v_antes, v_despues, v_otra));
exception when others then
  perform public._test_chk('15.13 Borrar el viaje de 14.1 borra en cascada sus 3 entregas y no toca la entrega de otro viaje', false, sqlerrm);
end
$$;

-- FK: un gasto vinculado impide borrar el viaje (RESTRICT) y el viaje y sus entregas siguen.
do $$
declare v_state text; v_msg text; v_viaje boolean; v_n int;
begin
  perform public.actualizar_viaje_con_entregas(
    p_viaje_id => (public._test_get('viaje_u_id'))::uuid, p_fecha => date '2026-04-02', p_origen => 'Santa Fe II', p_destino => 'Jujuy',
    p_camion_id => null, p_km_inicial => null, p_km_final => null, p_km_recorridos => 321.5, p_observaciones => null, p_ingreso => 99,
    p_entregas => jsonb_build_array(jsonb_build_object('cliente_id', public._test_get('cliente_a_id'), 'incidencias', 'queda')));
  insert into public.gastos (categoria_id, monto, viaje_id)
    values ((public._test_get('categoria_global_peajes_id'))::uuid, 500, (public._test_get('viaje_u_id'))::uuid);
  begin
    delete from public.viajes where id = (public._test_get('viaje_u_id'))::uuid;
    perform public._test_chk('15.14 Un gasto vinculado impide borrar el viaje (23503, RESTRICT de gastos_viaje_fk): el viaje y sus entregas siguen', false, 'no lanzó excepción');
    return;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  select exists(select 1 from public.viajes where id = (public._test_get('viaje_u_id'))::uuid) into v_viaje;
  select count(*) into v_n from public.entregas where viaje_id = (public._test_get('viaje_u_id'))::uuid;
  perform public._test_chk('15.14 Un gasto vinculado impide borrar el viaje (23503, RESTRICT de gastos_viaje_fk): el viaje y sus entregas siguen',
    v_state = '23503' and v_msg like '%gastos_viaje_fk%' and v_viaje and v_n = 1,
    format('sqlstate=%s viaje_existe=%s entregas=%s :: %s', v_state, v_viaje, v_n, v_msg));
exception when others then
  perform public._test_chk('15.14 Un gasto vinculado impide borrar el viaje (23503, RESTRICT de gastos_viaje_fk): el viaje y sus entregas siguen', false, sqlerrm);
end
$$;

reset role;

-- Como postgres: integridad general tras todo lo anterior.
do $$
declare v_cruzadas int; v_huerfanas int; v_destino_u text; v_destino_b text;
begin
  -- Ninguna entrega engancha un viaje de otro tenant ni un cliente de otro tenant.
  select count(*) into v_cruzadas
    from public.entregas e
    join public.viajes v on v.id = e.viaje_id
    join public.clientes c on c.id = e.cliente_id
   where e.transportista_id <> v.transportista_id or e.transportista_id <> c.transportista_id;
  select count(*) into v_huerfanas
    from public.entregas e where not exists (select 1 from public.viajes v where v.id = e.viaje_id);
  select destino into v_destino_u from public.viajes where id = (public._test_get('viaje_u_id'))::uuid;
  select destino into v_destino_b from public.viajes where id = (public._test_get('viaje_b_id'))::uuid;
  perform public._test_chk(
    '15.15 Como postgres: ninguna entrega cruza tenants (viaje o cliente), no hay huérfanas, y los viajes de A y de B solo tienen sus propios cambios',
    v_cruzadas = 0 and v_huerfanas = 0 and v_destino_u = 'Jujuy' and v_destino_b = 'Buenos Aires',
    format('cruzadas=%s huerfanas=%s destino_u=%s destino_b=%s', v_cruzadas, v_huerfanas, v_destino_u, v_destino_b));
end
$$;

-- ---------------------------------------------------------------------
-- 16) Vínculo gasto <-> viaje (Etapa 3, sin migración)
-- ---------------------------------------------------------------------
-- La Etapa 3 no agrega nada a la base: usa lo que ya existe desde 001 a 003
-- (gastos.viaje_id opcional, la FK compuesta gastos_viaje_fk
-- (transportista_id, viaje_id) -> viajes (transportista_id, id) con ON DELETE
-- RESTRICT, el índice gastos_transportista_viaje_idx y la policy por tenant de
-- gastos y viajes). El front va a: (a) vincular, cambiar y desvincular el
-- viaje de un gasto con un UPDATE de gastos.viaje_id; (b) listar los gastos de
-- un viaje (select ... where viaje_id = X) y embeber el viaje de cada gasto
-- (gastos -> viajes(origen, destino)); (c) borrar un viaje con gastos en dos
-- pasos idempotentes: "update gastos set viaje_id = null where viaje_id = X" y
-- después "delete from viajes where id = X" (las entregas se borran en
-- cascada; los gastos se conservan sin viaje). Esta sección prueba eso.
--
-- Datos propios (se crean acá; de las secciones anteriores solo se usan los
-- tenants y usuarios del setup y las categorías globales):
--   A: un cliente; viajes V1 a V5; gastos G1 y GC (sin viaje), GT (testigo,
--      en V1), G31/G32/G33 (en V3, con datos distintos: un peaje con método de
--      pago, un combustible con litros/odómetro/tanque lleno y un gasto con
--      client_ref) y G41 (en V4). V3 tiene 2 entregas, 1 devolución y 3
--      gastos; V4, 2 entregas y 1 gasto; V5, 1 entrega y ningún gasto.
--   B: un viaje VB con un gasto GB vinculado.
-- El INSERT de un gasto de B apuntando a un viaje de A ya lo cubre el caso 3.5
-- (no se repite). Acá se prueba el UPDATE, que es lo que va a usar el front.
--
-- Dos advertencias sobre estas pruebas:
-- * SQLSTATE de ON DELETE RESTRICT: en PostgreSQL 17 (la versión de Supabase
--   hoy) un DELETE que viola un RESTRICT da 23503 (foreign_key_violation), el
--   mismo código que una referencia inválida; en PostgreSQL 18 (p.ej. PGlite)
--   da 23001 (restrict_violation). El caso 15.14 y el 16.14 esperan 23503: si
--   Supabase sube a PostgreSQL 18 van a fallar a propósito (con el SQLSTATE
--   nuevo en el detalle) y habrá que mapear también 23001 en el front.
-- * La carrera del caso 16.14 se simula en orden (un gasto nuevo aparece entre
--   los dos pasos). Acá hay una sola conexión: no se puede reproducir el
--   solapamiento real de dos transacciones, que resuelve Postgres con locks de
--   fila (el INSERT del gasto toma FOR KEY SHARE sobre el viaje y el DELETE
--   necesita FOR UPDATE, así que se serializan y no puede quedar un gasto
--   apuntando a un viaje borrado).

-- Datos propios de A.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  v_peajes uuid := (public._test_get('categoria_global_peajes_id'))::uuid;
  v_comb uuid := (public._test_get('categoria_global_combustible_id'))::uuid;
  v_cli uuid; v_id uuid;
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid;
begin
  insert into public.clientes (nombre) values ('Cliente A (sección 16)') returning id into v_cli;
  perform public._test_set('s16_cliente_a', v_cli::text);

  insert into public.viajes (origen, destino) values ('Origen V1', 'Destino V1') returning id into v1;
  insert into public.viajes (origen, destino) values ('Origen V2', 'Destino V2') returning id into v2;
  insert into public.viajes (origen, destino) values ('Origen V3', 'Destino V3') returning id into v3;
  insert into public.viajes (origen, destino) values ('Origen V4', 'Destino V4') returning id into v4;
  insert into public.viajes (origen, destino) values ('Origen V5', 'Destino V5') returning id into v5;
  perform public._test_set('s16_v1', v1::text);
  perform public._test_set('s16_v2', v2::text);
  perform public._test_set('s16_v3', v3::text);
  perform public._test_set('s16_v4', v4::text);
  perform public._test_set('s16_v5', v5::text);

  insert into public.entregas (viaje_id, cliente_id)
    values (v3, v_cli), (v3, v_cli), (v4, v_cli), (v4, v_cli), (v5, v_cli);
  insert into public.devoluciones (viaje_id, cliente_id, motivo) values (v3, v_cli, 'otro');

  -- Sin viaje: G1 (se vincula y se mueve en 16.2 y 16.3) y GC (la usa el chofer en 16.16).
  insert into public.gastos (categoria_id, monto, descripcion)
    values (v_peajes, 1000, 'G1 sin viaje') returning id into v_id;
  perform public._test_set('s16_g1', v_id::text);
  insert into public.gastos (categoria_id, monto, descripcion)
    values (v_peajes, 80, 'GC sin viaje') returning id into v_id;
  perform public._test_set('s16_gc', v_id::text);

  -- Testigo: vinculado a V1 durante toda la sección; no tiene que moverse nunca.
  insert into public.gastos (categoria_id, monto, viaje_id)
    values (v_peajes, 300, v1) returning id into v_id;
  perform public._test_set('s16_gt', v_id::text);

  -- Los 3 gastos de V3, con columnas distintas entre sí para poder comprobar que desvincular no toca nada más.
  insert into public.gastos (categoria_id, monto, viaje_id, descripcion, metodo_pago, fecha)
    values (v_peajes, 1000.50, v3, 'Peaje autopista', 'efectivo', date '2026-06-01') returning id into v_id;
  perform public._test_set('s16_g31', v_id::text);
  insert into public.gastos (categoria_id, monto, viaje_id, litros, precio_por_litro, km_odometro, tanque_lleno)
    values (v_comb, 60600, v3, 50.5, 1200, 123456.7, true) returning id into v_id;
  perform public._test_set('s16_g32', v_id::text);
  insert into public.gastos (categoria_id, monto, viaje_id, client_ref)
    values (v_peajes, 250.25, v3, 'ffffffff-0000-4000-8000-000000000001') returning id into v_id;
  perform public._test_set('s16_g33', v_id::text);

  -- El gasto de V4 (el viaje de la carrera de 16.14 y 16.15).
  insert into public.gastos (categoria_id, monto, viaje_id)
    values (v_peajes, 700, v4) returning id into v_id;
  perform public._test_set('s16_g41', v_id::text);
exception when others then
  perform public._test_set('s16_error_setup_a', sqlerrm);
end
$$;

reset role;

-- Datos propios de B.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_vb uuid; v_gb uuid;
begin
  insert into public.viajes (origen, destino) values ('Origen VB', 'Destino VB') returning id into v_vb;
  insert into public.gastos (categoria_id, monto)
    values ((public._test_get('categoria_global_peajes_id'))::uuid, 400) returning id into v_gb;
  perform public._test_set('s16_vb', v_vb::text);
  perform public._test_set('s16_gb', v_gb::text);
  -- Control positivo del lado de B: vincula su propio gasto a su propio viaje (queda verificado en 16.0).
  update public.gastos set viaje_id = v_vb where id = v_gb;
exception when others then
  perform public._test_set('s16_error_setup_b', sqlerrm);
end
$$;

reset role;

-- Como postgres: los datos de la sección quedaron como se describe arriba.
do $$
declare
  c_caso constant text := '16.0 setup: A y B crearon sin excepciones sus viajes, entregas, devolución y gastos de la sección, y los vínculos quedaron como se esperaba';
  v_ta uuid := (public._test_get('tenant_a_id'))::uuid;
  v_tb uuid := (public._test_get('tenant_b_id'))::uuid;
  v1 uuid := (public._test_get('s16_v1'))::uuid;
  v2 uuid := (public._test_get('s16_v2'))::uuid;
  v3 uuid := (public._test_get('s16_v3'))::uuid;
  v4 uuid := (public._test_get('s16_v4'))::uuid;
  v5 uuid := (public._test_get('s16_v5'))::uuid;
  vb uuid := (public._test_get('s16_vb'))::uuid;
  g1 uuid := (public._test_get('s16_g1'))::uuid;
  gc uuid := (public._test_get('s16_gc'))::uuid;
  gt uuid := (public._test_get('s16_gt'))::uuid;
  g31 uuid := (public._test_get('s16_g31'))::uuid;
  g32 uuid := (public._test_get('s16_g32'))::uuid;
  g33 uuid := (public._test_get('s16_g33'))::uuid;
  g41 uuid := (public._test_get('s16_g41'))::uuid;
  gb uuid := (public._test_get('s16_gb'))::uuid;
  v_viajes_a int; v_viaje_b int; v_e3 int; v_e4 int; v_e5 int; v_d3 int;
  v_g1 int; v_gc int; v_gt int; v_g3 int; v_g41 int; v_gb int;
begin
  select count(*) into v_viajes_a from public.viajes where transportista_id = v_ta and id in (v1, v2, v3, v4, v5);
  select count(*) into v_viaje_b from public.viajes where transportista_id = v_tb and id = vb;
  select count(*) into v_e3 from public.entregas where transportista_id = v_ta and viaje_id = v3;
  select count(*) into v_e4 from public.entregas where transportista_id = v_ta and viaje_id = v4;
  select count(*) into v_e5 from public.entregas where transportista_id = v_ta and viaje_id = v5;
  select count(*) into v_d3 from public.devoluciones where transportista_id = v_ta and viaje_id = v3;
  select count(*) filter (where id = g1 and viaje_id is null and transportista_id = v_ta),
         count(*) filter (where id = gc and viaje_id is null and transportista_id = v_ta),
         count(*) filter (where id = gt and viaje_id = v1 and transportista_id = v_ta),
         count(*) filter (where id in (g31, g32, g33) and viaje_id = v3 and transportista_id = v_ta),
         count(*) filter (where id = g41 and viaje_id = v4 and transportista_id = v_ta),
         count(*) filter (where id = gb and viaje_id = vb and transportista_id = v_tb)
    into v_g1, v_gc, v_gt, v_g3, v_g41, v_gb
    from public.gastos
   where id in (g1, gc, gt, g31, g32, g33, g41, gb);

  perform public._test_chk(c_caso,
    public._test_get('s16_error_setup_a') is null and public._test_get('s16_error_setup_b') is null
      and v_viajes_a = 5 and v_viaje_b = 1 and v_e3 = 2 and v_e4 = 2 and v_e5 = 1 and v_d3 = 1
      and v_g1 = 1 and v_gc = 1 and v_gt = 1 and v_g3 = 3 and v_g41 = 1 and v_gb = 1,
    format('error_a=%s error_b=%s viajes_a=%s viaje_b=%s entregas(v3/v4/v5)=%s/%s/%s devoluciones_v3=%s gastos(g1/gc/gt/g3x/g41/gb)=%s/%s/%s/%s/%s/%s',
      public._test_get('s16_error_setup_a'), public._test_get('s16_error_setup_b'),
      v_viajes_a, v_viaje_b, v_e3, v_e4, v_e5, v_d3, v_g1, v_gc, v_gt, v_g3, v_g41, v_gb));
end
$$;

-- Como postgres: las piezas que usa la Etapa 3 existen tal cual se espera (sin migración).
do $$
declare
  c_caso constant text := '16.1 Sin migración: gastos_viaje_fk es una FK compuesta (transportista_id, viaje_id) -> viajes (transportista_id, id) ON DELETE RESTRICT, existe gastos_transportista_viaje_idx, y gastos y viajes tienen RLS con UNA sola policy (ALL, por tenant)';
  v_fk boolean; v_idx boolean; v_rls int; v_pol_total int; v_pol_ok int;
begin
  select exists (
    select 1
      from pg_constraint c
     where c.conname = 'gastos_viaje_fk'
       and c.contype = 'f'
       and c.conrelid = 'public.gastos'::regclass
       and c.confrelid = 'public.viajes'::regclass
       and c.confdeltype = 'r'
       and c.confmatchtype = 's'
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
           = array['transportista_id', 'viaje_id']
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(c.confkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
           = array['transportista_id', 'id']
  ) into v_fk;

  select exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'gastos'
       and indexname = 'gastos_transportista_viaje_idx'
       and indexdef like '%(transportista_id, viaje_id)%'
  ) into v_idx;

  select count(*) into v_rls
    from pg_class
   where oid in ('public.gastos'::regclass, 'public.viajes'::regclass) and relrowsecurity;

  select count(*), count(*) filter (
           where cmd = 'ALL' and roles = '{authenticated}'::name[]
             and qual like '%get_mi_transportista_id%' and with_check like '%get_mi_transportista_id%')
    into v_pol_total, v_pol_ok
    from pg_policies
   where schemaname = 'public' and tablename in ('gastos', 'viajes');

  perform public._test_chk(c_caso,
    v_fk and v_idx and v_rls = 2 and v_pol_total = 2 and v_pol_ok = 2,
    format('fk=%s indice=%s tablas_con_rls=%s policies=%s (de las cuales ALL/tenant=%s)', v_fk, v_idx, v_rls, v_pol_total, v_pol_ok));
end
$$;

-- A: vincular, cambiar y desvincular con UPDATE; listar y embeber.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  c_caso constant text := '16.2 A vincula un gasto propio a un viaje propio con UPDATE de viaje_id: queda el viaje_id y no cambia ni el tenant, ni el monto, ni la categoría';
  v_rows int; v_viaje uuid; v_tid uuid; v_monto numeric; v_cat uuid;
begin
  update public.gastos set viaje_id = (public._test_get('s16_v1'))::uuid
   where id = (public._test_get('s16_g1'))::uuid;
  get diagnostics v_rows = row_count;
  select viaje_id, transportista_id, monto, categoria_id into v_viaje, v_tid, v_monto, v_cat
    from public.gastos where id = (public._test_get('s16_g1'))::uuid;
  perform public._test_chk(c_caso,
    v_rows = 1 and v_viaje = (public._test_get('s16_v1'))::uuid
      and v_tid = (public._test_get('tenant_a_id'))::uuid and v_monto = 1000
      and v_cat = (public._test_get('categoria_global_peajes_id'))::uuid,
    format('filas=%s viaje=%s tenant=%s monto=%s categoria=%s', v_rows, v_viaje, v_tid, v_monto, v_cat));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '16.3 A cambia el gasto a otro viaje propio y después lo desvincula (viaje_id = null): ambos UPDATE funcionan y el gasto queda sin viaje, con el mismo monto';
  v_rows1 int; v_viaje1 uuid; v_rows2 int; v_viaje2 uuid; v_monto numeric;
begin
  update public.gastos set viaje_id = (public._test_get('s16_v2'))::uuid
   where id = (public._test_get('s16_g1'))::uuid;
  get diagnostics v_rows1 = row_count;
  select viaje_id into v_viaje1 from public.gastos where id = (public._test_get('s16_g1'))::uuid;

  update public.gastos set viaje_id = null
   where id = (public._test_get('s16_g1'))::uuid;
  get diagnostics v_rows2 = row_count;
  select viaje_id, monto into v_viaje2, v_monto
    from public.gastos where id = (public._test_get('s16_g1'))::uuid;

  perform public._test_chk(c_caso,
    v_rows1 = 1 and v_viaje1 = (public._test_get('s16_v2'))::uuid
      and v_rows2 = 1 and v_viaje2 is null and v_monto = 1000,
    format('cambio: filas=%s viaje=%s | desvincular: filas=%s viaje=%s monto=%s', v_rows1, v_viaje1, v_rows2, v_viaje2, v_monto));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

-- El "embed" de PostgREST (gastos -> viajes(origen, destino) por la FK compuesta)
-- se arma como un LEFT JOIN por (transportista_id, viaje_id): se reproduce acá.
do $$
declare
  c_caso constant text := '16.4 A lista los gastos de su viaje (where viaje_id = X) y ve exactamente los 3 de V3; el embed gastos -> viajes(origen, destino) trae el viaje correcto y vacío para un gasto sin viaje';
  v_ids uuid[]; v_n int; v_suma numeric; v_o1 text; v_d1 text; v_o2 text; v_d2 text;
begin
  select array_agg(id order by id), count(*), sum(monto) into v_ids, v_n, v_suma
    from public.gastos where viaje_id = (public._test_get('s16_v3'))::uuid;

  select v.origen, v.destino into v_o1, v_d1
    from public.gastos g
    left join public.viajes v on v.transportista_id = g.transportista_id and v.id = g.viaje_id
   where g.id = (public._test_get('s16_g31'))::uuid;
  select v.origen, v.destino into v_o2, v_d2
    from public.gastos g
    left join public.viajes v on v.transportista_id = g.transportista_id and v.id = g.viaje_id
   where g.id = (public._test_get('s16_g1'))::uuid;   -- G1 quedó sin viaje en 16.3

  perform public._test_chk(c_caso,
    v_n = 3
      and v_ids = (select array_agg(x order by x)
                     from unnest(array[(public._test_get('s16_g31'))::uuid, (public._test_get('s16_g32'))::uuid,
                                       (public._test_get('s16_g33'))::uuid]) as x)
      and v_suma = 61850.75
      and v_o1 = 'Origen V3' and v_d1 = 'Destino V3' and v_o2 is null and v_d2 is null,
    format('gastos de V3=%s suma=%s | embed de G31=%s -> %s | embed de G1 (sin viaje)=%s -> %s', v_n, v_suma, v_o1, v_d1, v_o2, v_d2));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

reset role;

-- B intenta engancharse a los viajes de A.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  c_caso constant text := '16.5 B no puede apuntar con UPDATE un gasto PROPIO a un viaje de A: falla con 23503 (gastos_viaje_fk) y el gasto sigue vinculado a su viaje y en el tenant de B';
  v_state text; v_msg text; v_viaje uuid; v_tid uuid;
begin
  begin
    update public.gastos set viaje_id = (public._test_get('s16_v3'))::uuid
     where id = (public._test_get('s16_gb'))::uuid;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  select viaje_id, transportista_id into v_viaje, v_tid
    from public.gastos where id = (public._test_get('s16_gb'))::uuid;
  perform public._test_chk(c_caso,
    v_state = '23503' and v_msg like '%gastos_viaje_fk%'
      and v_viaje = (public._test_get('s16_vb'))::uuid and v_tid = (public._test_get('tenant_b_id'))::uuid,
    format('sqlstate=%s viaje_del_gasto=%s tenant=%s :: %s', v_state, v_viaje, v_tid, v_msg));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

-- Sin oráculo de existencia: el error es el mismo para el viaje de A que para un viaje que no existe.
do $$
declare
  c_caso constant text := '16.6 El error de B al apuntar a un viaje de A es idéntico al de apuntar a un viaje inexistente (mismo SQLSTATE y mismo mensaje: no sirve de oráculo de existencia)';
  v_s1 text; v_m1 text; v_s2 text; v_m2 text;
begin
  begin
    update public.gastos set viaje_id = (public._test_get('s16_v3'))::uuid
     where id = (public._test_get('s16_gb'))::uuid;
  exception when others then
    get stacked diagnostics v_s1 = returned_sqlstate, v_m1 = message_text;
  end;
  begin
    update public.gastos set viaje_id = gen_random_uuid()
     where id = (public._test_get('s16_gb'))::uuid;
  exception when others then
    get stacked diagnostics v_s2 = returned_sqlstate, v_m2 = message_text;
  end;
  perform public._test_chk(c_caso,
    v_s1 is not null and v_s1 = v_s2 and v_m1 = v_m2,
    format('viaje de A: %s|%s | viaje inexistente: %s|%s', v_s1, v_m1, v_s2, v_m2));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

-- Un PATCH armado a mano que también manda transportista_id (mudar el gasto al tenant de A para engancharlo a su viaje).
do $$
declare
  c_caso constant text := '16.7 B no puede mudar un gasto propio al tenant de A (UPDATE de transportista_id y viaje_id de A): falla con 42501 y el gasto queda en B, con su viaje';
  v_state text; v_msg text; v_viaje uuid; v_tid uuid;
begin
  update public.gastos
     set transportista_id = (public._test_get('tenant_a_id'))::uuid,
         viaje_id = (public._test_get('s16_v3'))::uuid
   where id = (public._test_get('s16_gb'))::uuid;
  perform public._test_chk(c_caso, false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  select viaje_id, transportista_id into v_viaje, v_tid
    from public.gastos where id = (public._test_get('s16_gb'))::uuid;
  perform public._test_chk(c_caso,
    v_state = '42501' and v_msg like 'No se puede cambiar el transportista_id%'
      and v_viaje = (public._test_get('s16_vb'))::uuid and v_tid = (public._test_get('tenant_b_id'))::uuid,
    format('sqlstate=%s viaje_del_gasto=%s tenant=%s :: %s', v_state, v_viaje, v_tid, v_msg));
end
$$;

do $$
declare
  c_caso constant text := '16.8 B no ve los gastos de A al filtrar por el viaje_id de A (ni sumando transportista_id = A, ni con cualquiera de los viajes de A): 0 filas, aun sabiendo el id';
  v_n1 int; v_n2 int; v_n3 int; v_suma numeric;
begin
  select count(*), sum(monto) into v_n1, v_suma
    from public.gastos where viaje_id = (public._test_get('s16_v3'))::uuid;
  select count(*) into v_n2
    from public.gastos
   where viaje_id = (public._test_get('s16_v3'))::uuid
     and transportista_id = (public._test_get('tenant_a_id'))::uuid;
  select count(*) into v_n3
    from public.gastos
   where viaje_id in ((public._test_get('s16_v1'))::uuid, (public._test_get('s16_v2'))::uuid,
                      (public._test_get('s16_v3'))::uuid, (public._test_get('s16_v4'))::uuid,
                      (public._test_get('s16_v5'))::uuid);
  perform public._test_chk(c_caso,
    v_n1 = 0 and v_suma is null and v_n2 = 0 and v_n3 = 0,
    format('por viaje_id de A=%s (suma=%s) | con transportista_id de A=%s | por cualquier viaje de A=%s', v_n1, v_suma, v_n2, v_n3));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '16.9 El borrado en dos pasos hecho por B sobre un viaje de A (desvincular masivo y DELETE) afecta 0 filas en cada paso y no da error';
  v_r1 int; v_r2 int;
begin
  update public.gastos set viaje_id = null where viaje_id = (public._test_get('s16_v3'))::uuid;
  get diagnostics v_r1 = row_count;
  delete from public.viajes where id = (public._test_get('s16_v3'))::uuid;
  get diagnostics v_r2 = row_count;
  perform public._test_chk(c_caso, v_r1 = 0 and v_r2 = 0,
    format('desvincular afectó %s fila(s); DELETE afectó %s', v_r1, v_r2));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

reset role;

-- Como postgres: nada de A ni de B cambió por los intentos de B.
do $$
declare
  c_caso constant text := '16.10 Como postgres, tras los intentos de B: V3 de A conserva sus 3 gastos vinculados, sus 2 entregas y su devolución, y el gasto y el viaje de B siguen como estaban';
  v_ids uuid[]; v_viaje_a boolean; v_e3 int; v_d3 int; v_gb_viaje uuid; v_gb_tid uuid; v_viaje_b boolean;
begin
  select array_agg(id order by id) into v_ids from public.gastos where viaje_id = (public._test_get('s16_v3'))::uuid;
  select exists(select 1 from public.viajes where id = (public._test_get('s16_v3'))::uuid) into v_viaje_a;
  select count(*) into v_e3 from public.entregas where viaje_id = (public._test_get('s16_v3'))::uuid;
  select count(*) into v_d3 from public.devoluciones where viaje_id = (public._test_get('s16_v3'))::uuid;
  select viaje_id, transportista_id into v_gb_viaje, v_gb_tid from public.gastos where id = (public._test_get('s16_gb'))::uuid;
  select exists(select 1 from public.viajes
                 where id = (public._test_get('s16_vb'))::uuid and transportista_id = (public._test_get('tenant_b_id'))::uuid)
    into v_viaje_b;
  perform public._test_chk(c_caso,
    v_ids = (select array_agg(x order by x)
               from unnest(array[(public._test_get('s16_g31'))::uuid, (public._test_get('s16_g32'))::uuid,
                                 (public._test_get('s16_g33'))::uuid]) as x)
      and v_viaje_a and v_e3 = 2 and v_d3 = 1
      and v_gb_viaje = (public._test_get('s16_vb'))::uuid and v_gb_tid = (public._test_get('tenant_b_id'))::uuid and v_viaje_b,
    format('gastos de V3=%s viaje_existe=%s entregas=%s devoluciones=%s | GB: viaje=%s tenant=%s viaje_de_B_existe=%s',
      coalesce(cardinality(v_ids), 0), v_viaje_a, v_e3, v_d3, v_gb_viaje, v_gb_tid, v_viaje_b));
end
$$;

-- A: borrado en dos pasos, idempotencia y carrera.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  c_caso constant text := '16.11 A borra en dos pasos un viaje propio con 3 gastos, 2 entregas y 1 devolución: el viaje, sus entregas y su devolución desaparecen y los 3 gastos siguen, con viaje_id null y sin otros cambios';
  v1 uuid := (public._test_get('s16_v1'))::uuid;
  v3 uuid := (public._test_get('s16_v3'))::uuid;
  v4 uuid := (public._test_get('s16_v4'))::uuid;
  v_ids uuid[] := array[(public._test_get('s16_g31'))::uuid, (public._test_get('s16_g32'))::uuid, (public._test_get('s16_g33'))::uuid];
  v_antes jsonb; v_despues jsonb;
  v_total_antes int; v_total_despues int;
  v_r1 int; v_r2 int;
  v_viaje boolean; v_ent int; v_dev int; v_existen int; v_sin_viaje int;
  v_gt uuid; v_v1 boolean; v_e4 int;
begin
  select count(*) into v_total_antes from public.gastos;
  select jsonb_agg(to_jsonb(g) - 'viaje_id' - 'updated_at' order by g.id) into v_antes
    from public.gastos g where g.id = any (v_ids);

  -- Paso 1: desvincular. Paso 2: borrar el viaje.
  update public.gastos set viaje_id = null where viaje_id = v3;
  get diagnostics v_r1 = row_count;
  delete from public.viajes where id = v3;
  get diagnostics v_r2 = row_count;

  select exists(select 1 from public.viajes where id = v3) into v_viaje;
  select count(*) into v_ent from public.entregas where viaje_id = v3;
  select count(*) into v_dev from public.devoluciones where viaje_id = v3;
  select count(*), count(*) filter (where viaje_id is null) into v_existen, v_sin_viaje
    from public.gastos where id = any (v_ids);
  select jsonb_agg(to_jsonb(g) - 'viaje_id' - 'updated_at' order by g.id) into v_despues
    from public.gastos g where g.id = any (v_ids);
  select count(*) into v_total_despues from public.gastos;
  -- Testigos: el gasto de otro viaje sigue donde estaba y las entregas de otro viaje no se tocaron.
  select viaje_id into v_gt from public.gastos where id = (public._test_get('s16_gt'))::uuid;
  select exists(select 1 from public.viajes where id = v1) into v_v1;
  select count(*) into v_e4 from public.entregas where viaje_id = v4;

  perform public._test_chk(c_caso,
    v_r1 = 3 and v_r2 = 1 and not v_viaje and v_ent = 0 and v_dev = 0
      and v_existen = 3 and v_sin_viaje = 3
      and v_antes is not null and v_antes = v_despues
      and v_total_antes = v_total_despues
      and v_gt = v1 and v_v1 and v_e4 = 2,
    format('paso 1 afectó %s, paso 2 afectó %s | viaje_existe=%s entregas=%s devoluciones=%s | gastos existen=%s sin_viaje=%s sin_otros_cambios=%s | total de gastos %s -> %s | testigo en V1=%s viaje V1 existe=%s entregas de V4=%s',
      v_r1, v_r2, v_viaje, v_ent, v_dev, v_existen, v_sin_viaje, v_antes = v_despues,
      v_total_antes, v_total_despues, v_gt = v1, v_v1, v_e4));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '16.12 Borrar en dos pasos un viaje SIN gastos: el paso 1 afecta 0 filas sin error y el DELETE borra el viaje y su entrega';
  v5 uuid := (public._test_get('s16_v5'))::uuid;
  v_ent_antes int; v_r1 int; v_r2 int; v_viaje boolean; v_ent int;
begin
  select count(*) into v_ent_antes from public.entregas where viaje_id = v5;
  update public.gastos set viaje_id = null where viaje_id = v5;
  get diagnostics v_r1 = row_count;
  delete from public.viajes where id = v5;
  get diagnostics v_r2 = row_count;
  select exists(select 1 from public.viajes where id = v5) into v_viaje;
  select count(*) into v_ent from public.entregas where viaje_id = v5;
  perform public._test_chk(c_caso,
    v_ent_antes = 1 and v_r1 = 0 and v_r2 = 1 and not v_viaje and v_ent = 0,
    format('entregas antes=%s | paso 1 afectó %s, paso 2 afectó %s | viaje_existe=%s entregas despues=%s', v_ent_antes, v_r1, v_r2, v_viaje, v_ent));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '16.13 Idempotencia: repetir los dos pasos sobre los viajes ya borrados (V3 de 16.11 y V5 de 16.12) afecta 0 filas en cada paso y no da error';
  v3 uuid := (public._test_get('s16_v3'))::uuid;
  v5 uuid := (public._test_get('s16_v5'))::uuid;
  v_r1 int; v_r2 int; v_r3 int; v_r4 int;
begin
  update public.gastos set viaje_id = null where viaje_id = v3;
  get diagnostics v_r1 = row_count;
  delete from public.viajes where id = v3;
  get diagnostics v_r2 = row_count;
  update public.gastos set viaje_id = null where viaje_id = v5;
  get diagnostics v_r3 = row_count;
  delete from public.viajes where id = v5;
  get diagnostics v_r4 = row_count;
  perform public._test_chk(c_caso,
    v_r1 = 0 and v_r2 = 0 and v_r3 = 0 and v_r4 = 0,
    format('V3: desvincular=%s DELETE=%s | V5: desvincular=%s DELETE=%s', v_r1, v_r2, v_r3, v_r4));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

-- Carrera: entre el paso 1 y el paso 2 aparece un gasto nuevo vinculado al viaje.
do $$
declare
  c_caso constant text := '16.14 Carrera: si entre la desvinculación y el DELETE aparece un gasto nuevo vinculado al viaje, el DELETE falla con 23503 (gastos_viaje_fk) y no borra nada: el viaje y sus 2 entregas siguen';
  -- 23503 en PostgreSQL 17 (Supabase); PostgreSQL 18 da 23001. Ver la nota al principio de la sección.
  v_esperado constant text := '23503';
  v4 uuid := (public._test_get('s16_v4'))::uuid;
  v_r1 int; v_g42 uuid; v_state text; v_msg text;
  v_viaje boolean; v_ent int; v_g41_viaje uuid; v_g42_viaje uuid;
begin
  -- Paso 1 del primer intento: desvincula el único gasto (G41).
  update public.gastos set viaje_id = null where viaje_id = v4;
  get diagnostics v_r1 = row_count;

  -- Aparece un gasto nuevo vinculado a V4 (p.ej. una carga que se sincroniza justo ahora desde otro dispositivo).
  insert into public.gastos (categoria_id, monto, viaje_id)
    values ((public._test_get('categoria_global_peajes_id'))::uuid, 90, v4)
    returning id into v_g42;
  perform public._test_set('s16_g42', v_g42::text);

  -- Paso 2: el DELETE tiene que fallar.
  begin
    delete from public.viajes where id = v4;
    perform public._test_chk(c_caso, false, 'no lanzó excepción: el viaje se borró con un gasto vinculado');
    return;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  select exists(select 1 from public.viajes where id = v4) into v_viaje;
  select count(*) into v_ent from public.entregas where viaje_id = v4;
  select viaje_id into v_g41_viaje from public.gastos where id = (public._test_get('s16_g41'))::uuid;
  select viaje_id into v_g42_viaje from public.gastos where id = v_g42;

  perform public._test_chk(c_caso,
    v_r1 = 1 and v_state = v_esperado and v_msg like '%gastos_viaje_fk%'
      and v_viaje and v_ent = 2 and v_g41_viaje is null and v_g42_viaje = v4,
    format('paso 1 afectó %s | sqlstate=%s viaje_existe=%s entregas=%s G41.viaje=%s G42.viaje=%s :: %s',
      v_r1, v_state, v_viaje, v_ent, v_g41_viaje, v_g42_viaje, v_msg));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '16.15 Carrera: repetir los dos pasos lo completa: el viaje y sus entregas desaparecen y los 2 gastos (el original y el nuevo) siguen, con viaje_id null';
  v4 uuid := (public._test_get('s16_v4'))::uuid;
  v_r1 int; v_r2 int; v_viaje boolean; v_ent int; v_existen int; v_sin_viaje int;
begin
  update public.gastos set viaje_id = null where viaje_id = v4;
  get diagnostics v_r1 = row_count;
  delete from public.viajes where id = v4;
  get diagnostics v_r2 = row_count;
  select exists(select 1 from public.viajes where id = v4) into v_viaje;
  select count(*) into v_ent from public.entregas where viaje_id = v4;
  select count(*), count(*) filter (where viaje_id is null) into v_existen, v_sin_viaje
    from public.gastos
   where id in ((public._test_get('s16_g41'))::uuid, (public._test_get('s16_g42'))::uuid);
  perform public._test_chk(c_caso,
    v_r1 = 1 and v_r2 = 1 and not v_viaje and v_ent = 0 and v_existen = 2 and v_sin_viaje = 2,
    format('paso 1 afectó %s, paso 2 afectó %s | viaje_existe=%s entregas=%s | gastos existen=%s sin_viaje=%s', v_r1, v_r2, v_viaje, v_ent, v_existen, v_sin_viaje));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

reset role;

-- El chofer de A: la policy es por tenant, no por rol.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_chofer'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  c_caso constant text := '16.16 El chofer de A (rol chofer) también vincula y desvincula gastos de A con UPDATE de viaje_id: la policy es por tenant, no por rol';
  v1 uuid := (public._test_get('s16_v1'))::uuid;
  gc uuid := (public._test_get('s16_gc'))::uuid;
  v_rol public.rol_miembro; v_r1 int; v_viaje1 uuid; v_vistos int; v_r2 int; v_viaje2 uuid;
begin
  select rol into v_rol from public.miembros where user_id = (public._test_get('uid_a_chofer'))::uuid;

  update public.gastos set viaje_id = v1 where id = gc;
  get diagnostics v_r1 = row_count;
  select viaje_id into v_viaje1 from public.gastos where id = gc;
  select count(*) into v_vistos from public.gastos where viaje_id = v1;   -- el testigo GT + GC

  update public.gastos set viaje_id = null where id = gc;
  get diagnostics v_r2 = row_count;
  select viaje_id into v_viaje2 from public.gastos where id = gc;

  perform public._test_chk(c_caso,
    v_rol = 'chofer' and v_r1 = 1 and v_viaje1 = v1 and v_vistos = 2 and v_r2 = 1 and v_viaje2 is null,
    format('rol=%s | vincular: filas=%s viaje=%s gastos vistos en V1=%s | desvincular: filas=%s viaje=%s', v_rol, v_r1, v_viaje1, v_vistos, v_r2, v_viaje2));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

reset role;

-- Como postgres: integridad general de los vínculos en toda la base.
do $$
declare
  c_caso constant text := '16.17 Como postgres: ningún gasto de toda la base apunta a un viaje de otro tenant ni a un viaje inexistente (y hay gastos vinculados, para que el chequeo no sea vacío)';
  v_cruzados int; v_huerfanos int; v_vinculados int;
begin
  -- Se une solo por id (sin el tenant) a propósito: así un cruce entre tenants no se esconde detrás de la FK compuesta.
  select count(*) into v_cruzados
    from public.gastos g join public.viajes v on v.id = g.viaje_id
   where v.transportista_id <> g.transportista_id;
  select count(*) into v_huerfanos
    from public.gastos g
   where g.viaje_id is not null and not exists (select 1 from public.viajes v where v.id = g.viaje_id);
  select count(*) into v_vinculados from public.gastos where viaje_id is not null;
  perform public._test_chk(c_caso,
    v_cruzados = 0 and v_huerfanos = 0 and v_vinculados > 0,
    format('cruzados=%s huerfanos=%s gastos vinculados=%s', v_cruzados, v_huerfanos, v_vinculados));
end
$$;

-- ---------------------------------------------------------------------
-- 17) Devoluciones: CRUD, aislamiento y client_ref (migración 008)
-- ---------------------------------------------------------------------
-- Requiere 008_devoluciones_client_ref.sql aplicada. La Etapa 4 no usa
-- funciones de base: el front guarda cada devolución con un INSERT directo
-- con client_ref (si falla con 23505 en devoluciones_transportista_client_
-- ref_uidx, la devolución ya estaba guardada), la edita con UPDATE (por id,
-- o por client_ref si el usuario cambió datos entre intentos), la borra con
-- DELETE y la lista con SELECT. Esta sección prueba eso y que RLS, las FK
-- compuestas y los triggers de 002 y 008 lo sostienen entre tenants.
-- Lo que ya cubren otras secciones no se repite: el INSERT de B apuntando a
-- un viaje o a un cliente de A (3.3 y 3.4), que anon no lee devoluciones
-- (8.8) y el aislamiento básico por id (1.9, 1.16 y 1.21). El borrado en dos
-- pasos de un viaje con gastos y una devolución ya está en 16.11; acá se suma
-- solo lo que ese caso no mira.
--
-- Datos propios (se crean acá; de las secciones anteriores solo se usan los
-- tenants y usuarios del setup, y el helper _test_sqlstate de la sección 13):
--   A: clientes CA1, CA2, CA3 y CAR (CA3 y CAR sin ninguna entrega; CA2 con
--      una entrega solo en V2), viajes V1, V2 y VC (una entrega cada uno:
--      V1-CA1, V2-CA2 y VC-CA1) y una devolución DCH que usa el chofer.
--   B: un cliente CB y un viaje VB.
-- Referencias: X (la usan A y B, cada uno la suya), Y (la usa A; B la manda
-- forzando el transportista_id de A), W (solo A), N (un valor nuevo con el
-- que se intenta reescribir un client_ref) y CH (la usa el chofer).
--
-- SQLSTATE de ON DELETE RESTRICT: en PostgreSQL 17 (la versión de Supabase
-- hoy) un DELETE que viola un RESTRICT da 23503 (foreign_key_violation); en
-- PostgreSQL 18 (p.ej. PGlite 0.5.x) da 23001 (restrict_violation). El caso
-- nuevo de esta sección que depende de eso (17.18) acepta los dos códigos,
-- para que el archivo corra igual en las dos versiones sin parchear nada.
-- Los casos 15.14 y 16.14 siguen exigiendo 23503 (ver la nota de la 16).

select public._test_set('s17_ref_x',  'ffffffff-0000-4000-8000-000000001701');
select public._test_set('s17_ref_y',  'ffffffff-0000-4000-8000-000000001702');
select public._test_set('s17_ref_w',  'ffffffff-0000-4000-8000-000000001703');
select public._test_set('s17_ref_n',  'ffffffff-0000-4000-8000-000000001704');
select public._test_set('s17_ref_ch', 'ffffffff-0000-4000-8000-000000001705');

-- Helper de esta sección: ejecuta una sentencia y devuelve 'OK' o TODO lo que
-- PostgREST le expone al cliente de un error (code, message, details, hint),
-- más el constraint, en un texto de varias líneas. A diferencia de
-- _test_sqlstate (que usan las secciones 13 a 15 y no se toca) incluye el
-- DETAIL y el HINT. SECURITY INVOKER: corre con el rol activo de la sesión,
-- así que el DETAIL es el que vería el cliente real (con RLS, no el del owner).
create or replace function public._test_error_completo(p_sql text)
returns text language plpgsql as $$
declare v_state text; v_msg text; v_cons text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_cons = constraint_name,
                          v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return 'sqlstate=' || v_state || E'\nconstraint=' || coalesce(v_cons, '')
      || E'\nmessage=' || coalesce(v_msg, '')
      || E'\ndetail=' || coalesce(v_detail, '')
      || E'\nhint=' || coalesce(v_hint, '');
end;
$$;

-- Datos propios de A.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare c1 uuid; c2 uuid; c3 uuid; cr uuid; v1 uuid; v2 uuid; vc uuid; v_dch uuid;
begin
  insert into public.clientes (nombre) values ('Cliente A1 (sección 17)') returning id into c1;
  insert into public.clientes (nombre) values ('Cliente A2 (sección 17)') returning id into c2;
  insert into public.clientes (nombre) values ('Cliente A3 sin entregas (sección 17)') returning id into c3;
  insert into public.clientes (nombre) values ('Cliente AR para el RESTRICT (sección 17)') returning id into cr;
  perform public._test_set('s17_ca1', c1::text);
  perform public._test_set('s17_ca2', c2::text);
  perform public._test_set('s17_ca3', c3::text);
  perform public._test_set('s17_car', cr::text);

  insert into public.viajes (origen, destino) values ('Origen S17-1', 'Destino S17-1') returning id into v1;
  insert into public.viajes (origen, destino) values ('Origen S17-2', 'Destino S17-2') returning id into v2;
  insert into public.viajes (origen, destino) values ('Origen S17-C', 'Destino S17-C') returning id into vc;
  perform public._test_set('s17_v1', v1::text);
  perform public._test_set('s17_v2', v2::text);
  perform public._test_set('s17_vc', vc::text);

  insert into public.entregas (viaje_id, cliente_id) values (v1, c1), (v2, c2), (vc, c1);

  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values (v1, c1, 'otro', 'DCH: la crea el admin y la usa el chofer') returning id into v_dch;
  perform public._test_set('s17_dch', v_dch::text);
exception when others then
  perform public._test_set('s17_error_setup_a', sqlerrm);
end
$$;

reset role;

-- Datos propios de B.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_cb uuid; v_vb uuid;
begin
  insert into public.clientes (nombre) values ('Cliente B (sección 17)') returning id into v_cb;
  insert into public.viajes (origen, destino) values ('Origen S17-B', 'Destino S17-B') returning id into v_vb;
  perform public._test_set('s17_cb', v_cb::text);
  perform public._test_set('s17_vb', v_vb::text);
exception when others then
  perform public._test_set('s17_error_setup_b', sqlerrm);
end
$$;

reset role;

-- Como postgres: los datos de la sección quedaron como se describe arriba.
do $$
declare
  c_caso constant text := '17.0 setup: A y B crearon sin excepciones los clientes, viajes, entregas y la devolución DCH de la sección (A: 4 clientes -CA3 y CAR sin ninguna entrega-, 3 viajes, 3 entregas y 1 devolución; B: 1 cliente y 1 viaje), todo en su tenant';
  v_ta uuid := (public._test_get('tenant_a_id'))::uuid;
  v_tb uuid := (public._test_get('tenant_b_id'))::uuid;
  ca1 uuid := (public._test_get('s17_ca1'))::uuid;
  ca2 uuid := (public._test_get('s17_ca2'))::uuid;
  ca3 uuid := (public._test_get('s17_ca3'))::uuid;
  car uuid := (public._test_get('s17_car'))::uuid;
  v1 uuid := (public._test_get('s17_v1'))::uuid;
  v2 uuid := (public._test_get('s17_v2'))::uuid;
  vc uuid := (public._test_get('s17_vc'))::uuid;
  cb uuid := (public._test_get('s17_cb'))::uuid;
  vb uuid := (public._test_get('s17_vb'))::uuid;
  v_clientes_a int; v_sin_entregas int; v_viajes_a int; v_entregas_a int; v_dev_a int; v_cliente_b int; v_viaje_b int;
begin
  select count(*) into v_clientes_a from public.clientes where transportista_id = v_ta and id in (ca1, ca2, ca3, car);
  select count(*) into v_sin_entregas from public.entregas where cliente_id in (ca3, car);
  select count(*) into v_viajes_a from public.viajes where transportista_id = v_ta and id in (v1, v2, vc);
  select count(*) into v_entregas_a from public.entregas where transportista_id = v_ta and viaje_id in (v1, v2, vc);
  select count(*) into v_dev_a from public.devoluciones
   where transportista_id = v_ta and id = (public._test_get('s17_dch'))::uuid and viaje_id = v1 and cliente_id = ca1;
  select count(*) into v_cliente_b from public.clientes where transportista_id = v_tb and id = cb;
  select count(*) into v_viaje_b from public.viajes where transportista_id = v_tb and id = vb;
  perform public._test_chk(c_caso,
    public._test_get('s17_error_setup_a') is null and public._test_get('s17_error_setup_b') is null
      and v_clientes_a = 4 and v_sin_entregas = 0 and v_viajes_a = 3 and v_entregas_a = 3 and v_dev_a = 1
      and v_cliente_b = 1 and v_viaje_b = 1,
    format('error_a=%s error_b=%s clientes_a=%s entregas_de_CA3_y_CAR=%s viajes_a=%s entregas_a=%s DCH=%s cliente_b=%s viaje_b=%s',
      public._test_get('s17_error_setup_a'), public._test_get('s17_error_setup_b'),
      v_clientes_a, v_sin_entregas, v_viajes_a, v_entregas_a, v_dev_a, v_cliente_b, v_viaje_b));
end
$$;

-- Como postgres: las piezas de la migración 008.
do $$
declare
  c_caso constant text := '17.1 Migración 008: devoluciones.client_ref existe, es uuid, admite NULL, no tiene default y tiene comentario';
  v_tipo text; v_notnull boolean; v_default boolean; v_comentario text;
begin
  select a.atttypid::regtype::text, a.attnotnull, a.atthasdef, col_description(a.attrelid, a.attnum)
    into v_tipo, v_notnull, v_default, v_comentario
    from pg_attribute a
   where a.attrelid = 'public.devoluciones'::regclass and a.attname = 'client_ref' and not a.attisdropped;
  perform public._test_chk(c_caso,
    v_tipo = 'uuid' and v_notnull is false and v_default is false and v_comentario is not null,
    format('tipo=%s not_null=%s default=%s comentario=%s', v_tipo, v_notnull, v_default, v_comentario is not null));
end
$$;

do $$
declare
  c_caso constant text := '17.2 Migración 008: devoluciones_transportista_client_ref_uidx es un índice ÚNICO y PARCIAL (where client_ref is not null) sobre (transportista_id, client_ref), en ese orden y sin otras columnas ni expresiones';
  v_unico boolean; v_valido boolean; v_pred text; v_nkeys int; v_expr boolean; v_cols text[];
begin
  select i.indisunique, i.indisvalid, pg_get_expr(i.indpred, i.indrelid), i.indnkeyatts, i.indexprs is not null,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
    into v_unico, v_valido, v_pred, v_nkeys, v_expr, v_cols
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where i.indrelid = 'public.devoluciones'::regclass and c.relname = 'devoluciones_transportista_client_ref_uidx';
  perform public._test_chk(c_caso,
    v_unico and v_valido and v_pred = '(client_ref IS NOT NULL)' and v_nkeys = 2 and v_expr is false
      and v_cols = array['transportista_id', 'client_ref']::text[],
    format('unico=%s valido=%s predicado=%s columnas=%s (de clave: %s) expresiones=%s', v_unico, v_valido, v_pred, v_cols, v_nkeys, v_expr));
end
$$;

do $$
declare
  c_caso constant text := '17.3 Migración 008: fn_bloquear_cambio_client_ref_devolucion es SECURITY INVOKER con search_path fijo y sin EXECUTE para anon, authenticated ni public; trg_25_bloquear_cambio_client_ref es BEFORE UPDATE FOR EACH ROW sobre devoluciones y está habilitado; los BEFORE UPDATE de la tabla disparan en el orden trg_20 -> trg_25 -> trg_30';
  v_fn oid; v_invoker boolean; v_path boolean; v_anon boolean; v_auth boolean; v_public boolean;
  v_trg int; v_orden text[];
begin
  select p.oid, not p.prosecdef, coalesce(p.proconfig::text like '%search_path=public%', false),
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('public', p.oid, 'execute')
    into v_fn, v_invoker, v_path, v_anon, v_auth, v_public
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_bloquear_cambio_client_ref_devolucion';

  -- tgtype: 1 = FOR EACH ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE.
  select count(*) into v_trg
    from pg_trigger t
   where t.tgrelid = 'public.devoluciones'::regclass
     and t.tgname = 'trg_25_bloquear_cambio_client_ref'
     and t.tgfoid = v_fn
     and not t.tgisinternal and t.tgenabled = 'O'
     and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16
     and (t.tgtype & (4 | 8 | 32)) = 0;

  select array_agg(t.tgname::text order by t.tgname) into v_orden
    from pg_trigger t
   where t.tgrelid = 'public.devoluciones'::regclass and not t.tgisinternal
     and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;

  perform public._test_chk(c_caso,
    v_fn is not null and v_invoker and v_path and v_anon is false and v_auth is false and v_public is false
      and v_trg = 1
      and v_orden = array['trg_20_bloquear_cambio_transportista_id', 'trg_25_bloquear_cambio_client_ref', 'trg_30_set_updated_at']::text[],
    format('funcion=%s invoker=%s search_path=%s EXECUTE anon=%s authenticated=%s public=%s | trigger 25 ok=%s | BEFORE UPDATE en orden: %s',
      v_fn is not null, v_invoker, v_path, v_anon, v_auth, v_public, v_trg = 1, v_orden));
end
$$;

-- A: alta con client_ref, edición, validaciones y client_ref inmutable.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  c_caso constant text := '17.4 A inserta devoluciones con motivo, descripción y client_ref (X, Y, W) sobre un viaje y un cliente propios: quedan en su tenant, con el client_ref intacto (la primera, con todos sus datos)';
  v_id uuid; v_tid uuid; v_ref uuid; v_motivo public.motivo_devolucion; v_desc text; v_viaje uuid; v_cli uuid;
  v_id_y uuid; v_tid_y uuid; v_ref_y uuid; v_id_w uuid; v_tid_w uuid; v_ref_w uuid;
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid,
            'rotura_danio', 'D1 original', (public._test_get('s17_ref_x'))::uuid)
    returning id, transportista_id, client_ref, motivo, descripcion, viaje_id, cliente_id
      into v_id, v_tid, v_ref, v_motivo, v_desc, v_viaje, v_cli;
  perform public._test_set('s17_d1', v_id::text);

  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid,
            'otro', 'DY', (public._test_get('s17_ref_y'))::uuid)
    returning id, transportista_id, client_ref into v_id_y, v_tid_y, v_ref_y;
  perform public._test_set('s17_dy', v_id_y::text);

  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid,
            'vencimiento', 'DW', (public._test_get('s17_ref_w'))::uuid)
    returning id, transportista_id, client_ref into v_id_w, v_tid_w, v_ref_w;
  perform public._test_set('s17_dw', v_id_w::text);

  perform public._test_chk(c_caso,
    v_tid = (public._test_get('tenant_a_id'))::uuid
      and v_tid_y = (public._test_get('tenant_a_id'))::uuid
      and v_tid_w = (public._test_get('tenant_a_id'))::uuid
      and v_ref = (public._test_get('s17_ref_x'))::uuid
      and v_ref_y = (public._test_get('s17_ref_y'))::uuid
      and v_ref_w = (public._test_get('s17_ref_w'))::uuid
      and v_motivo = 'rotura_danio' and v_desc = 'D1 original'
      and v_viaje = (public._test_get('s17_v1'))::uuid and v_cli = (public._test_get('s17_ca1'))::uuid,
    format('tenants=%s/%s/%s refs=%s/%s/%s motivo=%s desc=%s', v_tid, v_tid_y, v_tid_w, v_ref, v_ref_y, v_ref_w, v_motivo, v_desc));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.5 A edita su devolución (motivo, descripción y cliente) con UPDATE: se aplican los 3 cambios y no cambian ni el tenant, ni el client_ref, ni el viaje, ni el id';
  v_rows int; v_id uuid; v_tid uuid; v_ref uuid; v_motivo public.motivo_devolucion; v_desc text; v_viaje uuid; v_cli uuid;
begin
  update public.devoluciones
     set motivo = 'vencimiento', descripcion = 'D1 editada', cliente_id = (public._test_get('s17_ca2'))::uuid
   where id = (public._test_get('s17_d1'))::uuid;
  get diagnostics v_rows = row_count;
  select id, transportista_id, client_ref, motivo, descripcion, viaje_id, cliente_id
    into v_id, v_tid, v_ref, v_motivo, v_desc, v_viaje, v_cli
    from public.devoluciones where id = (public._test_get('s17_d1'))::uuid;
  perform public._test_chk(c_caso,
    v_rows = 1 and v_id = (public._test_get('s17_d1'))::uuid
      and v_motivo = 'vencimiento' and v_desc = 'D1 editada' and v_cli = (public._test_get('s17_ca2'))::uuid
      and v_tid = (public._test_get('tenant_a_id'))::uuid and v_ref = (public._test_get('s17_ref_x'))::uuid
      and v_viaje = (public._test_get('s17_v1'))::uuid,
    format('filas=%s motivo=%s desc=%s cliente=%s tenant=%s ref=%s viaje=%s', v_rows, v_motivo, v_desc, v_cli, v_tid, v_ref, v_viaje));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

-- Decisión de producto: la base no relaciona la devolución con las entregas.
do $$
declare
  c_caso constant text := '17.6 La base NO exige que el cliente de la devolución tenga una entrega en ese viaje (decisión de producto: el front ofrece primero los clientes del viaje pero permite "Otros clientes"): un cliente propio sin ninguna entrega, o con entregas solo en otro viaje, se acepta';
  v_sin_entregas boolean; v_otro_viaje boolean; v_tid1 uuid; v_tid2 uuid;
begin
  select not exists (select 1 from public.entregas where cliente_id = (public._test_get('s17_ca3'))::uuid)
    into v_sin_entregas;
  select not exists (select 1 from public.entregas
                      where viaje_id = (public._test_get('s17_v1'))::uuid and cliente_id = (public._test_get('s17_ca2'))::uuid)
         and exists (select 1 from public.entregas
                      where viaje_id = (public._test_get('s17_v2'))::uuid and cliente_id = (public._test_get('s17_ca2'))::uuid)
    into v_otro_viaje;

  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca3'))::uuid, 'mercaderia_incorrecta', 'cliente sin entregas')
    returning transportista_id into v_tid1;
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca2'))::uuid, 'otro', 'cliente con entrega en otro viaje')
    returning transportista_id into v_tid2;

  perform public._test_chk(c_caso,
    v_sin_entregas and v_otro_viaje
      and v_tid1 = (public._test_get('tenant_a_id'))::uuid and v_tid2 = (public._test_get('tenant_a_id'))::uuid,
    format('CA3 sin entregas=%s | CA2 sin entrega en V1 y con una en V2=%s | tenants=%s/%s', v_sin_entregas, v_otro_viaje, v_tid1, v_tid2));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.7 Reintento (INSERT directo) con el mismo client_ref falla con 23505 en el índice devoluciones_transportista_client_ref_uidx, sin DETAIL con los valores de la clave, y sigue habiendo 1 fila';
  v_state text; v_msg text; v_constraint text; v_detail text; v_n int;
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid,
            'rotura_danio', 'D1 original', (public._test_get('s17_ref_x'))::uuid);
  perform public._test_chk(c_caso, false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text,
                          v_constraint = constraint_name, v_detail = pg_exception_detail;
  select count(*) into v_n from public.devoluciones where client_ref = (public._test_get('s17_ref_x'))::uuid;
  perform public._test_chk(c_caso,
    v_state = '23505' and v_constraint = 'devoluciones_transportista_client_ref_uidx'
      and v_msg like '%devoluciones_transportista_client_ref_uidx%' and nullif(v_detail, '') is null and v_n = 1,
    format('sqlstate=%s constraint=%s detail=%s filas=%s :: %s', v_state, v_constraint, coalesce(v_detail, '(sin detalle)'), v_n, v_msg));
end
$$;

do $$
declare
  c_caso constant text := '17.8 Varias devoluciones con client_ref NULL conviven en el mismo tenant (omitido u omitido, o NULL explícito): el índice parcial las ignora';
  v_antes int; v_despues int; v_id uuid;
begin
  select count(*) into v_antes from public.devoluciones where client_ref is null;
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid, 'otro', 'sin ref 1')
    returning id into v_id;
  perform public._test_set('s17_dnull', v_id::text);
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid, 'otro', 'sin ref 2');
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid, 'otro', 'sin ref 3', null);
  select count(*) into v_despues from public.devoluciones where client_ref is null;
  perform public._test_chk(c_caso, v_despues = v_antes + 3, format('antes=%s despues=%s', v_antes, v_despues));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.9 UPDATE que cambia client_ref (valor -> otro valor) falla con 42501 y la fila queda exactamente igual';
  v_antes jsonb; v_despues jsonb; v_res text;
begin
  select to_jsonb(d) into v_antes from public.devoluciones d where d.id = (public._test_get('s17_d1'))::uuid;
  v_res := public._test_sqlstate(format(
    'update public.devoluciones set client_ref = %L::uuid where id = %L::uuid',
    public._test_get('s17_ref_n'), public._test_get('s17_d1')));
  select to_jsonb(d) into v_despues from public.devoluciones d where d.id = (public._test_get('s17_d1'))::uuid;
  perform public._test_chk(c_caso,
    v_res like '42501|%No se puede cambiar el client_ref de una devolución%' and v_antes is not null and v_antes = v_despues,
    format('resultado=%s | fila igual=%s', v_res, v_antes = v_despues));
end
$$;

do $$
declare
  c_caso constant text := '17.10 UPDATE que borra el client_ref (valor -> NULL) falla con 42501 y la fila queda exactamente igual';
  v_antes jsonb; v_despues jsonb; v_res text;
begin
  select to_jsonb(d) into v_antes from public.devoluciones d where d.id = (public._test_get('s17_d1'))::uuid;
  v_res := public._test_sqlstate(format(
    'update public.devoluciones set client_ref = null where id = %L::uuid', public._test_get('s17_d1')));
  select to_jsonb(d) into v_despues from public.devoluciones d where d.id = (public._test_get('s17_d1'))::uuid;
  perform public._test_chk(c_caso,
    v_res like '42501|%No se puede cambiar el client_ref de una devolución%' and v_antes is not null and v_antes = v_despues,
    format('resultado=%s | fila igual=%s', v_res, v_antes = v_despues));
end
$$;

do $$
declare
  c_caso constant text := '17.11 UPDATE que asigna client_ref a una devolución que no tenía (NULL -> valor) falla con 42501 y la fila queda exactamente igual';
  v_antes jsonb; v_despues jsonb; v_res text;
begin
  select to_jsonb(d) into v_antes from public.devoluciones d where d.id = (public._test_get('s17_dnull'))::uuid;
  v_res := public._test_sqlstate(format(
    'update public.devoluciones set client_ref = %L::uuid where id = %L::uuid',
    public._test_get('s17_ref_n'), public._test_get('s17_dnull')));
  select to_jsonb(d) into v_despues from public.devoluciones d where d.id = (public._test_get('s17_dnull'))::uuid;
  perform public._test_chk(c_caso,
    v_res like '42501|%No se puede cambiar el client_ref de una devolución%'
      and v_antes is not null and v_antes = v_despues and (v_despues ->> 'client_ref') is null,
    format('resultado=%s | fila igual=%s', v_res, v_antes = v_despues));
end
$$;

do $$
declare
  c_caso constant text := '17.12 UPDATE de otras columnas sigue funcionando: sin mencionar el client_ref, reenviando el MISMO valor, o reenviando NULL en una fila que no lo tenía (NULL -> NULL)';
  v_r1 int; v_r2 int; v_r3 int; v_ref uuid; v_motivo public.motivo_devolucion; v_desc text; v_ref_null uuid; v_desc_null text;
begin
  update public.devoluciones set descripcion = 'D1 editada 2'
   where id = (public._test_get('s17_d1'))::uuid;
  get diagnostics v_r1 = row_count;
  -- Reenviar el mismo client_ref (como haría un formulario que manda todo) tampoco molesta.
  update public.devoluciones set motivo = 'otro', client_ref = (public._test_get('s17_ref_x'))::uuid
   where id = (public._test_get('s17_d1'))::uuid;
  get diagnostics v_r2 = row_count;
  update public.devoluciones set descripcion = 'sin ref 1 editada', client_ref = null
   where id = (public._test_get('s17_dnull'))::uuid;
  get diagnostics v_r3 = row_count;
  select client_ref, motivo, descripcion into v_ref, v_motivo, v_desc
    from public.devoluciones where id = (public._test_get('s17_d1'))::uuid;
  select client_ref, descripcion into v_ref_null, v_desc_null
    from public.devoluciones where id = (public._test_get('s17_dnull'))::uuid;
  perform public._test_chk(c_caso,
    v_r1 = 1 and v_r2 = 1 and v_r3 = 1
      and v_ref = (public._test_get('s17_ref_x'))::uuid and v_motivo = 'otro' and v_desc = 'D1 editada 2'
      and v_ref_null is null and v_desc_null = 'sin ref 1 editada',
    format('filas=%s/%s/%s | D1: ref=%s motivo=%s desc=%s | sin ref: ref=%s desc=%s', v_r1, v_r2, v_r3, v_ref, v_motivo, v_desc, v_ref_null, v_desc_null));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.13 UPDATE ... WHERE client_ref = W del dueño (A) -el reintento con datos cambiados- afecta 1 fila y cambia solo lo pedido';
  v_rows int; v_desc text; v_motivo public.motivo_devolucion; v_ref uuid; v_tid uuid; v_viaje uuid; v_cli uuid;
begin
  update public.devoluciones set descripcion = 'DW editada por A', motivo = 'rotura_danio'
   where client_ref = (public._test_get('s17_ref_w'))::uuid;
  get diagnostics v_rows = row_count;
  select descripcion, motivo, client_ref, transportista_id, viaje_id, cliente_id
    into v_desc, v_motivo, v_ref, v_tid, v_viaje, v_cli
    from public.devoluciones where id = (public._test_get('s17_dw'))::uuid;
  perform public._test_chk(c_caso,
    v_rows = 1 and v_desc = 'DW editada por A' and v_motivo = 'rotura_danio'
      and v_ref = (public._test_get('s17_ref_w'))::uuid and v_tid = (public._test_get('tenant_a_id'))::uuid
      and v_viaje = (public._test_get('s17_v1'))::uuid and v_cli = (public._test_get('s17_ca1'))::uuid,
    format('filas=%s desc=%s motivo=%s ref=%s tenant=%s', v_rows, v_desc, v_motivo, v_ref, v_tid));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

-- Validaciones de la tabla que el front espeja.
do $$
declare
  c_caso constant text := '17.14 Descripción: 2000 caracteres (contados como caracteres, no bytes) y NULL se aceptan; 2001 falla con 23514 (devoluciones_descripcion_chk) en INSERT y en UPDATE, y el UPDATE fallido no cambia la fila';
  v_id_max uuid; v_id_null uuid; v_largo text; v_upd text; v_largo_fila int;
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid, 'otro', repeat('ñ', 2000))
    returning id into v_id_max;
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid, 'otro', null)
    returning id into v_id_null;
  v_largo := public._test_sqlstate(format(
    'insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion) values (%L::uuid, %L::uuid, ''otro'', %L)',
    public._test_get('s17_v1'), public._test_get('s17_ca1'), repeat('ñ', 2001)));
  v_upd := public._test_sqlstate(format(
    'update public.devoluciones set descripcion = %L where id = %L::uuid', repeat('ñ', 2001), v_id_max));
  select length(descripcion) into v_largo_fila from public.devoluciones where id = v_id_max;
  -- Se limpian las dos filas de prueba.
  delete from public.devoluciones where id in (v_id_max, v_id_null);
  perform public._test_chk(c_caso,
    v_largo like '23514|devoluciones_descripcion_chk|%' and v_upd like '23514|devoluciones_descripcion_chk|%' and v_largo_fila = 2000,
    format('insert 2001: %s | update 2001: %s | largo de la fila tras el update fallido=%s', v_largo, v_upd, v_largo_fila));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.15 Motivo: un valor fuera del enum falla con 22P02 y motivo NULL con 23502, tanto en INSERT como en UPDATE; el UPDATE fallido no cambia la fila';
  v_a text; v_b text; v_c text; v_d text; v_antes jsonb; v_despues jsonb;
begin
  select to_jsonb(d) into v_antes from public.devoluciones d where d.id = (public._test_get('s17_d1'))::uuid;
  v_a := public._test_sqlstate(format(
    'insert into public.devoluciones (viaje_id, cliente_id, motivo) values (%L::uuid, %L::uuid, ''no_existe'')',
    public._test_get('s17_v1'), public._test_get('s17_ca1')));
  v_b := public._test_sqlstate(format(
    'insert into public.devoluciones (viaje_id, cliente_id, motivo) values (%L::uuid, %L::uuid, null)',
    public._test_get('s17_v1'), public._test_get('s17_ca1')));
  v_c := public._test_sqlstate(format(
    'update public.devoluciones set motivo = ''no_existe'' where id = %L::uuid', public._test_get('s17_d1')));
  v_d := public._test_sqlstate(format(
    'update public.devoluciones set motivo = null where id = %L::uuid', public._test_get('s17_d1')));
  select to_jsonb(d) into v_despues from public.devoluciones d where d.id = (public._test_get('s17_d1'))::uuid;
  perform public._test_chk(c_caso,
    v_a like '22P02|%' and v_b like '23502|%' and v_c like '22P02|%' and v_d like '23502|%'
      and v_antes is not null and v_antes = v_despues,
    format('insert enum inválido: %s | insert NULL: %s | update enum inválido: %s | update NULL: %s | fila igual=%s',
      v_a, v_b, v_c, v_d, v_antes = v_despues));
end
$$;

-- Borrar: solo la fila pedida.
do $$
declare
  c_caso constant text := '17.16 A borra una devolución propia con DELETE: afecta 1 fila, desaparece, y no se borra ninguna otra devolución del tenant';
  v_antes int; v_despues int; v_id uuid; v_rows int; v_existe boolean; v_d1 boolean; v_dw boolean;
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid, 'otro', 'para borrar', gen_random_uuid())
    returning id into v_id;
  select count(*) into v_antes from public.devoluciones;   -- incluye la recién creada
  delete from public.devoluciones where id = v_id;
  get diagnostics v_rows = row_count;
  select exists(select 1 from public.devoluciones where id = v_id) into v_existe;
  select count(*) into v_despues from public.devoluciones;
  select exists(select 1 from public.devoluciones where id = (public._test_get('s17_d1'))::uuid) into v_d1;
  select exists(select 1 from public.devoluciones where id = (public._test_get('s17_dw'))::uuid) into v_dw;
  perform public._test_chk(c_caso,
    v_rows = 1 and not v_existe and v_despues = v_antes - 1 and v_d1 and v_dw,
    format('filas=%s existe=%s total %s -> %s D1=%s DW=%s', v_rows, v_existe, v_antes, v_despues, v_d1, v_dw));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.17 Borrar un viaje propio con 2 devoluciones y 1 entrega las borra en cascada con la entrega, y no toca las devoluciones de otros viajes del mismo tenant ni los clientes (16.11 ya cubre el borrado en dos pasos con gastos)';
  vc uuid := (public._test_get('s17_vc'))::uuid;
  v_otras_antes uuid[]; v_otras_despues uuid[]; v_dev_antes int; v_ent_antes int; v_r int;
  v_viaje boolean; v_dev_despues int; v_ent_despues int; v_clientes int;
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values (vc, (public._test_get('s17_ca1'))::uuid, 'otro', 'DC1'),
           (vc, (public._test_get('s17_ca2'))::uuid, 'vencimiento', 'DC2');
  select array_agg(id order by id) into v_otras_antes from public.devoluciones where viaje_id <> vc;
  select count(*) into v_dev_antes from public.devoluciones where viaje_id = vc;
  select count(*) into v_ent_antes from public.entregas where viaje_id = vc;

  delete from public.viajes where id = vc;
  get diagnostics v_r = row_count;

  select exists(select 1 from public.viajes where id = vc) into v_viaje;
  select count(*) into v_dev_despues from public.devoluciones where viaje_id = vc;
  select count(*) into v_ent_despues from public.entregas where viaje_id = vc;
  select array_agg(id order by id) into v_otras_despues from public.devoluciones where viaje_id <> vc;
  select count(*) into v_clientes from public.clientes
   where id in ((public._test_get('s17_ca1'))::uuid, (public._test_get('s17_ca2'))::uuid,
                (public._test_get('s17_ca3'))::uuid, (public._test_get('s17_car'))::uuid);
  perform public._test_chk(c_caso,
    v_dev_antes = 2 and v_ent_antes = 1 and v_r = 1 and not v_viaje and v_dev_despues = 0 and v_ent_despues = 0
      and v_otras_antes is not null and v_otras_antes = v_otras_despues and v_clientes = 4,
    format('antes: devoluciones=%s entregas=%s | DELETE afectó %s | viaje_existe=%s devoluciones=%s entregas=%s | otras devoluciones del tenant iguales=%s (%s) | clientes de la sección=%s',
      v_dev_antes, v_ent_antes, v_r, v_viaje, v_dev_despues, v_ent_despues,
      v_otras_antes = v_otras_despues, coalesce(cardinality(v_otras_antes), 0), v_clientes));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

-- ON DELETE RESTRICT de devoluciones_cliente_fk (código distinto en PG17 y PG18: ver la nota de la sección).
do $$
declare
  c_caso constant text := '17.18 Un cliente con devoluciones no se puede borrar (ON DELETE RESTRICT de devoluciones_cliente_fk: 23503 en PostgreSQL 17, 23001 en PostgreSQL 18): el cliente y la devolución siguen, y sin la devolución el cliente sí se borra';
  cr uuid := (public._test_get('s17_car'))::uuid;
  v_dev uuid; v_state text; v_msg text; v_cli_existe boolean; v_dev_existe boolean; v_r1 int; v_r2 int;
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion)
    values ((public._test_get('s17_v1'))::uuid, cr, 'otro', 'devolución del cliente AR')
    returning id into v_dev;
  begin
    delete from public.clientes where id = cr;
    perform public._test_chk(c_caso, false, 'no lanzó excepción: el cliente se borró teniendo una devolución');
    return;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  select exists(select 1 from public.clientes where id = cr) into v_cli_existe;
  select exists(select 1 from public.devoluciones where id = v_dev) into v_dev_existe;
  -- Control positivo: sin la devolución, el único freno desaparece y el cliente se borra.
  delete from public.devoluciones where id = v_dev;
  get diagnostics v_r1 = row_count;
  delete from public.clientes where id = cr;
  get diagnostics v_r2 = row_count;
  perform public._test_chk(c_caso,
    v_state in ('23503', '23001') and v_msg like '%devoluciones_cliente_fk%'
      and v_cli_existe and v_dev_existe and v_r1 = 1 and v_r2 = 1,
    format('sqlstate=%s cliente_existe=%s devolucion_existe=%s | tras borrar la devolución: filas=%s, cliente borrado=%s :: %s',
      v_state, v_cli_existe, v_dev_existe, v_r1, v_r2, v_msg));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

reset role;

-- B: mismo client_ref que A, sin oráculo, y no puede tocar nada de A.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_b_admin'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  c_caso constant text := '17.19 B inserta con el MISMO client_ref X que ya usó A: funciona, queda en su tenant y B ve una sola fila con ese client_ref (la suya)';
  v_id uuid; v_tid uuid; v_ref uuid; v_n int; v_tid_vista uuid; v_desc text;
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_vb'))::uuid, (public._test_get('s17_cb'))::uuid,
            'otro', 'devolución de B', (public._test_get('s17_ref_x'))::uuid)
    returning id, transportista_id, client_ref into v_id, v_tid, v_ref;
  perform public._test_set('s17_db_x', v_id::text);
  select count(*), min(transportista_id::text)::uuid, min(descripcion) into v_n, v_tid_vista, v_desc
    from public.devoluciones where client_ref = (public._test_get('s17_ref_x'))::uuid;
  perform public._test_chk(c_caso,
    v_tid = (public._test_get('tenant_b_id'))::uuid and v_ref = (public._test_get('s17_ref_x'))::uuid
      and v_n = 1 and v_tid_vista = (public._test_get('tenant_b_id'))::uuid and v_desc = 'devolución de B',
    format('tenant=%s filas vistas=%s vista_de=%s desc=%s', v_tid, v_n, v_tid_vista, v_desc));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.20 Un segundo INSERT de B con ese mismo client_ref X falla con 23505 en devoluciones_transportista_client_ref_uidx (contra su propia fila), sin DETAIL, y B sigue con 1 sola fila';
  v_state text; v_msg text; v_constraint text; v_detail text; v_n int;
begin
  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_vb'))::uuid, (public._test_get('s17_cb'))::uuid,
            'otro', 'reintento de B', (public._test_get('s17_ref_x'))::uuid);
  perform public._test_chk(c_caso, false, 'no lanzó excepción');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text,
                          v_constraint = constraint_name, v_detail = pg_exception_detail;
  select count(*) into v_n from public.devoluciones where client_ref = (public._test_get('s17_ref_x'))::uuid;
  perform public._test_chk(c_caso,
    v_state = '23505' and v_constraint = 'devoluciones_transportista_client_ref_uidx'
      and nullif(v_detail, '') is null and v_n = 1,
    format('sqlstate=%s constraint=%s detail=%s filas=%s :: %s', v_state, v_constraint, coalesce(v_detail, '(sin detalle)'), v_n, v_msg));
end
$$;

-- Sin oráculo de existencia: B manda el transportista_id de A y un client_ref que A ya usó (Y).
-- Si el índice se evaluara contra el tenant de A, daría 23505 y B sabría que Y existe en A.
do $$
declare
  c_caso constant text := '17.21 B forzando el transportista_id de A + un client_ref que A ya usó (Y): sin error (sin oráculo) y la devolución queda en B';
  v_tid uuid;
begin
  insert into public.devoluciones (transportista_id, viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('tenant_a_id'))::uuid, (public._test_get('s17_vb'))::uuid, (public._test_get('s17_cb'))::uuid,
            'otro', 'B forzando el tenant de A', (public._test_get('s17_ref_y'))::uuid)
    returning transportista_id into v_tid;
  perform public._test_chk(c_caso, v_tid = (public._test_get('tenant_b_id'))::uuid, 'quedó en ' || v_tid);
exception
  when unique_violation then
    perform public._test_chk(c_caso, false, 'B recibió 23505: hay oráculo de existencia :: ' || sqlerrm);
  when others then
    perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.22 B no ve ninguna devolución de A: ni por id, ni por el viaje de A, ni por un client_ref de A, y todo lo que ve es de su tenant (y ve las suyas)';
  v_ajenas int; v_por_id int; v_por_viaje int; v_por_ref int; v_propias int;
begin
  select count(*) into v_ajenas from public.devoluciones where transportista_id <> (public._test_get('tenant_b_id'))::uuid;
  select count(*) into v_por_id from public.devoluciones
   where id in ((public._test_get('s17_d1'))::uuid, (public._test_get('s17_dy'))::uuid,
                (public._test_get('s17_dw'))::uuid, (public._test_get('s17_dch'))::uuid);
  select count(*) into v_por_viaje from public.devoluciones where viaje_id = (public._test_get('s17_v1'))::uuid;
  select count(*) into v_por_ref from public.devoluciones where client_ref = (public._test_get('s17_ref_w'))::uuid;
  select count(*) into v_propias from public.devoluciones where transportista_id = (public._test_get('tenant_b_id'))::uuid;
  perform public._test_chk(c_caso,
    v_ajenas = 0 and v_por_id = 0 and v_por_viaje = 0 and v_por_ref = 0 and v_propias >= 1,
    format('de otros tenants=%s | por id de A=%s | por el viaje de A=%s | por client_ref W=%s | propias=%s',
      v_ajenas, v_por_id, v_por_viaje, v_por_ref, v_propias));
end
$$;

do $$
declare
  c_caso constant text := '17.23 UPDATE y DELETE de B sobre devoluciones de A afectan 0 filas y sin error: por id, por el viaje de A, por client_ref, borrando su client_ref y "mudándolas" al tenant de B';
  d1 uuid := (public._test_get('s17_d1'))::uuid;
  v1 uuid := (public._test_get('s17_v1'))::uuid;
  w uuid := (public._test_get('s17_ref_w'))::uuid;
  v_r1 int; v_r2 int; v_r3 int; v_r4 int; v_r5 int; v_r6 int; v_r7 int;
begin
  update public.devoluciones set descripcion = 'Hackeada por B' where id = d1;
  get diagnostics v_r1 = row_count;
  update public.devoluciones set descripcion = 'Hackeada por B' where viaje_id = v1;
  get diagnostics v_r2 = row_count;
  update public.devoluciones set descripcion = 'Hackeada por B' where client_ref = w;
  get diagnostics v_r3 = row_count;
  -- RLS descarta la fila antes de que corra el trigger de client_ref: 0 filas y sin error (no es un oráculo).
  update public.devoluciones set client_ref = null where id = d1;
  get diagnostics v_r4 = row_count;
  update public.devoluciones set transportista_id = (public._test_get('tenant_b_id'))::uuid where id = d1;
  get diagnostics v_r5 = row_count;
  delete from public.devoluciones where id = d1;
  get diagnostics v_r6 = row_count;
  delete from public.devoluciones where client_ref = w;
  get diagnostics v_r7 = row_count;
  perform public._test_chk(c_caso,
    v_r1 = 0 and v_r2 = 0 and v_r3 = 0 and v_r4 = 0 and v_r5 = 0 and v_r6 = 0 and v_r7 = 0,
    format('UPDATE por id=%s, por viaje=%s, por client_ref=%s, client_ref a NULL=%s, mudar de tenant=%s | DELETE por id=%s, por client_ref=%s',
      v_r1, v_r2, v_r3, v_r4, v_r5, v_r6, v_r7));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

do $$
declare
  c_caso constant text := '17.24 UPDATE ... WHERE client_ref = X (el reintento con datos cambiados) de B afecta 1 sola fila: la de B (A tiene su propia fila con X y no se toca)';
  v_rows int; v_n int; v_desc text; v_tid uuid;
begin
  update public.devoluciones set descripcion = 'B reedita X'
   where client_ref = (public._test_get('s17_ref_x'))::uuid;
  get diagnostics v_rows = row_count;
  select count(*), min(descripcion), min(transportista_id::text)::uuid into v_n, v_desc, v_tid
    from public.devoluciones where client_ref = (public._test_get('s17_ref_x'))::uuid;
  perform public._test_chk(c_caso,
    v_rows = 1 and v_n = 1 and v_desc = 'B reedita X' and v_tid = (public._test_get('tenant_b_id'))::uuid,
    format('filas=%s vistas=%s desc=%s tenant=%s', v_rows, v_n, v_desc, v_tid));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

-- Referencias cruzadas: el INSERT ya lo cubren 3.3 y 3.4; acá se prueba el UPDATE, que es lo que usa el front al editar.
do $$
declare
  c_caso constant text := '17.25 B no puede apuntar con UPDATE una devolución PROPIA a un viaje de A (23503, devoluciones_viaje_fk) ni a un cliente de A (23503, devoluciones_cliente_fk): la fila queda exactamente igual';
  v_antes jsonb; v_despues jsonb; v_a text; v_b text;
begin
  select to_jsonb(d) into v_antes from public.devoluciones d where d.id = (public._test_get('s17_db_x'))::uuid;
  v_a := public._test_sqlstate(format(
    'update public.devoluciones set viaje_id = %L::uuid where id = %L::uuid',
    public._test_get('s17_v1'), public._test_get('s17_db_x')));
  v_b := public._test_sqlstate(format(
    'update public.devoluciones set cliente_id = %L::uuid where id = %L::uuid',
    public._test_get('s17_ca1'), public._test_get('s17_db_x')));
  select to_jsonb(d) into v_despues from public.devoluciones d where d.id = (public._test_get('s17_db_x'))::uuid;
  perform public._test_chk(c_caso,
    v_a like '23503|%devoluciones_viaje_fk%' and v_b like '23503|%devoluciones_cliente_fk%'
      and v_antes is not null and v_antes = v_despues,
    format('viaje de A: %s | cliente de A: %s | fila igual=%s', v_a, v_b, v_antes = v_despues));
end
$$;

-- Sin oráculo de existencia: el error es el mismo para un viaje o cliente de A que para uno inexistente.
-- PostgREST le muestra al cliente el código, el mensaje, el DETAIL ("details") y el HINT ("hint"): se
-- comparan todos (y el constraint). El DETAIL de una FK, si lo trae, nombra la clave consultada
-- (transportista_id, viaje_id)=(<tenant>, <id>), que es distinta en cada intento: por eso se comparan con
-- los uuids normalizados. Además, ninguna parte del error puede nombrar al tenant de A ni a su viaje o cliente.
do $$
declare
  c_caso constant text := '17.26 El error de B al apuntar a un viaje o a un cliente de A es idéntico al de apuntar a uno inexistente (mismo SQLSTATE, constraint, mensaje, DETAIL y HINT, con los uuids normalizados; en UPDATE y en INSERT) y ninguna parte del error nombra a A: no sirve de oráculo de existencia';
  c_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_db text := public._test_get('s17_db_x');
  v_a text[]; v_b text[]; v_ok boolean; v_nombra_a boolean;
begin
  v_a := array[
    -- UPDATE: viaje / cliente de A
    public._test_error_completo(format('update public.devoluciones set viaje_id = %L::uuid where id = %L::uuid', public._test_get('s17_v1'), v_db)),
    public._test_error_completo(format('update public.devoluciones set cliente_id = %L::uuid where id = %L::uuid', public._test_get('s17_ca1'), v_db)),
    -- INSERT: viaje / cliente de A
    public._test_error_completo(format('insert into public.devoluciones (viaje_id, cliente_id, motivo) values (%L::uuid, %L::uuid, ''otro'')', public._test_get('s17_v1'), public._test_get('s17_cb'))),
    public._test_error_completo(format('insert into public.devoluciones (viaje_id, cliente_id, motivo) values (%L::uuid, %L::uuid, ''otro'')', public._test_get('s17_vb'), public._test_get('s17_ca1')))
  ];
  v_b := array[
    -- los mismos cuatro con un id que no existe en ningún tenant
    public._test_error_completo(format('update public.devoluciones set viaje_id = gen_random_uuid() where id = %L::uuid', v_db)),
    public._test_error_completo(format('update public.devoluciones set cliente_id = gen_random_uuid() where id = %L::uuid', v_db)),
    public._test_error_completo(format('insert into public.devoluciones (viaje_id, cliente_id, motivo) values (gen_random_uuid(), %L::uuid, ''otro'')', public._test_get('s17_cb'))),
    public._test_error_completo(format('insert into public.devoluciones (viaje_id, cliente_id, motivo) values (%L::uuid, gen_random_uuid(), ''otro'')', public._test_get('s17_vb')))
  ];
  select bool_and(a like 'sqlstate=23503%' and regexp_replace(a, c_uuid, '<uuid>', 'gi') = regexp_replace(b, c_uuid, '<uuid>', 'gi'))
    into v_ok
    from unnest(v_a, v_b) as t(a, b);
  -- B nunca manda el tenant de A, así que no tiene por qué aparecer; los ids de A que B sí mandó tampoco
  -- (si algún día Postgres repitiera la clave en el DETAIL, este caso falla a propósito y hay que revisarlo).
  select coalesce(bool_or(strpos(x, (public._test_get('tenant_a_id'))) > 0
                          or strpos(x, (public._test_get('s17_v1'))) > 0
                          or strpos(x, (public._test_get('s17_ca1'))) > 0), false)
    into v_nombra_a
    from unnest(v_a || v_b) as t(x);
  perform public._test_chk(c_caso, v_ok and not v_nombra_a,
    format('nombra a A=%s | de A: %s || inexistentes: %s', v_nombra_a,
      replace(array_to_string(v_a, ' // '), E'\n', ' ; '), replace(array_to_string(v_b, ' // '), E'\n', ' ; ')));
end
$$;

do $$
declare
  c_caso constant text := '17.27 B no puede cambiar el transportista_id de una devolución propia (42501): la fila queda en B';
  v_res text; v_tid uuid; v_ref uuid;
begin
  v_res := public._test_sqlstate(format(
    'update public.devoluciones set transportista_id = %L::uuid where id = %L::uuid',
    public._test_get('tenant_a_id'), public._test_get('s17_db_x')));
  select transportista_id, client_ref into v_tid, v_ref
    from public.devoluciones where id = (public._test_get('s17_db_x'))::uuid;
  perform public._test_chk(c_caso,
    v_res like '42501|%No se puede cambiar el transportista_id%'
      and v_tid = (public._test_get('tenant_b_id'))::uuid and v_ref = (public._test_get('s17_ref_x'))::uuid,
    format('resultado=%s | tenant de la fila=%s', v_res, v_tid));
end
$$;

reset role;

-- El chofer de A: la policy es por tenant, no por rol.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_a_chofer'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  c_caso constant text := '17.28 El chofer de A (rol chofer) también crea, edita y borra devoluciones de A, incluida una que creó el admin (la policy es por tenant, no por rol), y no puede tocar las de B';
  dch uuid := (public._test_get('s17_dch'))::uuid;
  v_rol public.rol_miembro; v_ve int; v_id uuid; v_tid uuid; v_r_edit int; v_r_edit_admin int; v_desc_admin text;
  v_r_del int; v_r_del_admin int; v_dch_existe boolean; v_r_b int;
begin
  select rol into v_rol from public.miembros where user_id = (public._test_get('uid_a_chofer'))::uuid;
  select count(*) into v_ve from public.devoluciones where id = dch;

  insert into public.devoluciones (viaje_id, cliente_id, motivo, descripcion, client_ref)
    values ((public._test_get('s17_v1'))::uuid, (public._test_get('s17_ca1'))::uuid,
            'otro', 'creada por el chofer', (public._test_get('s17_ref_ch'))::uuid)
    returning id, transportista_id into v_id, v_tid;
  update public.devoluciones set motivo = 'vencimiento', descripcion = 'editada por el chofer' where id = v_id;
  get diagnostics v_r_edit = row_count;
  update public.devoluciones set descripcion = 'editada por el chofer (la creó el admin)' where id = dch;
  get diagnostics v_r_edit_admin = row_count;
  select descripcion into v_desc_admin from public.devoluciones where id = dch;

  delete from public.devoluciones where id = v_id;
  get diagnostics v_r_del = row_count;
  delete from public.devoluciones where id = dch;
  get diagnostics v_r_del_admin = row_count;
  select exists(select 1 from public.devoluciones where id = dch) into v_dch_existe;

  update public.devoluciones set descripcion = 'Hackeada por el chofer de A'
   where id = (public._test_get('s17_db_x'))::uuid;
  get diagnostics v_r_b = row_count;

  perform public._test_chk(c_caso,
    v_rol = 'chofer' and v_ve = 1 and v_tid = (public._test_get('tenant_a_id'))::uuid
      and v_r_edit = 1 and v_r_edit_admin = 1 and v_desc_admin = 'editada por el chofer (la creó el admin)'
      and v_r_del = 1 and v_r_del_admin = 1 and not v_dch_existe and v_r_b = 0,
    format('rol=%s ve la del admin=%s | tenant de la creada=%s | editar: propia=%s, del admin=%s | borrar: propia=%s, del admin=%s (existe=%s) | UPDATE sobre la de B=%s',
      v_rol, v_ve, v_tid, v_r_edit, v_r_edit_admin, v_r_del, v_r_del_admin, v_dch_existe, v_r_b));
exception when others then
  perform public._test_chk(c_caso, false, sqlerrm);
end
$$;

reset role;

-- Un usuario autenticado sin tenant.
select set_config('request.jwt.claims',
  json_build_object('sub', public._test_get('uid_sin_tenant'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  c_caso constant text := '17.29 Un usuario sin tenant no ve devoluciones ni puede crearlas (42501), ni siquiera mandando el transportista_id de A';
  v_n int; v_a text; v_b text;
begin
  select count(*) into v_n from public.devoluciones;
  v_a := public._test_sqlstate(format(
    $q$insert into public.devoluciones (viaje_id, cliente_id, motivo) values (%L::uuid, %L::uuid, 'otro')$q$,
    public._test_get('s17_v1'), public._test_get('s17_ca1')));
  v_b := public._test_sqlstate(format(
    $q$insert into public.devoluciones (transportista_id, viaje_id, cliente_id, motivo) values (%L::uuid, %L::uuid, %L::uuid, 'otro')$q$,
    public._test_get('tenant_a_id'), public._test_get('s17_v1'), public._test_get('s17_ca1')));
  perform public._test_chk(c_caso,
    v_n = 0 and v_a like '42501|%' and v_b like '42501|%',
    format('vio %s | insert sin tenant: %s | insert con el tenant de A: %s', v_n, v_a, v_b));
end
$$;

reset role;

-- Como postgres: integridad general tras todo lo anterior.
do $$
declare
  c_caso constant text := '17.30 Como postgres: ninguna devolución de toda la base apunta a un viaje o a un cliente de otro tenant, ni a uno inexistente (y hay devoluciones, para que el chequeo no sea vacío)';
  v_cruzadas int; v_viaje_inexistente int; v_cliente_inexistente int; v_total int;
begin
  -- Se une solo por id (sin el tenant) a propósito: así un cruce entre tenants no se esconde detrás de la FK compuesta.
  select count(*) into v_cruzadas
    from public.devoluciones d
    join public.viajes v on v.id = d.viaje_id
    join public.clientes c on c.id = d.cliente_id
   where d.transportista_id <> v.transportista_id or d.transportista_id <> c.transportista_id;
  select count(*) into v_viaje_inexistente
    from public.devoluciones d where not exists (select 1 from public.viajes v where v.id = d.viaje_id);
  select count(*) into v_cliente_inexistente
    from public.devoluciones d where not exists (select 1 from public.clientes c where c.id = d.cliente_id);
  select count(*) into v_total from public.devoluciones;
  perform public._test_chk(c_caso,
    v_cruzadas = 0 and v_viaje_inexistente = 0 and v_cliente_inexistente = 0 and v_total > 0,
    format('cruzadas=%s con viaje inexistente=%s con cliente inexistente=%s devoluciones en la base=%s',
      v_cruzadas, v_viaje_inexistente, v_cliente_inexistente, v_total));
end
$$;

do $$
declare
  c_caso constant text := '17.31 Como postgres, tras los intentos de B: X e Y existen una vez por tenant, W solo en A, no hay duplicados por (tenant, client_ref), y cada devolución conserva su propia edición (la de A la de A, la de B la de B)';
  v_x int; v_y int; v_w int; v_dups int;
  v_d1_desc text; v_d1_tid uuid; v_d1_ref uuid; v_dw_desc text; v_dw_ref uuid; v_db_desc text; v_db_tid uuid;
begin
  select count(*) into v_x from public.devoluciones where client_ref = (public._test_get('s17_ref_x'))::uuid;
  select count(*) into v_y from public.devoluciones where client_ref = (public._test_get('s17_ref_y'))::uuid;
  select count(*) into v_w from public.devoluciones where client_ref = (public._test_get('s17_ref_w'))::uuid;
  select count(*) into v_dups from (
    select transportista_id, client_ref from public.devoluciones
     where client_ref is not null group by 1, 2 having count(*) > 1
  ) d;
  select descripcion, transportista_id, client_ref into v_d1_desc, v_d1_tid, v_d1_ref
    from public.devoluciones where id = (public._test_get('s17_d1'))::uuid;
  select descripcion, client_ref into v_dw_desc, v_dw_ref
    from public.devoluciones where id = (public._test_get('s17_dw'))::uuid;
  select descripcion, transportista_id into v_db_desc, v_db_tid
    from public.devoluciones where id = (public._test_get('s17_db_x'))::uuid;
  perform public._test_chk(c_caso,
    v_x = 2 and v_y = 2 and v_w = 1 and v_dups = 0
      and v_d1_desc = 'D1 editada 2' and v_d1_tid = (public._test_get('tenant_a_id'))::uuid
      and v_d1_ref = (public._test_get('s17_ref_x'))::uuid
      and v_dw_desc = 'DW editada por A' and v_dw_ref = (public._test_get('s17_ref_w'))::uuid
      and v_db_desc = 'B reedita X' and v_db_tid = (public._test_get('tenant_b_id'))::uuid,
    format('X=%s Y=%s W=%s duplicados=%s | D1: desc=%s tenant=%s | DW: desc=%s | DB: desc=%s tenant=%s',
      v_x, v_y, v_w, v_dups, v_d1_desc, v_d1_tid, v_dw_desc, v_db_desc, v_db_tid));
end
$$;

-- ---------------------------------------------------------------------
-- 9) Resumen final: SIEMPRE lanza excepción (fuerza el ROLLBACK)
-- ---------------------------------------------------------------------

select public._test_resumen();
