import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

function requireEnv(name: keyof ImportMetaEnv, value: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Falta la variable de entorno ${name}. Revisá .env.local (ver .env.example).`);
  }
  return value;
}

const SUPABASE_URL = requireEnv('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_PUBLISHABLE_KEY = requireEnv(
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return atob(padded);
}

/**
 * Nunca debe llegar al bundle del cliente una key con privilegios de
 * `service_role` (bypassa RLS por completo). Rechaza tanto el formato nuevo
 * de Supabase (prefijo `sb_secret_`) como el formato JWT legado con
 * `role: "service_role"` en el payload.
 *
 * Esto NO es una defensa contra un atacante que edite el bundle ya
 * publicado (en ese punto la key ya está expuesta): es un chequeo de "no
 * me equivoqué de variable de entorno" que falla rápido y ruidoso al
 * arrancar la app en vez de exponer silenciosamente una key con
 * privilegios totales.
 */
function isLikelySecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;

  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(base64UrlDecode(parts[1])) as { role?: unknown };
      if (payload.role === 'service_role') return true;
    } catch {
      // No es un JWT parseable (o el payload no es JSON válido): no lo
      // tratamos como secreto solo por eso, puede ser una publishable key
      // nueva (sb_publishable_...) que no tiene forma de JWT.
    }
  }

  return false;
}

if (isLikelySecretKey(SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error(
    'VITE_SUPABASE_PUBLISHABLE_KEY parece una key con privilegios de servicio (service_role). ' +
      'Nunca debe usarse en el frontend: usá la publishable key (prefijo sb_publishable_), nunca la service_role.',
  );
}

/**
 * Flujo de autenticación: IMPLÍCITO, no PKCE (decisión tomada — Bloque B).
 * Sigue siendo implícito después de la auditoría de seguridad; lo único
 * que cambió es quién procesa el fragmento de la URL (ver más abajo).
 *
 * Motivo: el camionero suele pedir "olvidé mi contraseña" desde el
 * navegador del celular y abrir el link del mail en otra app o navegador
 * (el cliente de correo tiene su propio WebView, o el pedido se hizo desde
 * un navegador y el link se abre en otro). Con PKCE, el "code verifier"
 * queda guardado únicamente en el storage del navegador/pestaña que
 * INICIÓ el pedido; si el link se abre en otro contexto (lo más común acá),
 * el intercambio de código falla con "code verifier not found" y el
 * usuario queda trabado sin poder elegir una contraseña nueva. El flujo
 * implícito no tiene ese problema: el token de sesión viaja en el propio
 * link (hash de la URL) y no depende de storage previo en ese navegador.
 *
 * `detectSessionInUrl: false`: el procesamiento del fragmento
 * `#access_token=...` NO lo hace supabase-js solo. Lo hace
 * `src/lib/process-auth-hash.ts`, a mano, antes de montar la app. Motivo:
 * la limpieza de hash de supabase-js (`location.hash = ''`) agrega una
 * entrada nueva al historial del navegador y deja los tokens accesibles
 * apretando "atrás"; nuestro `processAuthHash` usa `history.replaceState`
 * (no agrega entrada) antes de leer/usar los tokens. Ver ese archivo.
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
});
