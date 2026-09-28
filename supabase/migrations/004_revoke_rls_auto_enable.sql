-- =====================================================================
-- 004_revoke_rls_auto_enable.sql — Elan (endurecimiento post Bloque A)
-- =====================================================================
-- Qué hace: saca el EXECUTE de public.rls_auto_enable() a public, anon
-- y authenticated.
--
-- Contexto: rls_auto_enable() NO es nuestra. Supabase la crea en
-- proyectos nuevos (opción "RLS automático") junto con el event trigger
-- ensure_rls (ddl_command_end), que activa RLS en cada tabla nueva de
-- public. Es SECURITY DEFINER y quedaba ejecutable por anon/authenticated,
-- lo que marca el advisor 0028/0029. Devuelve event_trigger, así que en
-- la práctica no se puede invocar como RPC; esto solo cierra el aviso.
--
-- No afecta al event trigger: el dueño de la función (postgres) conserva
-- EXECUTE, y es quien corre las migraciones que crean tablas.
-- =====================================================================

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
