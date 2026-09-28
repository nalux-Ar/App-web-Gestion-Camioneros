-- =====================================================================
-- 001_schema.sql — Elan (Bloque A: Base de datos multi-tenant)
-- =====================================================================
-- Qué hace: crea los enums, las tablas de negocio, sus constraints
-- (incluidas las FK compuestas anti-fuga-entre-tenants) y los índices
-- de soporte. También siembra las 4 categorías de gasto globales.
--
-- Orden de aplicación: 1 de 3. Pegar y correr ANTES de 002_functions.sql
-- y 003_rls.sql en el SQL Editor de Supabase (rol postgres).
--
-- Notas de diseño:
-- * No se declara ningún DEFAULT que dependa de una función (p.ej.
--   get_mi_transportista_id()): esa función recién existe en 002.
--   El llenado de transportista_id en INSERT lo hace un trigger que
--   se crea en 002; acá las columnas transportista_id son NOT NULL
--   sin default (el trigger las completa ANTES de que Postgres valide
--   el NOT NULL, porque los triggers BEFORE INSERT corren antes que
--   la validación de constraints).
-- * gen_random_uuid() es nativo del núcleo de Postgres desde la v13,
--   no hace falta activar la extensión pgcrypto para usarlo.
-- * Todas las tablas de negocio llevan transportista_id uuid NOT NULL
--   (el "tenant" es la cuenta/transportista, no el usuario).
-- * Las FK que apuntan a otra tabla de negocio son FK COMPUESTAS
--   (transportista_id, x_id) → x(transportista_id, id), apoyadas en
--   un UNIQUE(transportista_id, id) en la tabla referenciada. Esto es
--   lo que impide que el tenant B enganche una entrega/devolución/gasto
--   a un viaje/cliente/camión del tenant A manipulando el request: la
--   FK exige que AMBAS columnas coincidan con una fila real.
--   La única excepción es categorias_gasto (puede ser global, con
--   transportista_id NULL), que se valida con un trigger en 002.
-- * Al final del archivo se habilita RLS y se revoca anon/authenticated
--   en las 9 tablas (deny-all) para no dejar ninguna ventana insegura
--   mientras falta aplicar 003_rls.sql. 003 repite ese mismo enable/
--   revoke antes de sus GRANT y policies (es idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

create type public.rol_miembro as enum ('admin', 'chofer');

create type public.motivo_devolucion as enum (
  'rotura_danio',
  'vencimiento',
  'mercaderia_incorrecta',
  'otro'
);

create type public.metodo_pago as enum (
  'efectivo',
  'tarjeta_credito',
  'tarjeta_debito',
  'transferencia'
);

-- ---------------------------------------------------------------------
-- transportistas — tabla raíz del tenant (una fila por cuenta)
-- ---------------------------------------------------------------------

create table public.transportistas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transportistas_nombre_chk check (length(trim(nombre)) between 1 and 200)
);

comment on table public.transportistas is
  'Tenant raíz: una fila por cuenta de transportista. El tenant es la cuenta, no el usuario.';

-- ---------------------------------------------------------------------
-- miembros — usuarios (auth.users) que pertenecen a un transportista
-- ---------------------------------------------------------------------

create table public.miembros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  transportista_id uuid not null references public.transportistas (id) on delete cascade,
  rol public.rol_miembro not null default 'chofer',
  tema text not null default 'dark',
  color_acento text not null default '#F59E0B',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint miembros_tema_chk check (tema in ('dark', 'light')),
  -- El valor se inyecta tal cual como variable CSS en el front: no puede
  -- aceptar texto arbitrario, solo un hex de 6 dígitos con '#'.
  constraint miembros_color_acento_chk check (color_acento ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.miembros is
  'Relación usuario↔transportista. rol solo se cambia vía cambiar_rol_miembro() (ver 002).';
comment on column public.miembros.color_acento is
  'Hex de 6 dígitos (#RRGGBB), se usa como variable CSS en el front. Validado por CHECK.';

create index miembros_transportista_id_idx on public.miembros (transportista_id);

-- ---------------------------------------------------------------------
-- camiones — uno por transportista por ahora (constraint dropeable)
-- ---------------------------------------------------------------------

create table public.camiones (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid not null references public.transportistas (id) on delete cascade,
  patente text not null,
  marca text,
  modelo text,
  anio integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint camiones_patente_chk check (length(trim(patente)) between 1 and 20),
  constraint camiones_marca_chk check (marca is null or length(marca) <= 100),
  constraint camiones_modelo_chk check (modelo is null or length(modelo) <= 100),
  -- Rango fijo (no now()): una expresión CHECK tiene que ser inmutable,
  -- y extract(year from now()) no lo es (Postgres lo desaconseja).
  constraint camiones_anio_chk check (anio is null or anio between 1950 and 2100),
  -- Soporte estructural para la FK compuesta desde viajes.camion_id.
  constraint camiones_transportista_id_key unique (transportista_id, id),
  -- Regla de negocio actual: "uno por transportista por ahora". Se puede
  -- dropear el día que un transportista tenga flota (varios camiones):
  --   alter table public.camiones drop constraint camiones_un_por_transportista;
  constraint camiones_un_por_transportista unique (transportista_id)
);

comment on constraint camiones_un_por_transportista on public.camiones is
  'Regla temporal "un camión por transportista". Dropear cuando se soporte flota.';

-- ---------------------------------------------------------------------
-- clientes
-- ---------------------------------------------------------------------

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid not null references public.transportistas (id) on delete cascade,
  nombre text not null,
  contacto_telefono text,
  contacto_email text,
  direccion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clientes_nombre_chk check (length(trim(nombre)) between 1 and 200),
  constraint clientes_contacto_telefono_chk check (contacto_telefono is null or length(contacto_telefono) <= 50),
  constraint clientes_contacto_email_chk check (contacto_email is null or length(contacto_email) <= 254),
  constraint clientes_direccion_chk check (direccion is null or length(direccion) <= 300),
  constraint clientes_transportista_id_key unique (transportista_id, id)
);

-- ---------------------------------------------------------------------
-- viajes
-- ---------------------------------------------------------------------

create table public.viajes (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid not null references public.transportistas (id) on delete cascade,
  camion_id uuid null,
  fecha date not null default current_date,
  origen text not null,
  destino text not null,
  km_inicial numeric(9, 1),
  km_final numeric(9, 1),
  km_recorridos numeric(9, 1),
  observaciones text,
  ingreso numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint viajes_origen_chk check (length(trim(origen)) between 1 and 200),
  constraint viajes_destino_chk check (length(trim(destino)) between 1 and 200),
  constraint viajes_observaciones_chk check (observaciones is null or length(observaciones) <= 2000),
  constraint viajes_ingreso_chk check (ingreso is null or ingreso >= 0),
  constraint viajes_km_inicial_chk check (km_inicial is null or km_inicial >= 0),
  constraint viajes_km_final_chk check (km_final is null or km_final >= 0),
  constraint viajes_km_recorridos_chk check (km_recorridos is null or km_recorridos >= 0),
  -- El chofer carga UN modo de kilometraje: o inicial/final, o recorridos.
  -- No se pueden mezclar los dos modos en la misma fila.
  constraint viajes_chk_modo_km check (
    km_recorridos is null or (km_inicial is null and km_final is null)
  ),
  -- Si hay km_final cargado, tiene que haber km_inicial y ser coherente
  -- (permite el estado intermedio "viaje en curso": solo km_inicial cargado).
  constraint viajes_chk_km_coherentes check (
    km_final is null or (km_inicial is not null and km_final >= km_inicial)
  ),
  constraint viajes_transportista_id_key unique (transportista_id, id),
  -- Camión opcional, pero si se carga tiene que ser un camión DEL MISMO
  -- tenant (evita enganchar el camión de otro transportista).
  constraint viajes_camion_fk foreign key (transportista_id, camion_id)
    references public.camiones (transportista_id, id) on delete restrict
);

create index viajes_transportista_fecha_idx on public.viajes (transportista_id, fecha);
create index viajes_transportista_camion_idx on public.viajes (transportista_id, camion_id);

-- ---------------------------------------------------------------------
-- entregas — viaje ↔ cliente (un viaje puede tener varios clientes)
-- ---------------------------------------------------------------------

create table public.entregas (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid not null references public.transportistas (id) on delete cascade,
  viaje_id uuid not null,
  cliente_id uuid not null,
  incidencias text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entregas_incidencias_chk check (incidencias is null or length(incidencias) <= 2000),
  constraint entregas_viaje_fk foreign key (transportista_id, viaje_id)
    references public.viajes (transportista_id, id) on delete cascade,
  constraint entregas_cliente_fk foreign key (transportista_id, cliente_id)
    references public.clientes (transportista_id, id) on delete restrict
);

create index entregas_transportista_id_idx on public.entregas (transportista_id);
create index entregas_transportista_viaje_idx on public.entregas (transportista_id, viaje_id);
create index entregas_transportista_cliente_idx on public.entregas (transportista_id, cliente_id);

-- ---------------------------------------------------------------------
-- devoluciones — vinculada a viaje/cliente
-- ---------------------------------------------------------------------

create table public.devoluciones (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid not null references public.transportistas (id) on delete cascade,
  viaje_id uuid not null,
  cliente_id uuid not null,
  motivo public.motivo_devolucion not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devoluciones_descripcion_chk check (descripcion is null or length(descripcion) <= 2000),
  constraint devoluciones_viaje_fk foreign key (transportista_id, viaje_id)
    references public.viajes (transportista_id, id) on delete cascade,
  constraint devoluciones_cliente_fk foreign key (transportista_id, cliente_id)
    references public.clientes (transportista_id, id) on delete restrict
);

create index devoluciones_transportista_id_idx on public.devoluciones (transportista_id);
create index devoluciones_transportista_viaje_idx on public.devoluciones (transportista_id, viaje_id);
create index devoluciones_transportista_cliente_idx on public.devoluciones (transportista_id, cliente_id);

-- ---------------------------------------------------------------------
-- categorias_gasto — catálogo configurable (NO enum).
-- transportista_id NULL = categoría global (visible para todos,
-- pero nadie autenticado puede crearla/editarla/borrarla).
-- ---------------------------------------------------------------------

create table public.categorias_gasto (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid null references public.transportistas (id) on delete cascade,
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categorias_gasto_nombre_chk check (length(trim(nombre)) between 1 and 100)
);

comment on column public.categorias_gasto.transportista_id is
  'NULL = categoría global (seed del sistema). No NULL = categoría propia de un tenant.';

-- Unicidad de nombre (case-insensitive) entre las categorías globales...
create unique index categorias_gasto_nombre_global_uidx
  on public.categorias_gasto (lower(nombre))
  where transportista_id is null;

-- ...y unicidad de nombre por tenant (entre las categorías propias de cada uno).
create unique index categorias_gasto_nombre_tenant_uidx
  on public.categorias_gasto (transportista_id, lower(nombre))
  where transportista_id is not null;

-- Seed idempotente de las 4 categorías globales.
insert into public.categorias_gasto (nombre, transportista_id)
values
  ('Peajes', null),
  ('Urea/AdBlue', null),
  ('Combustible', null),
  ('Gastos varios', null)
on conflict ((lower(nombre))) where transportista_id is null do nothing;

-- ---------------------------------------------------------------------
-- gastos
-- ---------------------------------------------------------------------

create table public.gastos (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid not null references public.transportistas (id) on delete cascade,
  viaje_id uuid null,
  categoria_id uuid not null references public.categorias_gasto (id) on delete restrict,
  monto numeric(12, 2) not null,
  fecha date not null default current_date,
  descripcion text,
  metodo_pago public.metodo_pago null,
  foto_url text null,
  litros numeric(9, 3) null,
  precio_por_litro numeric(10, 2) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gastos_monto_chk check (monto > 0),
  constraint gastos_descripcion_chk check (descripcion is null or length(descripcion) <= 2000),
  constraint gastos_litros_chk check (litros is null or litros > 0),
  constraint gastos_precio_litro_chk check (precio_por_litro is null or precio_por_litro > 0),
  -- viaje_id opcional, pero si se carga tiene que ser un viaje DEL MISMO
  -- tenant. categoria_id se valida aparte con un trigger (ver 002) porque
  -- categorias_gasto admite transportista_id NULL (global) y una FK
  -- compuesta clásica no contempla ese caso.
  constraint gastos_viaje_fk foreign key (transportista_id, viaje_id)
    references public.viajes (transportista_id, id) on delete restrict
);

comment on constraint gastos_viaje_fk on public.gastos is
  'ON DELETE RESTRICT a propósito: no se puede borrar un viaje con gastos cargados '
  'sin antes desvincularlos (evita el "SET NULL" en FK compuesta, que en Postgres '
  'pondría en NULL también a transportista_id y violaría su NOT NULL).';

create index gastos_transportista_id_idx on public.gastos (transportista_id);
create index gastos_transportista_viaje_idx on public.gastos (transportista_id, viaje_id);
create index gastos_transportista_categoria_idx on public.gastos (transportista_id, categoria_id);
create index gastos_transportista_fecha_idx on public.gastos (transportista_id, fecha);

-- ---------------------------------------------------------------------
-- Deny-all desde el vamos: ventana de exposición entre migraciones.
-- ---------------------------------------------------------------------
-- Si se aplican 001 y 002 pero por lo que sea tarda en aplicar 003 (o
-- algo se corta a mitad de camino), estas tablas NO deberían quedar ni
-- un segundo con RLS deshabilitado ni con los privilegios ALL que
-- Supabase les da por default a anon/authenticated apenas se crean.
-- Por eso se habilita RLS y se revoca anon/authenticated ACÁ MISMO,
-- apenas se crea cada tabla: sin policies todavía, "RLS habilitado sin
-- policies" es deny-all para todo el mundo salvo el dueño/superusuario,
-- así que no hay ninguna ventana insegura.
--
-- 003_rls.sql repite estos mismos enable/revoke (son idempotentes) antes
-- de otorgar los grants puntuales y crear las policies: así 003 sigue
-- siendo autocontenido y se puede leer/aplicar de forma independiente
-- sin tener que venir a buscar este bloque acá.
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

revoke all on public.transportistas from anon, authenticated;
revoke all on public.miembros from anon, authenticated;
revoke all on public.camiones from anon, authenticated;
revoke all on public.clientes from anon, authenticated;
revoke all on public.viajes from anon, authenticated;
revoke all on public.entregas from anon, authenticated;
revoke all on public.devoluciones from anon, authenticated;
revoke all on public.categorias_gasto from anon, authenticated;
revoke all on public.gastos from anon, authenticated;
