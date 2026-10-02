-- =====================================================================
-- 005_gastos_combustible.sql — Elan (rendimiento de combustible)
-- =====================================================================
-- Qué hace: agrega a public.gastos dos columnas opcionales para poder
-- calcular el rendimiento (km por litro) entre cargas de tanque lleno:
--   * km_odometro  numeric(9,1) null — lectura del odómetro al cargar
--                  combustible (mismo tipo que viajes.km_inicial/km_final).
--   * tanque_lleno boolean null      — true = en esa carga se llenó el
--                  tanque; false = carga parcial; null = no aplica (el
--                  gasto no es un combustible) o no informado.
--
-- Orden de aplicación: 5. Requiere 001_schema.sql, 002_functions.sql y
-- 003_rls.sql ya aplicados (004 no es dependencia).
--
-- Notas de diseño:
-- * Sin cambios de RLS, policies ni grants. La policy gastos_tenant_
--   isolation filtra por FILA (transportista_id), no por columna, y el
--   GRANT de 003 sobre gastos es de TABLA completa (select, insert,
--   update, delete): un privilegio de tabla cubre todas las columnas,
--   también las que se agreguen después. anon sigue sin ningún privilegio.
--   Tampoco hay que tocar los triggers de 002: no dependen de estas
--   columnas.
-- * Filas existentes: las dos columnas quedan en NULL (ADD COLUMN
--   nullable y sin default es solo un cambio de catálogo, no reescribe
--   la tabla) y NULL cumple todos los checks.
-- * tanque_lleno NO tiene default false a propósito: null significa "no
--   aplica / no informado" y tiene que poder distinguirse de "carga
--   parcial" (false). El front manda null, no false, cuando el dato no
--   corresponde.
-- * Igual que litros y precio_por_litro, estas columnas no se atan a una
--   categoría (las categorías son configurables, no un enum): la base no
--   impone que solo se usen en "Combustible". Decisión: eso lo resuelve
--   el front, que muestra los campos solo para combustible y, al EDITAR la
--   categoría de un gasto, los limpia (km_odometro, tanque_lleno, y litros
--   / precio_por_litro si corresponde). El cálculo del rendimiento tiene
--   que apoyarse en los datos (litros y km_odometro no nulos), no en el
--   nombre de la categoría.
-- * Además de las columnas, la migración agrega un check de coherencia
--   entre tanque_lleno y litros (ver el final del archivo).
-- * Sin índices nuevos: el volumen por tenant es chico y las consultas de
--   rendimiento filtran por transportista_id (+ fecha), que ya cubre
--   gastos_transportista_fecha_idx.
-- * Después de aplicar: regenerar src/lib/database.types.ts.
-- =====================================================================

alter table public.gastos
  add column km_odometro numeric(9, 1) null,
  add column tanque_lleno boolean null;

-- Mismo estilo que viajes_km_inicial_chk / viajes_km_final_chk.
alter table public.gastos
  add constraint gastos_km_odometro_chk check (km_odometro is null or km_odometro >= 0);

comment on column public.gastos.km_odometro is
  'Lectura del odómetro del camión (km) al cargar combustible. NULL = no informado. Junto con litros y tanque_lleno permite calcular el rendimiento entre cargas de tanque lleno.';
comment on column public.gastos.tanque_lleno is
  'true = en esta carga se llenó el tanque; false = carga parcial; NULL = no aplica (gasto que no es combustible) o no informado.';

-- ---------------------------------------------------------------------
-- Check de coherencia entre tanque_lleno y litros
-- ---------------------------------------------------------------------
-- Qué hace: rechaza tanque_lleno = true con litros NULL. Un "tanque lleno"
-- sin litros no sirve para el rendimiento (los litros de la carga llena
-- son el numerador del cálculo). A propósito NO rechaza tanque_lleno =
-- false ni NULL con litros NULL: así un formulario que mande false en un
-- gasto que no es combustible (p.ej. un peaje) no se rompe.
--
-- Efecto en UPDATE: si alguien pone litros = NULL en una fila que tiene
-- tanque_lleno = true, el UPDATE falla (23514, constraint
-- gastos_tanque_lleno_litros_chk). Es lo buscado —evita que quede una
-- carga "llena" inutilizable sin que nadie se entere—, así que el front
-- de edición manda tanque_lleno: null junto con litros: null.
-- Las filas existentes cumplen el check (tanque_lleno es NULL en todas).
alter table public.gastos
  add constraint gastos_tanque_lleno_litros_chk check (tanque_lleno is not true or litros is not null);

comment on constraint gastos_tanque_lleno_litros_chk on public.gastos is
  'Un tanque lleno sin litros no sirve para el rendimiento. Solo rechaza tanque_lleno = true con litros NULL.';
