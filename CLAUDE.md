# CLAUDE.md — Elan (app-transportistas)

## Antes de cualquier tarea
- Leer `CONTEXT.md` y `PLAN.md`.
- Leer también `docs-privados/` si existe (carpeta local, ignorada por git): datos del cliente, del negocio y de infraestructura —p.ej. el ref del proyecto de Supabase— que no van al repo público.
- Antes de arrancar cualquier bloque, revisar qué subagentes hay disponibles y delegar según la sección "Forma de trabajo con subagentes" de abajo.

## Reglas fijas
- **"Mostrame antes"**: todo lo que se pida con "mostrame antes" se muestra y se espera el "dale" antes de ejecutarlo. Incluye commits y push.
- Las migraciones se aplican **solo vía el MCP de Supabase** (`apply_migration` sobre el proyecto del repo; ref en `docs-privados/supabase.md`), siempre mostrando el SQL completo y pidiendo confirmación explícita antes de correr contra la base real.
  - Nombre de la migración = nombre del archivo en `supabase/migrations/` sin `.sql` (p.ej. `004_algo`).
  - **No usar `supabase db push`** ni el CLI: desalinearía el historial de migraciones.
  - Después de aplicar, correr `supabase/tests/aislamiento.sql` con `execute_sql`, mostrar la salida (tiene que terminar con `OK: N/N` intencional), verificar que no queden datos de prueba y correr `get_advisors` (security).
- Toda tabla nueva lleva `transportista_id` + RLS, sin excepciones.
- El cliente nunca envía `transportista_id` (lo completa la base con `get_mi_transportista_id()`).
- Las categorías de gasto son configurables (tabla `categorias_gasto`, no enum).
- Ningún color se hardcodea en componentes. Todo el theming sale de variables CSS (`--background`, `--foreground`, `--primary`, etc.).
- El logo vive en `src/assets/branding/logo.png`. Si no está ahí, pedírselo al responsable del proyecto en vez de generar uno propio.
- Al cerrar un bloque, actualizar `PLAN.md`. Las decisiones nuevas van a `CONTEXT.md` con fecha y motivo.

## Git y repo público
- **El repo es público.** En archivos trackeados y en mensajes de commit no van nombres de personas, datos del cliente, información comercial, refs/URLs de infraestructura ni secretos. Esos datos van solo en `docs-privados/`.
- Al cerrar cada tanda de cambios: commit semántico y push a `main` con `git push origin main` (nunca `--all`, `--tags` ni `--force`), con `npm run lint` y `npm run build` pasando, `git status` sin `.env*` y sin datos del cliente ni del negocio en lo que se sube.
- La rama local `backup-privado` guarda el historial original con datos del negocio: **nunca se pushea**.
- Autor de los commits: el email noreply de GitHub de la cuenta dueña, configurado solo a nivel local del repo (`git config --local`); no tocar la config global.
- Credenciales de GitHub por el navegador; nunca pedir tokens por el chat.

## Forma de trabajo con subagentes (aplica a TODOS los bloques)
| Tipo de trabajo | Subagente |
|---|---|
| Esquema de base de datos, migraciones, RLS | `database-architect` |
| UI, componentes, estilos, frontend | `frontend-architect` (diseño visual puro: `design-expert`) |
| Lógica de servidor, funciones, endpoints | `backend-architect` |
| Seguridad — **siempre** antes de cerrar un bloque que toque datos, permisos o auth (escaladas de privilegio, fugas entre tenants, inyección, SECURITY DEFINER inseguras) | `appsec-secure-coding` |

- Lo que encuentre `appsec-secure-coding` se corrige antes de dar el bloque por terminado.
- Si una tarea no tiene subagente específico, se hace en el hilo principal y se anota en `PLAN.md` ("Registro de subagentes").
- Nunca hacer todo en un solo hilo cuando existe el subagente que corresponde.
