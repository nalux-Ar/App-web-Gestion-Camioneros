import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

import { AppRouter } from '@/app/router';
import { ErrorBoundary } from '@/components/shared/error-boundary';
import { AuthProvider } from '@/features/auth/auth-provider';
import { MemberProvider } from '@/features/member/member-provider';
import { queryClient } from '@/lib/query-client';

// - ErrorBoundary va lo más arriba posible: un error de render en cualquier
//   parte (incluidos los providers) muestra "Algo salió mal / Recargar" en vez
//   de una pantalla en blanco. No cambia el flujo de auth: no toca sesión,
//   rutas ni storage, y al recargar todo arranca normal (main.tsx).
// - QueryClientProvider va POR ENCIMA de AuthProvider a propósito: AuthProvider
//   usa el cliente para vaciar la caché cuando cambia o se cierra la sesión
//   (ver src/lib/query-client.ts).
function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <MemberProvider>
              <AppRouter />
            </MemberProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
