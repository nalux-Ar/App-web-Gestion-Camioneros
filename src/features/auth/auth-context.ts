import { createContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

/**
 * Solo la definición del contexto (sin JSX): el Provider vive en
 * `auth-provider.tsx` y el hook en `use-auth.ts`. Separado a propósito
 * (no es solo estilo): un archivo que exporta un componente junto con un
 * hook o un objeto de contexto rompe el "Fast Refresh boundary" de Vite
 * (`react-refresh/only-export-components`) y fuerza recargas completas en
 * vez de HMR en cada cambio durante desarrollo.
 */
export type AuthStatus = 'loading' | 'ready';

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  status: AuthStatus;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
