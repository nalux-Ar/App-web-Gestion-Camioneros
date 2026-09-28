import { useContext } from 'react';

import { AuthContext, type AuthContextValue } from './auth-context';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth se tiene que usar dentro de <AuthProvider>.');
  }
  return ctx;
}
