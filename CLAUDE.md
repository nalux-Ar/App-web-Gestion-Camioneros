# CLAUDE.md — Elan (app-transportistas)

## Antes de cualquier tarea
- Leer `CONTEXT.md` y `PLAN.md`.
- Leer también `docs-privados/` si existe (carpeta local, ignorada por git): datos del cliente, del negocio y de infraestructura —p.ej. el ref del proyecto de Supabase— que no van al repo público.
- Antes de arrancar cualquier bloque, revisar qué subagentes hay disponibles y delegar según la sección "Forma de trabajo con subagentes" de abajo.

## Reglas fijas
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

## Flujo de trabajo y Git
1. **Todo el desarrollo y las pruebas se hacen en local** (`npm run dev`, puerto 3000). La app de Vercel no se usa para probar: es solo para lo que ya está confirmado y listo.
2. **Regla fija, sin excepción**: ANTES de cualquier `git commit` o `git push`, mostrar:
   - qué archivos cambiaron (`git status` / `git diff` resumido),
   - el mensaje de commit propuesto,

   y esperar el **"dale" explícito** antes de ejecutar cualquiera de los dos comandos. Incluye correcciones chicas, ajustes de un comentario, cualquier cosa: no hay excepción por "es algo mínimo". Si por algún motivo técnico no se puede mostrar antes, no se ejecuta: avisar el motivo y esperar.
3. **El push solo se hace con el "dale"**, después de que el cambio se probó en local y está aprobado. El push a `main` dispara el deploy automático en Vercel: el punto 2 es el único control antes de que algo llegue a producción.
4. Se pueden agrupar varias correcciones chicas en un solo commit si tiene sentido, pero siempre mostrando el resumen y esperando el "dale" antes de ese commit.

### Repo público
- **El repo es público.** En archivos trackeados y en mensajes de commit no van nombres de personas, datos del cliente, información comercial, refs/URLs de infraestructura ni secretos. Esos datos van solo en `docs-privados/`.
- Antes de proponer un commit: commit semántico, `npm run lint` y `npm run build` pasando, `git status` sin `.env*` y sin datos del cliente ni del negocio en lo que se sube. Push solo con `git push origin main` (nunca `--all`, `--tags` ni `--force`).
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
