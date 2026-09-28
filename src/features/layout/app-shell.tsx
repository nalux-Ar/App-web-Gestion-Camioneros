import { Suspense } from 'react';
import { Outlet } from 'react-router';

import { Spinner } from '@/components/shared/spinner';
import { Header } from './header';
import { SidebarNav } from './sidebar-nav';
import { BottomNav } from './bottom-nav';

/** Layout compartido de toda la app logueada. `<main>` deja espacio abajo
 *  en mobile para no quedar tapado por la barra inferior fija. El
 *  Suspense va acá adentro (no en el router) para que el header y la
 *  navegación queden fijos mientras carga el chunk de cada sección (ver
 *  src/app/router.tsx). */
export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Header />
      <div className="mx-auto flex w-full max-w-5xl flex-1">
        <SidebarNav />
        <main className="min-w-0 flex-1 px-4 py-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-8">
          <Suspense
            fallback={
              <div className="flex justify-center py-16" role="status" aria-live="polite">
                <Spinner className="size-8 text-primary" />
                <span className="sr-only">Cargando…</span>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
