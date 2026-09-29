import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';
import { DEFAULT_ACCENT, applyAccentColor, applyTheme, hexToHslTriplet } from '@/lib/theme';
import { writeCachedThemePreference } from '@/lib/theme-cache';
import { useAuth } from '@/features/auth/use-auth';
import { NETWORK_ERROR_MESSAGE } from '@/features/auth/auth-errors';
import type { Enums } from '@/lib/database.types';
import { MemberContext, type MemberContextValue, type MemberInfo, type MemberStatus } from './member-context';

interface RawMemberRow {
  rol: Enums<'rol_miembro'>;
  tema: string;
  color_acento: string;
  transportista_id: string;
  transportistas: { nombre: string } | null;
}

function normalizeMember(row: RawMemberRow): MemberInfo {
  return {
    rol: row.rol,
    tema: row.tema === 'light' ? 'light' : 'dark',
    colorAcento: hexToHslTriplet(row.color_acento) ? row.color_acento : DEFAULT_ACCENT,
    transportistaId: row.transportista_id,
    transportistaNombre: row.transportistas?.nombre ?? '',
  };
}

export function MemberProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const userId = user?.id ?? null;

  const [member, setMember] = useState<MemberInfo | null>(null);
  const [status, setStatus] = useState<MemberStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const fetchMember = useCallback(async () => {
    if (!userId) {
      setMember(null);
      setStatus('idle');
      setError(null);
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('miembros')
        .select('rol, tema, color_acento, transportista_id, transportistas(nombre)')
        .eq('user_id', userId)
        .maybeSingle();

      if (queryError) {
        setStatus('error');
        setError('No pudimos cargar tu cuenta. Prueba de nuevo.');
        return;
      }

      if (!data) {
        setMember(null);
        setStatus('no-member');
        return;
      }

      setMember(normalizeMember(data));
      setStatus('ready');
    } catch {
      setStatus('error');
      setError(NETWORK_ERROR_MESSAGE);
    }
  }, [userId]);

  useEffect(() => {
    if (authStatus !== 'ready') return;
    // `fetchMember` marca `status: 'loading'` de entrada (síncrono, antes
    // del primer `await`): llamarla directo acá haría que este efecto
    // dispare un setState en la misma pasada de renderizado en la que se
    // ejecuta, lo que dispara un re-render en cascada innecesario. El
    // `setTimeout(0)` corta esa cadena síncrona (deja que termine el
    // commit actual antes de arrancar el pedido); no es un workaround
    // arbitrario, es la forma mínima de separar "reaccionar a que cambió
    // authStatus" de "actualizar estado ya mismo, en el mismo tick".
    const timeoutId = setTimeout(() => void fetchMember(), 0);
    return () => clearTimeout(timeoutId);
  }, [authStatus, fetchMember]);

  // Aplica tema + acento apenas se conocen las preferencias reales (al
  // iniciar sesión y al recargar con sesión activa). La página de
  // Configuración además aplica en vivo por su cuenta mientras el usuario
  // elige colores; este efecto es el responsable del estado "de entrada".
  useEffect(() => {
    if (!member) return;
    applyTheme(member.tema);
    applyAccentColor(member.colorAcento);
    writeCachedThemePreference({ tema: member.tema, colorAcento: member.colorAcento });
  }, [member]);

  const updateLocalPreferences = useCallback((patch: Partial<Pick<MemberInfo, 'tema' | 'colorAcento'>>) => {
    setMember((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value = useMemo<MemberContextValue>(
    () => ({ member, status, error, refetch: fetchMember, updateLocalPreferences }),
    [member, status, error, fetchMember, updateLocalPreferences],
  );

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}
