import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { AuthShell } from '@/features/auth/components/auth-shell';
import { AppShell } from '@/features/layout/app-shell';
import { RecoveryGuard, RequireAuth, RequireGuest, RequireMember, RequireNoMember } from './guards';

// Code-splitting por página: react + react-dom + react-router + el cliente
// de Supabase ya pesan lo suyo en el chunk principal (hace falta todo eso
// para saber, ANTES de mostrar cualquier pantalla, si hay sesión). Lo que
// sí se puede diferir es el código de cada pantalla en sí: nadie necesita
// el formulario de "restablecer contraseña" ni la de "reportes" en la
// carga inicial. Con esto el camionero baja menos JS de entrada, que
// importa con mala señal. Los límites de Suspense viven en AuthShell y
// AppShell (no acá arriba), para que el header/placa del logo no
// desaparezcan mientras carga el chunk de la pantalla.
const LoginPage = lazy(() => import('@/features/auth/pages/login-page').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('@/features/auth/pages/register-page').then((m) => ({ default: m.RegisterPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('@/features/auth/pages/forgot-password-page').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('@/features/auth/pages/reset-password-page').then((m) => ({ default: m.ResetPasswordPage })),
);
const WelcomePage = lazy(() =>
  import('@/features/onboarding/welcome-page').then((m) => ({ default: m.WelcomePage })),
);
const InicioPage = lazy(() => import('@/features/home/inicio-page').then((m) => ({ default: m.InicioPage })));
const ComingSoonPage = lazy(() =>
  import('@/features/coming-soon/coming-soon-page').then((m) => ({ default: m.ComingSoonPage })),
);
const ViajesPage = lazy(() => import('@/features/viajes/viajes-page').then((m) => ({ default: m.ViajesPage })));
const ViajeFormPage = lazy(() =>
  import('@/features/viajes/viaje-form-page').then((m) => ({ default: m.ViajeFormPage })),
);
const GastosPage = lazy(() => import('@/features/gastos/gastos-page').then((m) => ({ default: m.GastosPage })));
const GastoFormPage = lazy(() =>
  import('@/features/gastos/gasto-form-page').then((m) => ({ default: m.GastoFormPage })),
);
const ConfiguracionPage = lazy(() =>
  import('@/features/configuracion/configuracion-page').then((m) => ({ default: m.ConfiguracionPage })),
);

export function AppRouter() {
  return (
    // RecoveryGuard envuelve TODO: aplica incluso a /ingresar, /registro,
    // /recuperar-contrasena y /bienvenida, no solo a la app logueada (ver
    // src/app/guards.tsx).
    <RecoveryGuard>
      <Routes>
        {/* Pantallas de autenticación: siempre oscuras y doradas (AuthShell) */}
        <Route element={<AuthShell />}>
          <Route
            path="/ingresar"
            element={
              <RequireGuest>
                <LoginPage />
              </RequireGuest>
            }
          />
          <Route
            path="/registro"
            element={
              <RequireGuest>
                <RegisterPage />
              </RequireGuest>
            }
          />
          <Route
            path="/recuperar-contrasena"
            element={
              <RequireGuest>
                <ForgotPasswordPage />
              </RequireGuest>
            }
          />
          {/* Sin RequireGuest a propósito: se llega acá con una sesión de
              recuperación recién creada al canjear el enlace del correo
              (src/lib/process-auth-redirect.ts); RecoveryGuard mantiene al
              usuario en esta ruta hasta que guarde la contraseña o cancele. */}
          <Route path="/restablecer-contrasena" element={<ResetPasswordPage />} />
          <Route
            path="/bienvenida"
            element={
              <RequireAuth>
                <RequireNoMember>
                  <WelcomePage />
                </RequireNoMember>
              </RequireAuth>
            }
          />
        </Route>

        {/* App logueada, con transportista ya creado */}
        <Route
          element={
            <RequireAuth>
              <RequireMember>
                <AppShell />
              </RequireMember>
            </RequireAuth>
          }
        >
          <Route index element={<InicioPage />} />
          <Route path="viajes" element={<ViajesPage />} />
          <Route path="viajes/nuevo" element={<ViajeFormPage modo="nuevo" />} />
          <Route path="viajes/:id/editar" element={<ViajeFormPage modo="editar" />} />
          <Route path="gastos" element={<GastosPage />} />
          <Route path="gastos/nuevo" element={<GastoFormPage modo="nuevo" />} />
          <Route path="gastos/:id/editar" element={<GastoFormPage modo="editar" />} />
          <Route path="clientes" element={<ComingSoonPage title="Clientes" />} />
          <Route path="reportes" element={<ComingSoonPage title="Reportes" />} />
          <Route path="configuracion" element={<ConfiguracionPage />} />
        </Route>

        {/* Ruta desconocida -> Inicio (que a su vez, sin sesión, manda a
            /ingresar recordando a dónde se quería ir). */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </RecoveryGuard>
  );
}
