import { createContext } from 'react';

import type { Enums } from '@/lib/database.types';
import type { ThemeMode } from '@/lib/theme';

/**
 * Solo la definición del contexto (sin JSX): el Provider vive en
 * `member-provider.tsx` y el hook en `use-member.ts`. Mismo motivo que en
 * `features/auth/auth-context.ts`: no romper el Fast Refresh boundary.
 */
export interface MemberInfo {
  rol: Enums<'rol_miembro'>;
  tema: ThemeMode;
  colorAcento: string;
  transportistaId: string;
  transportistaNombre: string;
}

/**
 * - `idle`: todavía no hay usuario logueado (no hace falta pedir nada).
 * - `loading`: pidiendo la fila de `miembros`.
 * - `ready`: hay fila, `member` tiene los datos.
 * - `no-member`: el usuario está logueado pero no tiene fila todavía
 *   (le falta el onboarding, `/bienvenida`).
 * - `error`: no se pudo determinar nada (típicamente sin conexión). Ojo:
 *   NUNCA se trata como `no-member`, para no mandar a alguien con cuenta
 *   ya creada de vuelta al onboarding solo porque se cortó la señal.
 */
export type MemberStatus = 'idle' | 'loading' | 'ready' | 'no-member' | 'error';

export interface MemberContextValue {
  member: MemberInfo | null;
  status: MemberStatus;
  error: string | null;
  refetch: () => Promise<void>;
  updateLocalPreferences: (patch: Partial<Pick<MemberInfo, 'tema' | 'colorAcento'>>) => void;
}

export const MemberContext = createContext<MemberContextValue | null>(null);
