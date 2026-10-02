# PLAN — Elan

> **⚠️ PAUSADO: Cloudflare Turnstile (captcha) — hay que REACTIVARLO antes de que haya usuarios reales o de lanzar la app.**
> Desde el 2026-10-02 está apagado en Supabase (Authentication → Attack Protection → "Enable Captcha protection") y en el front (`TURNSTILE_ENABLED = false` en `src/lib/turnstile-config.ts`: sin widget, sin script de Cloudflare y sin `captchaToken`).
> Para reactivarlo, los dos lados a la vez (si no, el ingreso se rompe):
> 1. Poner `TURNSTILE_ENABLED = true` y desplegar.
> 2. Volver a activar "Enable Captcha protection" en Supabase con la secret key de Cloudflare.
> 3. Confirmar que `VITE_TURNSTILE_SITE_KEY` sigue cargada en Vercel (Production y Preview).
> 4. Probar login, registro y recuperación de contraseña.
>
> Riesgo mientras esté pausado: la web pública comparte el mismo Supabase y el registro no exige confirmar el email, así que cualquiera que tenga el link puede crear cuentas y datos. Aceptado porque hoy solo la usa el equipo del proyecto.

## Bloques
- [x] **Bloque A**: esquema + RLS + test de aislamiento con 2 tenants — cerrado 2026-09-23. Auditado por `appsec-secure-coding` (sin críticos/altos; los medios/bajos quedaron corregidos). Validado localmente en PGlite (`OK: 80/80`) y **aplicado en la base real el 2026-09-28** vía MCP (`001_schema`, `002_functions`, `003_rls`): `aislamiento.sql` contra Supabase → `OK: 80/80`, sin datos residuales, RLS activo en las 9 tablas, 4 categorías globales.
- [x] **Bloque B**: auth (login email/contraseña, registro, recuperar contraseña, onboarding del transportista) + pantalla de Login con fondo oscuro, detalles dorados y el logo de Elan centrado + layout compartido con el logo (versión chica) en el header, visible en toda la app ya logueado + pantalla de Configuración con toggle claro/oscuro y selector de color de acento — implementado 2026-09-28, auditado por `appsec-secure-coding` (1 crítico, 2 altos, 1 medio y 1 bajo, todos corregidos). Sin migraciones nuevas. **Pendiente del responsable del proyecto**: prueba manual con `docs/checklist-bloque-b.md`.
- [ ] **Bloque C**: carga de viajes, entregas, devoluciones y gastos — en curso, por etapas (cada una cierra con auditoría de `appsec-secure-coding`):
  - [x] Etapa 0: base compartida (TanStack Query, números y fechas, componentes para el celular, errores, resiliencia de formularios). Implementada, auditada y commiteada en local (sin pushear).
  - [x] Migraciones `005_gastos_combustible` (`km_odometro`, `tanque_lleno` + check de coherencia con `litros`) y `006_gastos_client_ref` (`client_ref` con índice único parcial por tenant, inmutable): **aplicadas en la base real el 2026-10-01** vía MCP. `aislamiento.sql` contra Supabase → `OK: 102/102` (el 10.1 queda OMITIDO: `postgres` no es superuser), sin datos residuales, 4 categorías globales, advisors sin avisos nuevos. `src/lib/database.types.ts` regenerado (001–006).
  - [x] Migración `007_viajes_client_ref_y_funciones` (base de datos de la Etapa 2): `viajes.client_ref` (único por tenant, inmutable) y las funciones `crear_viaje_con_entregas` / `actualizar_viaje_con_entregas` (atómicas, `SECURITY INVOKER`): **aplicada en la base real el 2026-10-02** vía MCP. `aislamiento.sql` → `OK: 148/148` (el 10.1 queda OMITIDO), sin datos residuales, advisors sin avisos nuevos. `src/lib/database.types.ts` regenerado (001–007). La primera corrida dio 147/148: el caso 15.14 esperaba el SQLSTATE `23001` y la base (PostgreSQL 17) devuelve `23503` para un `ON DELETE RESTRICT`; se corrigió el test (el comportamiento de la base era el correcto).
  - [ ] Etapa 1: Gastos (listado con filtro por mes y categoría, carga en pocos toques, combustible con litros, km y tanque lleno, editar y borrar). Reglas ya definidas (ver "Bloque C" en Pendientes): reintento idempotente con `client_ref` y limpieza de campos de combustible al cambiar de categoría.
  - [ ] Etapa 2: Viajes (fecha, origen, destino, km, entregas con incidencias, "+ Nuevo cliente" solo con nombre). Viaje + entregas se guardan con la función atómica de la 007 (ya aplicada); falta el front.
  - [ ] Etapa 3: vínculo gasto ↔ viaje.
  - Después, otra etapa: devoluciones, clientes y camión, resumen.
- [ ] **Bloque D**: reportes (gasto total, ganancia si hay ingreso cargado, consumo y rendimiento de combustible, estimado mensual)

## Registro de subagentes
| Fecha | Tarea | Subagente |
|---|---|---|
| 2026-09-23 | Scaffold Vite + React + TS + Tailwind + shadcn/ui, sistema de theming | `frontend-architect` |
| 2026-09-23 | Bloque A: esquema, funciones, RLS, test de aislamiento (+ correcciones de la auditoría) | `database-architect` |
| 2026-09-23 | Bloque A: auditoría de seguridad + verificación de las correcciones (2 pasadas) | `appsec-secure-coding` |
| 2026-09-23 | CLAUDE.md, CONTEXT.md, PLAN.md, .gitignore, .env.example, .gitattributes | Hilo principal (no hay subagente dedicado a documentación) |
| 2026-09-23 | Ajuste puntual del test 10.1 (restaurar la sesión con `set session authorization <original>` en vez de `reset`) + verificación final en PGlite | Hilo principal (cambio de 2 líneas, detectado por `database-architect`) |
| 2026-09-23 | Git (init, commits) | Hilo principal (no hay subagente dedicado) |
| 2026-09-23 | Logo: guardar el original y generar `logo-header.png` (recorte + resize con `sharp`, sin tocar el diseño) | Hilo principal (procesamiento de asset, no requiere subagente de diseño) |
| 2026-09-28 | Aplicar Bloque A en la base real vía MCP de Supabase + test + advisors (se evaluó y descartó el CLI) | Hilo principal (ejecución de migraciones ya auditadas; no hay subagente dedicado) |
| 2026-09-28 | Migración `004_revoke_rls_auto_enable` + verificación del event trigger + advisors | Hilo principal (SQL de una línea dictado por el responsable del proyecto que solo quita privilegios; no pasó por `database-architect` ni `appsec-secure-coding`) |
| 2026-09-28 | Bloque B: cliente Supabase, auth, onboarding, layout, Configuración, ESLint (+ correcciones de la auditoría) | `frontend-architect` |
| 2026-09-28 | Bloque B: auditoría de seguridad de auth (flujo implícito, recuperación, enumeración, `?volver=`, sesión, storage) | `appsec-secure-coding` |
| 2026-09-28 | URL y publishable key por MCP, tipos TS generados por MCP, logos WebP y favicon (`sharp`), puerto 3000, docs, checklist, commits | Hilo principal (tooling/assets/docs; no hay subagente dedicado) |
| 2026-09-28 | Repo público: auditoría de contenido e historial, `docs-privados/`, historial reiniciado en un commit limpio, LICENSE, README, autor noreply local | Hilo principal (tooling/git; no hay subagente dedicado) |
| 2026-09-28 | UI a español neutro (tú) | `frontend-architect` (42 textos); ajustes puntuales posteriores (Escribe, enviar/enlace, mensajes de desarrollador y 3 comentarios) en el hilo principal por ser solo texto |
| 2026-09-29 | Recuperación de contraseña con `token_hash` + `verifyOtp` (bug del prefetch de Gmail) + correcciones de su auditoría (email visible, limpieza de URL, arranque robusto) | `frontend-architect` |
| 2026-09-29 | Auditoría del cambio a `token_hash` (sin críticos/altos; 1 medio y 3 bajos corregidos) | `appsec-secure-coding` |
| 2026-09-30 | Cloudflare Turnstile en login, registro y recuperación (+ ajustes de su auditoría) | `frontend-architect` |
| 2026-09-30 | Auditoría de Turnstile (sin críticos/altos) | `appsec-secure-coding` |
| 2026-09-30 | Chequeo de variables de entorno en `vite.config.ts` (el build de producción falla si falta alguna; hallazgo medio de la auditoría de Turnstile) | Hilo principal (config de build de pocas líneas, aprobada explícitamente) |
| 2026-09-30 | Bloque C, Etapa 0: base compartida (TanStack Query, números y fechas locales, componentes para el celular, errores, resiliencia de formularios) y sus correcciones | `frontend-architect` |
| 2026-09-30 | Bloque C: migración `005_gastos_combustible` (redactada y validada en PGlite; sin aplicar) y análisis de `client_ref` | `database-architect` |
| 2026-09-30 | Bloque C, Etapa 0: auditoría (sin críticos ni altos; 2 medios y varios bajos, corregidos) | `appsec-secure-coding` |
| 2026-09-30 | Bloque C: lectura del esquema real por MCP (solo lectura), plan por etapas, verificación y documentación | Hilo principal (coordinación y docs; no hay subagente dedicado) |
| 2026-10-01 | Bloque C: aplicar `005` y `006` en la base real vía MCP, correr `aislamiento.sql` (102/102), verificar residuos, advisors y regenerar los tipos TS | Hilo principal (ejecución de migraciones ya redactadas y aprobadas por el responsable del proyecto; no hay subagente dedicado) |
| 2026-10-02 | Bloque C, Etapa 2: migración `007_viajes_client_ref_y_funciones` (`viajes.client_ref` y funciones atómicas `crear_viaje_con_entregas` / `actualizar_viaje_con_entregas`) con las secciones 13 a 15 del test de aislamiento | `database-architect` |
| 2026-10-02 | Bloque C: aplicar `007` en la base real vía MCP, correr `aislamiento.sql` (148/148, tras corregir el caso 15.14), verificar residuos y advisors y regenerar los tipos TS | Hilo principal (ejecución de una migración ya redactada y confirmada por el responsable del proyecto; no hay subagente dedicado) |
| 2026-10-02 | Pausar Turnstile en el front con el interruptor `TURNSTILE_ENABLED` (login, registro y recuperación sin captcha; el build ya no exige la site key mientras esté apagado) | `frontend-architect` |
| 2026-09-28 | Revisión de las correcciones de appsec: restaurar la pantalla "Revisá tu correo" del registro (el subagente la había sacado; hace falta con Confirm email activado) y corregir comentarios de `main.tsx`/`auth-errors.ts` | Hilo principal (ajuste chico detectado al revisar; no pasó de nuevo por `frontend-architect` ni `appsec-secure-coding`) |

## Pendientes / notas para próximos bloques
- **Logo**: `logo.png` (original provisto por el responsable del proyecto) y `logo-header.png` sin modificar; la app usa derivados WebP (`logo-login.webp` 18 KB, `logo-header.webp` 11 KB) y el favicon es la cabina del camión (`public/favicon.png`, `apple-touch-icon.png`). Como el logo tiene fondo negro, va siempre sobre una placa oscura fija (también en modo claro).
- **Advisors de seguridad** (última corrida 2026-10-02, después de la `007`): 3 avisos 0029, **todos intencionales** — `create_transportista`, `cambiar_rol_miembro` y `get_mi_transportista_id` ejecutables por `authenticated` (son las RPC del diseño y el helper que usan las policies). Las migraciones 005, 006 y 007 no sumaron avisos (`fn_bloquear_cambio_client_ref` y `fn_bloquear_cambio_client_ref_viaje` tienen el `EXECUTE` revocado; las funciones de viajes son `SECURITY INVOKER`, que el aviso 0029 no alcanza). `rls_auto_enable()` quedó resuelto con `004_revoke_rls_auto_enable` (event trigger verificado: una tabla nueva en `public` nace con RLS).
  - Además aparece `auth_leaked_password_protection` (Authentication → Providers → Email → "Prevent use of leaked passwords"): es un ajuste de Auth del dashboard, no de las migraciones. Para el responsable del proyecto: revisar si el plan de Supabase lo permite y activarlo; si no, queda como aviso conocido (la app ya exige 8 caracteres con letra y número).
- **Mejora opcional (no urgente): mover `get_mi_transportista_id()` a un schema no expuesto** (p.ej. `private`). Motivo: hoy se puede llamar por `/rest/v1/rpc/get_mi_transportista_id`, aunque por RPC solo devuelve el tenant del propio usuario que llama (no filtra datos de otros), así que el riesgo es nulo; moverla solo sacaría el aviso 0029 y achicaría la superficie de la API. Implica una migración que recree la función en `private` y actualice las 14 policies y el trigger que la usan, más `grant usage on schema private to authenticated`. Decidido el 2026-09-28: por ahora no.
- **Supabase dashboard (responsable del proyecto)**:
  - Authentication → URL Configuration: hoy Site URL `http://localhost:3000` y Redirect URLs `http://localhost:3000/**`. Cuando exista el dominio de Vercel, sumarlo a Redirect URLs y pasar el Site URL a producción.
  - Authentication → Providers → Email: subir el largo mínimo de contraseña a 8 (la app ya exige 8 + letra + número; así también lo exige el servidor).
  - Antes de producción: activar **Confirm email** (cierra la enumeración de emails en el registro; la app ya maneja la pantalla "Revisá tu correo") y configurar SMTP propio (el envío de mails por defecto de Supabase tiene un límite muy bajo).
- **Recuperación con `token_hash` — configuración a cuidar (auditoría 2026-09-29)**:
  - Redirect URLs: con `{{ .RedirectTo }}` en la plantilla, el allowlist es el control crítico. Cuando se sume Vercel, cargar **solo el dominio de producción exacto**, nunca `https://*.vercel.app/**` (con un comodín, cualquiera con la publishable key podría pedir un reset con `redirectTo` a su propio sitio y quedarse con el `token_hash`). Para producción, sacar `localhost` del allowlist o usar un proyecto de Supabase separado.
  - Verificar en Supabase que la expiración de los OTP de email siga en ≤ 1 h, y en Vercel que Web Analytics / Speed Insights y Log Drains a terceros estén apagados (el `token_hash` viaja en el query y puede quedar en logs).
  - Con SMTP propio: desactivar click tracking y open tracking en los mails de auth.
  - Mejoras opcionales: mensaje distinto si `verifyOtp` falla por falta de red (hoy dice "El enlace venció" aunque el token no se gastó) y un loader estático en `index.html` mientras se canjea el enlace.
- **Turnstile — configuración a cuidar (auditoría 2026-09-30)** (hoy **pausado**, ver el aviso al inicio de este archivo; lo siguiente aplica al reactivarlo):
  - **Antes de pushear**: cargar `VITE_TURNSTILE_SITE_KEY` en Vercel (Production y Preview). Sin ella, las pantallas de ingreso fallan.
  - Cloudflare → Turnstile: en producción permitir solo el dominio real (con `localhost` permitido, la restricción de dominio es cosmética).
  - Verificar que Supabase → Attack Protection → CAPTCHA esté activado: si no, Supabase ignora el token y el captcha no protege nada. Prueba: una request de login sin token tiene que dar `captcha_failed`.
  - Cualquier `resend`/`signInWithOtp` futuro tiene que mandar `captchaToken`.
  - Aviso de privacidad: mencionar que Cloudflare procesa IP y señales del navegador para el captcha.
  - CSP futuro: permitir `https://challenges.cloudflare.com` en `script-src`, `frame-src` y `connect-src` (probar primero en modo Report-Only). No agregar `preconnect` a Cloudflare en `index.html`: pegaría también en `/restablecer-contrasena`.
- **Pendientes de decisión (auth)**:
  - ~~Migrar el link de recuperación a `token_hash` + `verifyOtp`~~ → hecho el 2026-09-29 (bug del prefetch de Gmail). Requiere que la plantilla "Reset Password" del dashboard use `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`.
  - Endurecimiento opcional: algunos escáneres de correo (p.ej. los que abren el link en un navegador real) sí ejecutan JS y podrían consumir el `token_hash`. Si vuelve a pasar, pedir un clic en "Continuar" antes de llamar a `verifyOtp`.
  - Confirmación de registro y cambio de email siguen con `{{ .ConfirmationURL }}` (fragmento implícito): cuando se active "Confirm email", evaluar pasarlos también a `token_hash` por el mismo problema de prefetch.
  - CSP completo (`script-src`/`connect-src`) en `vercel.json`: hoy solo `frame-ancestors`. Requiere relevar todos los orígenes usados.
  - Subir a react-router 8 / ESLint 10 como tarea aparte.
- **Bloque C**:
  - Invitación de choferes a un tenant: no existe todavía (hoy solo `create_transportista` crea miembros). Va a necesitar su propia función SECURITY DEFINER + auditoría.
  - Ediciones por UPDATE, nunca upsert por `id` (la base genera el id).
  - Policies de Storage para las fotos de gastos (carpeta por `transportista_id`) y validación de `gastos.foto_url` (guardar el path del bucket, nunca aceptar `javascript:`/`data:`).
  - Resiliencia liviana de formularios (no perder lo tipeado si falla el guardado). La idempotencia de reintentos de **gastos** se resuelve con `gastos.client_ref` (migración 006); para **viajes** se resolvió en la migración 007 (`viajes.client_ref` + `crear_viaje_con_entregas` / `actualizar_viaje_con_entregas`, `SECURITY INVOKER` con `search_path` fijo; aplicada el 2026-10-02).
  - **Etapa 2 (Viajes) — contrato de la base para el front (007)**:
    - `crear_viaje_con_entregas` devuelve `[{ viaje_id, creado }]` (una fila). `creado = false` significa que el `client_ref` ya estaba guardado en el propio tenant: mostrar "Viaje guardado" y, si el usuario cambió datos entre intentos, llamar a `actualizar_viaje_con_entregas` con ese `viaje_id`. Desde `crear` nunca sale un 23505. El `client_ref` se genera al abrir el formulario, se mantiene en cada reintento y se regenera tras guardar bien.
    - `actualizar_viaje_con_entregas` es un reemplazo completo: todos los parámetros son obligatorios (`null` explícito para vaciar un campo) y la lista de entregas queda exactamente como se manda (con `id` se actualiza, sin `id` se inserta, las que faltan se borran). Los tipos generados no admiten `null` en esos parámetros: envolver la llamada con un tipado a mano.
    - Entregas: `[{ id?, cliente_id, incidencias? }]`, hasta 100 por viaje; el orden se conserva con `created_at` (listar por `(created_at, id)`), sin reordenar. La fecha va siempre explícita y local (nunca el default de la base, que es UTC). Último guardado gana entre pestañas.
    - Errores (SQLSTATE en `error.code`): `42501` sin sesión o sin transportista; `22023` parámetros inválidos; `23503` cliente o camión inválido; `P0002` viaje o entrega no encontrados (refrescar); `23502` / `23514` / `22003` de las tablas, con el nombre del constraint en el mensaje.
    - Borrar un viaje con gastos vinculados da `23503` (FK `RESTRICT`), el mismo código que una referencia inválida: mapearlo por el contexto del borrado ("tiene gastos vinculados"). Borrar un viaje borra en cascada sus entregas y devoluciones.
    - "+ Nuevo cliente": solo con nombre. El aviso de duplicado va únicamente en el front (nombres normalizados contra la lista cargada); no hay unique por nombre en la base.
  - **Etapa 1 (Gastos) — reglas definidas el 2026-10-01**:
    - `client_ref`: el front genera un uuid al abrir el formulario, lo mantiene en cada "Reintentar" y lo regenera tras guardar bien. Se guarda con INSERT (no upsert: el índice es parcial y PostgREST responde 42P10). Si el INSERT falla con `23505` en `gastos_transportista_client_ref_uidx`, el gasto ya estaba guardado: se muestra **"Gasto guardado"** (no un error) y, si el usuario cambió datos entre intentos, se hace un **UPDATE por `client_ref`** con lo que está en pantalla. El UPDATE nunca manda `client_ref` (es inmutable).
    - Al **editar** un gasto y cambiar su categoría a una que **no** es Combustible, el front limpia `litros`, `precio_por_litro`, `km_odometro` y `tanque_lleno` (los manda en `null`). Si se borran los litros, también se manda `tanque_lleno: null` (el check de la base rechaza `tanque_lleno = true` sin litros). "Solo para combustible" lo resuelve el front, no un trigger; Combustible se identifica por el id de la categoría global.
- **Confirmación de email en el registro: en pausa.** El código está en la rama local `feat/confirmacion-email` (commit `wip`, sin pushear y sin auditar). Antes de retomar: auditoría de `appsec-secure-coding`, prueba local, rebase sobre `main`, y activar "Confirm email" y la plantilla "Confirm signup" de Supabase **junto con el deploy** (el código desplegado y la configuración tienen que cambiar a la vez; si no, el registro en producción se rompe).
- Agregar componentes de shadcn con `npx shadcn@2.3.0 add <componente>` (compatible con Tailwind v3), no con `@latest`.
