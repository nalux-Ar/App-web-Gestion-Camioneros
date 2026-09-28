# PLAN — Elan

## Bloques
- [x] **Bloque A**: esquema + RLS + test de aislamiento con 2 tenants — cerrado 2026-09-23. Auditado por `appsec-secure-coding` (sin críticos/altos; los medios/bajos quedaron corregidos). Validado localmente en PGlite (`OK: 80/80`) y **aplicado en la base real el 2026-09-28** vía MCP (`001_schema`, `002_functions`, `003_rls`): `aislamiento.sql` contra Supabase → `OK: 80/80`, sin datos residuales, RLS activo en las 9 tablas, 4 categorías globales.
- [x] **Bloque B**: auth (login email/contraseña, registro, recuperar contraseña, onboarding del transportista) + pantalla de Login con fondo oscuro, detalles dorados y el logo de Elan centrado + layout compartido con el logo (versión chica) en el header, visible en toda la app ya logueado + pantalla de Configuración con toggle claro/oscuro y selector de color de acento — implementado 2026-09-28, auditado por `appsec-secure-coding` (1 crítico, 2 altos, 1 medio y 1 bajo, todos corregidos). Sin migraciones nuevas. **Pendiente del responsable del proyecto**: prueba manual con `docs/checklist-bloque-b.md`.
- [ ] **Bloque C**: carga de viajes, entregas, devoluciones y gastos
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
| 2026-09-28 | Revisión de las correcciones de appsec: restaurar la pantalla "Revisá tu correo" del registro (el subagente la había sacado; hace falta con Confirm email activado) y corregir comentarios de `main.tsx`/`auth-errors.ts` | Hilo principal (ajuste chico detectado al revisar; no pasó de nuevo por `frontend-architect` ni `appsec-secure-coding`) |

## Pendientes / notas para próximos bloques
- **Logo**: `logo.png` (original provisto por el responsable del proyecto) y `logo-header.png` sin modificar; la app usa derivados WebP (`logo-login.webp` 18 KB, `logo-header.webp` 11 KB) y el favicon es la cabina del camión (`public/favicon.png`, `apple-touch-icon.png`). Como el logo tiene fondo negro, va siempre sobre una placa oscura fija (también en modo claro).
- **Advisors de seguridad** (última corrida 2026-09-28, después de la `004`): quedan 3 avisos 0029, **todos intencionales** — `create_transportista`, `cambiar_rol_miembro` y `get_mi_transportista_id` ejecutables por `authenticated` (son las RPC del diseño y el helper que usan las policies). `rls_auto_enable()` quedó resuelto con `004_revoke_rls_auto_enable` (event trigger verificado: una tabla nueva en `public` nace con RLS).
- **Mejora opcional (no urgente): mover `get_mi_transportista_id()` a un schema no expuesto** (p.ej. `private`). Motivo: hoy se puede llamar por `/rest/v1/rpc/get_mi_transportista_id`, aunque por RPC solo devuelve el tenant del propio usuario que llama (no filtra datos de otros), así que el riesgo es nulo; moverla solo sacaría el aviso 0029 y achicaría la superficie de la API. Implica una migración que recree la función en `private` y actualice las 14 policies y el trigger que la usan, más `grant usage on schema private to authenticated`. Decidido el 2026-09-28: por ahora no.
- **Supabase dashboard (responsable del proyecto)**:
  - Authentication → URL Configuration: hoy Site URL `http://localhost:3000` y Redirect URLs `http://localhost:3000/**`. Cuando exista el dominio de Vercel, sumarlo a Redirect URLs y pasar el Site URL a producción.
  - Authentication → Providers → Email: subir el largo mínimo de contraseña a 8 (la app ya exige 8 + letra + número; así también lo exige el servidor).
  - Antes de producción: activar **Confirm email** (cierra la enumeración de emails en el registro; la app ya maneja la pantalla "Revisá tu correo") y configurar SMTP propio (el envío de mails por defecto de Supabase tiene un límite muy bajo).
- **Pendientes de decisión (auth)**:
  - Migrar el link de recuperación a `token_hash` + `verifyOtp` (recomendación de la auditoría: funciona igual entre navegadores y deja en la URL un token de un solo uso). Requiere cambiar la plantilla de mail en el dashboard.
  - CSP completo (`script-src`/`connect-src`) en `vercel.json`: hoy solo `frame-ancestors`. Requiere relevar todos los orígenes usados.
  - Subir a react-router 8 / ESLint 10 como tarea aparte.
- **Bloque C**:
  - Invitación de choferes a un tenant: no existe todavía (hoy solo `create_transportista` crea miembros). Va a necesitar su propia función SECURITY DEFINER + auditoría.
  - Ediciones por UPDATE, nunca upsert por `id` (la base genera el id).
  - Policies de Storage para las fotos de gastos (carpeta por `transportista_id`) y validación de `gastos.foto_url` (guardar el path del bucket, nunca aceptar `javascript:`/`data:`).
  - Resiliencia liviana de formularios (no perder lo tipeado si falla el guardado). Si se necesita idempotencia de reintentos, usar una columna tipo `client_ref` con UNIQUE por tenant.
- Agregar componentes de shadcn con `npx shadcn@2.3.0 add <componente>` (compatible con Tailwind v3), no con `@latest`.
