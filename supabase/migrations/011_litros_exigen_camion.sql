-- =====================================================================
-- 011_litros_exigen_camion.sql — Elan (Bloque C, Etapa 5b: Camiones)
-- =====================================================================
-- Qué hace: agrega a public.gastos la regla "un gasto con litros exige
-- camión" como CHECK (gastos_litros_camion_chk), ya VALIDADO, después de un
-- relleno defensivo que asigna camión a los gastos con litros que todavía
-- no lo tengan, con las mismas reglas que usa la app.
--
-- Por qué: el rendimiento de combustible (Resumen) se calcula por camión,
-- entre cargas de tanque lleno consecutivas del MISMO camión. Una carga con
-- litros y sin camión no entra en ningún cálculo y queda "fantasma". La
-- 010 dejó el camión opcional para no romper el front publicado; esta
-- migración cierra la regla en la base, para cualquier camino de escritura.
--
-- Cambio respecto del plan de la 010 (que decía: CHECK NOT VALID en la 011 y
-- una migración 012 que lo valida en el cierre de pruebas): el plan suponía
-- que en la base real quedarían 2 gastos heredados con litros y sin camión.
-- Ya no existen: los asignó el relleno de crear_camion (010) cuando se cargó
-- el primer camión de esa cuenta (consultado el 2026-10-07: 0 gastos con
-- litros y sin camión en toda la base). Por eso la regla nace VALIDADA y no
-- hace falta una 012. Además desaparece el riesgo que marcó la auditoría:
-- con un CHECK NOT VALID, cualquier UPDATE de una fila vieja que violara la
-- regla fallaría (p. ej. la desvinculación de gastos al borrar un viaje).
--
-- Orden de aplicación: 11. Requiere 001 a 003 y 005 a 010 aplicadas (usa
-- gastos.camion_id y el trigger trg_21_camion_por_defecto de la 010). El
-- test de aislamiento completo (sección 20 incluida) asume 001 a 003 y 005
-- a 011.
--
-- ---------------------------------------------------------------------
-- Orden de despliegue: 010 -> front de la Etapa 5b (YA publicado) -> 011
-- ---------------------------------------------------------------------
-- * El front de la 5b ya exige camión en un gasto con litros y manda
--   camion_id: con él, esta regla nunca se dispara en un uso normal.
-- * Front congelado de la rama piloto (commit d1130bc, anterior a la 5b, que
--   NO manda camion_id): si la cuenta tiene EXACTAMENTE un camión activo, el
--   trigger de la 010 completa el camión y todo anda igual. Con 0 camiones
--   activos, o con 2 o más, un combustible con litros sin camión falla con
--   23514 gastos_litros_camion_chk, y ese front no sabe mostrar ese error
--   (muestra el genérico). Antes de aplicar la 011 conviene que las cuentas
--   que usan el front piloto tengan exactamente un camión activo, o que el
--   piloto ya esté actualizado al front de la 5b.
-- * Contrato con el front actual: un gasto con litros y sin camión que la
--   base no pueda completar falla con 23514 y constraint
--   gastos_litros_camion_chk (el mensaje trae ese nombre). Es distinto del
--   23514 de coherencia gasto <-> viaje (gastos_camion_viaje_chk, 010). Un
--   gasto sin litros (peaje, gastos varios) no exige camión.
-- * Quitar litros y camión en el mismo UPDATE (cambio a una categoría que no
--   es combustible) está permitido. Un camion_id = NULL explícito en un
--   gasto con litros lo vuelve a completar el trigger de la 010 cuando hay
--   exactamente un camión activo; si no, 23514.
-- * Esta migración no cambia columnas ni funciones: no hay que regenerar
--   src/lib/database.types.ts.
--
-- ---------------------------------------------------------------------
-- Relleno defensivo y filas existentes
-- ---------------------------------------------------------------------
-- * En la base real hoy no hay ningún gasto con litros y sin camión: el
--   relleno toca 0 filas y la migración no cambia ningún dato.
-- * En otro ambiente (local, staging) puede haberlos. El relleno es un
--   UPDATE "vacío" (set litros = litros) sobre esas filas, que hace correr
--   los triggers BEFORE UPDATE de gastos, así que asigna con LAS MISMAS
--   REGLAS que la app (trg_21_camion_por_defecto, 010): el camión del viaje
--   si está activo; si el gasto no tiene viaje o el viaje no tiene camión, el
--   único camión activo de la cuenta. Los demás triggers de gastos no
--   estorban: trg_15 revalida la categoría (que ya era válida), trg_20 y
--   trg_25 ven el tenant y el client_ref sin cambios, trg_22 valida el camión
--   asignado (activo por construcción y coherente con el viaje; lee el viaje
--   FOR SHARE, sin problema dentro de la migración) y trg_30 pone
--   updated_at = now() en las filas rellenadas (la hora de la migración).
--   La migración corre como postgres, dueño de la tabla: RLS no filtra, y
--   los triggers buscan siempre dentro del tenant de cada fila.
-- * Lo que el trigger no puede resolver queda NULL y hace fallar el VALIDATE,
--   y con él la migración ENTERA (no queda nada a medias, ni siquiera el
--   relleno): una cuenta con 0 camiones activos, o con 2 o más y el gasto sin
--   viaje (o con un viaje sin camión), o un gasto en un viaje cuyo camión
--   está archivado. Es lo buscado: la base no adivina.
--   Cómo resolverlo a mano antes de reintentar (previa confirmación):
--     select g.id, g.transportista_id, g.fecha, g.viaje_id, g.litros
--       from public.gastos g
--      where g.litros is not null and g.camion_id is null;
--   y para cada fila, una de estas: (a) asignarle un camión ACTIVO de su
--   cuenta, el mismo que el de su viaje si el viaje tiene camión
--   (update public.gastos set camion_id = '<camión>' where id = '<gasto>');
--   (b) si no era un combustible, quitarle los litros (litros, tanque_lleno
--   y km_odometro en NULL en el mismo UPDATE); (c) borrar el gasto.
--
-- ---------------------------------------------------------------------
-- Locks
-- ---------------------------------------------------------------------
-- * Va en una sola transacción. ADD CONSTRAINT (CHECK) toma ACCESS EXCLUSIVE
--   sobre gastos y lo mantiene hasta el final, también durante el VALIDATE:
--   bloquea lecturas y escrituras de gastos mientras dura. Con decenas de
--   filas son milisegundos.
-- * Se agrega NOT VALID y se valida enseguida en la misma transacción. El
--   resultado es el mismo que agregarlo validado de una: el VALIDATE toma
--   por sí solo un lock más liviano (SHARE UPDATE EXCLUSIVE), pero acá ya
--   rige el ACCESS EXCLUSIVE del ADD. Se deja en dos pasos para que el paso
--   que puede fallar (el VALIDATE) quede explícito y separado.
-- * lock_timeout de 5 s: si alguna transacción larga tiene gastos tomada, la
--   migración falla entera en vez de quedar en cola bloqueando a todos.
--
-- ---------------------------------------------------------------------
-- Reversibilidad
-- ---------------------------------------------------------------------
-- * Se deshace con:
--     alter table public.gastos drop constraint gastos_litros_camion_chk;
--   sin pérdida de datos (y, si se quiere, sacar también el comentario de
--   gastos.litros). El relleno no se deshace: los gastos que hayan recibido
--   camión lo conservan (en la base real, ninguno).
--
-- ---------------------------------------------------------------------
-- Orden de evaluación de los CHECK
-- ---------------------------------------------------------------------
-- * Postgres evalúa los CHECK de una tabla por orden de nombre y reporta el
--   primero que falla. gastos_litros_camion_chk queda después de
--   gastos_km_odometro_chk y antes de gastos_litros_chk (litros > 0):
--     descripcion -> km_odometro -> litros_camion -> litros -> monto
--     -> precio_litro -> tanque_lleno_litros
--   Los errores que el front ya mapea no cambian: km_odometro sigue saliendo
--   primero, y tanque_lleno_litros (tanque lleno sin litros) nunca choca con
--   esta regla (sin litros, no exige camión). Solo cambia un caso que el
--   front no puede producir (litros <= 0 Y sin camión a la vez): ahí sale
--   primero gastos_litros_camion_chk en vez de gastos_litros_chk.
-- =====================================================================

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1) Relleno defensivo (0 filas en la base real)
-- ---------------------------------------------------------------------
-- UPDATE sin cambio real: dispara trg_21_camion_por_defecto (010), que
-- completa camion_id con las reglas de la app. Lo que no resuelve queda
-- NULL y hace fallar el VALIDATE de abajo.
update public.gastos
   set litros = litros
 where litros is not null
   and camion_id is null;

-- ---------------------------------------------------------------------
-- 2) La regla: un gasto con litros exige camión
-- ---------------------------------------------------------------------
alter table public.gastos
  add constraint gastos_litros_camion_chk check (litros is null or camion_id is not null) not valid;

comment on constraint gastos_litros_camion_chk on public.gastos is
  'Un gasto con litros (combustible) exige camión: sin camión no entra en el rendimiento por camión. Si llega sin camión, el trigger trg_21_camion_por_defecto (010) lo completa cuando puede (camión del viaje si está activo, o el único camión activo de la cuenta); si no puede, 23514. Un gasto sin litros no exige camión.';

-- Marca durable en la columna (la usa la sección 20 del test de aislamiento
-- para saber que la 011 está aplicada aunque la sección 19, que describe la
-- 010 sola, haya soltado el constraint dentro de su transacción de prueba).
comment on column public.gastos.litros is
  'Litros cargados (combustible). Con litros, el gasto exige camión: gastos_litros_camion_chk (migración 011).';

-- Si quedó algún gasto con litros sin camión, falla acá (23514) y se
-- deshace toda la migración, relleno incluido. Ver "Cómo resolverlo a mano".
alter table public.gastos
  validate constraint gastos_litros_camion_chk;
