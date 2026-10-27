import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';
import {
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  applyAccentColor,
  applyTheme,
  hexToHslTriplet,
  resetAccentColor,
} from '@/lib/theme';
import { clearCachedThemePreference, writeCachedThemePreference } from '@/lib/theme-cache';
import { useAuth } from '@/features/auth/use-auth';
import { NETWORK_ERROR_MESSAGE } from '@/features/auth/auth-errors';
import { guardarTourVistoLocal, leerTourVistoLocal, limpiarTourVistoLocal, normalizarVersion } from '@/features/ayuda/tour-version';
import type { Enums } from '@/lib/database.types';
import { isUuid } from '@/lib/uuid';
import { MemberContext, type MemberContextValue, type MemberInfo, type MemberStatus } from './member-context';

/** Columnas de la ÚNICA lectura de `miembros` al arrancar (el camión activo y la versión del recorrido viajan acá: no hay un pedido aparte). */
const MEMBER_COLUMNS =
  'rol, tema, color_acento, transportista_id, camion_activo_id, tour_version_vista, transportistas(nombre)' as const;

interface RawMemberRow {
  rol: Enums<'rol_miembro'>;
  tema: string;
  color_acento: string;
  transportista_id: string;
  /** `unknown` y opcional a propósito: se valida acá (uuid o nada) y una fila sin la columna se lee como "ninguno". */
  camion_activo_id?: unknown;
  /** Idem: sin la columna, o con cualquier cosa rara, se lee como 0 ("nunca lo vio"). */
  tour_version_vista?: unknown;
  transportistas: { nombre: string } | null;
}

/** El camión activo tal como se guarda en el estado: un uuid válido (en minúsculas, como los ids de la lista) o `null`. */
function normalizeCamionActivoId(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function normalizeMember(row: RawMemberRow): MemberInfo {
  return {
    rol: row.rol,
    tema: row.tema === 'light' ? 'light' : 'dark',
    colorAcento: hexToHslTriplet(row.color_acento) ? row.color_acento : DEFAULT_ACCENT,
    transportistaId: row.transportista_id,
    transportistaNombre: row.transportistas?.nombre ?? '',
    camionActivoId: normalizeCamionActivoId(row.camion_activo_id),
    tourVersionVista: normalizarVersion(row.tour_version_vista),
  };
}

export function MemberProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const userId = user?.id ?? null;

  const [member, setMember] = useState<MemberInfo | null>(null);
  const [status, setStatus] = useState<MemberStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // A qué usuario pertenece `member`/`status`/`error`. Si el usuario cambia
  // (otra pestaña entra con otra cuenta SIN pasar por "sin sesión"), lo del
  // anterior se descarta en ESTE MISMO render, antes de que lo vea cualquier
  // pantalla: si no, durante un tick se mostraría el transportista (nombre,
  // rol, `transportista_id` de las query keys) del usuario anterior con la
  // sesión del nuevo, y si el pedido del nuevo fallara, se quedaría ahí. Es el
  // patrón "ajustar estado durante el render" de React (un setState
  // condicional al propio estado): React descarta este pasaje y renderiza de
  // nuevo enseguida, sin mostrar el estado viejo.
  const [ownerId, setOwnerId] = useState<string | null>(null);
  if (ownerId !== userId) {
    setOwnerId(userId);
    setMember(null);
    setStatus(userId ? 'loading' : 'idle');
    setError(null);
  }

  // Número del último pedido de miembro y usuario vigente. Una respuesta vieja
  // (de otro usuario, o de un reintento anterior) nunca debe pisar al estado
  // actual. Se actualizan en un LAYOUT effect (en el mismo commit en que
  // cambia `userId`, antes de que pueda correr cualquier callback asíncrono) y
  // no en un `useEffect` pasivo, que corre después del paint.
  const requestIdRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const previousUserId = currentUserIdRef.current;
    currentUserIdRef.current = userId;
    requestIdRef.current += 1;

    // A -> B sin pasar por "sin sesión": las preferencias visuales de A no
    // pueden quedar aplicadas (y en localStorage) mientras carga B, ni si el
    // pedido de B falla. (Con sesión -> null lo hace AuthProvider.)
    if (previousUserId !== null && userId !== null && previousUserId !== userId) {
      resetAccentColor();
      applyTheme(DEFAULT_THEME);
      clearCachedThemePreference();
      limpiarTourVistoLocal();
    }
  }, [userId]);

  const fetchMember = useCallback(async () => {
    // Un `refetch` guardado de un render anterior (otro usuario) no hace nada.
    if (userId !== currentUserIdRef.current) return;

    const requestId = ++requestIdRef.current;

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
        .select(MEMBER_COLUMNS)
        .eq('user_id', userId)
        .maybeSingle();

      if (requestId !== requestIdRef.current) return;

      if (queryError) {
        setMember(null);
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
      if (requestId !== requestIdRef.current) return;
      setMember(null);
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
  // Depende solo de `tema` y `colorAcento` (no de todo `member`): otros cambios del
  // miembro, como confirmar el nombre de la cuenta, no deben reaplicar el tema con
  // un valor que un guardado de color todavía en vuelo está por reemplazar.
  const temaMiembro = member?.tema;
  const colorAcentoMiembro = member?.colorAcento;
  useEffect(() => {
    if (!temaMiembro || !colorAcentoMiembro) return;
    applyTheme(temaMiembro);
    applyAccentColor(colorAcentoMiembro);
    writeCachedThemePreference({ tema: temaMiembro, colorAcento: colorAcentoMiembro });
  }, [temaMiembro, colorAcentoMiembro]);

  const updateLocalPreferences = useCallback((patch: Partial<Pick<MemberInfo, 'tema' | 'colorAcento'>>) => {
    setMember((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  // Guarda primero LOCAL (así no se vuelve a mostrar aunque la base falle) y después en la base, con `lt` para nunca bajar
  // la versión guardada. El id se fija al arrancar (no el de un render viejo): si para cuando vuelve la respuesta ya cambió
  // el usuario, ni se toca localStorage del nuevo ni se actualiza su `member`. Nunca tira: sin señal, queda la copia local
  // y MemberProvider la reintenta solo al arrancar.
  const marcarTourVisto = useCallback(async (version: number) => {
    const id = currentUserIdRef.current;
    if (!id) return;
    const objetivo = normalizarVersion(version);
    guardarTourVistoLocal(id, objetivo);
    try {
      const { error } = await supabase
        .from('miembros')
        .update({ tour_version_vista: objetivo })
        .eq('user_id', id)
        .lt('tour_version_vista', objetivo);
      if (error) return;
    } catch {
      return;
    }
    if (id !== currentUserIdRef.current) return;
    setMember((prev) => (prev && prev.tourVersionVista < objetivo ? { ...prev, tourVersionVista: objetivo } : prev));
  }, []);

  // Si una escritura anterior de `marcarTourVisto` quedó sin señal, la copia local queda adelante de la base: al arrancar
  // (una vez por usuario+versión, para no insistir en la misma sesión) se reintenta en silencio.
  const reintentadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!member || !userId) return;
    const local = leerTourVistoLocal(userId);
    const versionBase = member.tourVersionVista;
    if (local <= versionBase) return;
    const clave = `${userId}:${local}`;
    if (reintentadoRef.current === clave) return;
    reintentadoRef.current = clave;
    void marcarTourVisto(local);
  }, [member, userId, marcarTourVisto]);

  // Update funcional: la comparación de tenant se hace contra el estado MÁS
  // RECIENTE (`prev`), no contra el de un render viejo. Así, si mientras volvía
  // la respuesta de la base cambió el usuario o el tenant (`member` pasó a
  // `null` o a otro `transportistaId`), el nombre no se escribe en el miembro
  // equivocado. Si el nombre ya es el mismo devuelve `prev` tal cual: no hay
  // re-render ni se vuelve a correr el efecto que aplica el tema.
  const updateLocalTransportistaNombre = useCallback((transportistaId: string, nombre: string) => {
    setMember((prev) =>
      prev && prev.transportistaId === transportistaId && prev.transportistaNombre !== nombre
        ? { ...prev, transportistaNombre: nombre }
        : prev,
    );
  }, []);

  // Igual que el nombre: contra el estado más reciente (`prev`), solo en el miembro de ESE transportista y sin tocar nada si
  // el valor ya es el mismo. Normaliza igual que la lectura (uuid en minúsculas o `null`).
  const updateLocalCamionActivo = useCallback((transportistaId: string, camionId: string | null) => {
    const normalizado = normalizeCamionActivoId(camionId);
    setMember((prev) =>
      prev && prev.transportistaId === transportistaId && prev.camionActivoId !== normalizado
        ? { ...prev, camionActivoId: normalizado }
        : prev,
    );
  }, []);

  const value = useMemo<MemberContextValue>(
    () => ({
      member,
      status,
      error,
      refetch: fetchMember,
      updateLocalPreferences,
      updateLocalTransportistaNombre,
      updateLocalCamionActivo,
      marcarTourVisto,
    }),
    [
      member,
      status,
      error,
      fetchMember,
      updateLocalPreferences,
      updateLocalTransportistaNombre,
      updateLocalCamionActivo,
      marcarTourVisto,
    ],
  );

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}
