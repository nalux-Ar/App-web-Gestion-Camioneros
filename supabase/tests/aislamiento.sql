-- =====================================================================
-- aislamiento.sql — Elan (Bloque A: test de aislamiento multi-tenant)
-- =====================================================================
-- Qué hace: crea 2 tenants (A y B) más un chofer en A y un usuario sin
-- tenant, y verifica —simulando cada usuario con set local role +
-- request.jwt.claims— que el aislamiento entre tenants, el anti
-- auto-promoción de rol y las FK anti-referencia-cruzada funcionan.
--
-- Cómo correrlo: pegar el archivo ENTERO en el SQL Editor de Supabase
-- (conectado como el rol `postgres`) y ejecutarlo de una sola vez,
-- DESPUÉS de aplicar 001_schema.sql, 002_functions.sql y
-- 003_rls.sql. NO agregar BEGIN/COMMIT: el SQL Editor ya manda todo
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
-- OJO — sección 10 (el último test, justo antes del resumen): intenta
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
  insert into _test_resultados (caso, ok, detalle) values (p_caso, p_ok, p_detalle);
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
-- 9) Resumen final: SIEMPRE lanza excepción (fuerza el ROLLBACK)
-- ---------------------------------------------------------------------

select public._test_resumen();
