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
const ViajeDetallePage = lazy(() =>
  import('@/features/viajes/viaje-detalle-page').then((m) => ({ default: m.ViajeDetallePage })),
);
const DevolucionFormPage = lazy(() =>
  import('@/features/devoluciones/devolucion-form-page').then((m) => ({ default: m.DevolucionFormPage })),
);
const GastosPage = lazy(() => import('@/features/gastos/gastos-page').then((m) => ({ default: m.GastosPage })));
const GastoFormPage = lazy(() =>
  import('@/features/gastos/gasto-form-page').then((m) => ({ default: m.GastoFormPage })),
);
const ClientesPage = lazy(() => import('@/features/clientes/clientes-page').then((m) => ({ default: m.ClientesPage })));
const ClienteDetallePage = lazy(() =>
  import('@/features/clientes/cliente-detalle-page').then((m) => ({ default: m.ClienteDetallePage })),
);
const ClienteFormPage = lazy(() =>
  import('@/features/clientes/cliente-form-page').then((m) => ({ default: m.ClienteFormPage })),
);
const CamionesPage = lazy(() => import('@/features/camiones/camiones-page').then((m) => ({ default: m.CamionesPage })));
const CamionFormPage = lazy(() =>
  import('@/features/camiones/camion-form-page').then((m) => ({ default: m.CamionFormPage })),
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
          <Route path="viajes/:id" element={<ViajeDetallePage />} />
          <Route path="viajes/:id/editar" element={<ViajeFormPage modo="editar" />} />
          {/* Las devoluciones se cargan SOLO desde el detalle de un viaje y se editan desde ahí o desde la pestaña Devoluciones de
              `/viajes` (`?vista=devoluciones`, que no es una ruta aparte): rutas anidadas bajo el viaje (el viaje va en la URL). No
              chocan con las de arriba: react-router rankea por segmentos y estas tienen 4 y 5 (`nueva` es literal). */}
          <Route path="viajes/:viajeId/devoluciones/nueva" element={<DevolucionFormPage modo="nuevo" />} />
          <Route path="viajes/:viajeId/devoluciones/:id/editar" element={<DevolucionFormPage modo="editar" />} />
          <Route path="gastos" element={<GastosPage />} />
          <Route path="gastos/nuevo" element={<GastoFormPage modo="nuevo" />} />
          <Route path="gastos/:id/editar" element={<GastoFormPage modo="editar" />} />
          {/* `clientes/nuevo` (literal) gana sobre `clientes/:id`: react-router rankea los segmentos literales primero. El
              `:id` lo valida cada pantalla con `isUuid` (si no es uuid, "Cliente no encontrado" sin consultar nada). */}
          <Route path="clientes" element={<ClientesPage />} />
          <Route path="clientes/nuevo" element={<ClienteFormPage modo="nuevo" />} />
          <Route path="clientes/:id" element={<ClienteDetallePage />} />
          <Route path="clientes/:id/editar" element={<ClienteFormPage modo="editar" />} />
          {/* Camiones: se llega desde Configuración (y desde Inicio mientras no hay ninguno); no están en la barra de abajo.
              `camiones/nuevo` (literal) gana sobre `camiones/:id/editar`; el `:id` lo valida la pantalla con `isUuid`. */}
          <Route path="camiones" element={<CamionesPage />} />
          <Route path="camiones/nuevo" element={<CamionFormPage modo="nuevo" />} />
          <Route path="camiones/:id/editar" element={<CamionFormPage modo="editar" />} />
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
