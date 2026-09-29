import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Moon, RotateCcw, Sun } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OfflineBanner } from '@/components/shared/offline-banner';
import { Spinner } from '@/components/shared/spinner';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  applyAccentColor,
  applyTheme,
  hexToHslTriplet,
  isAccentTooCloseToDestructive,
  type ThemeMode,
} from '@/lib/theme';
import { writeCachedThemePreference } from '@/lib/theme-cache';
import { useAuth } from '@/features/auth/use-auth';
import { useMember } from '@/features/member/use-member';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// El color picker dispara un evento por cada frame mientras se arrastra:
// sin debounce, cada arrastre sería decenas de UPDATE a la base.
const SAVE_DEBOUNCE_MS = 500;

export function ConfiguracionPage() {
  const { user } = useAuth();
  const { member, updateLocalPreferences } = useMember();

  const [tema, setTema] = useState<ThemeMode>(member?.tema ?? DEFAULT_THEME);
  const [appliedColor, setAppliedColor] = useState<string>(member?.colorAcento ?? DEFAULT_ACCENT);
  const [hexDraft, setHexDraft] = useState<string>(appliedColor);
  const [hexError, setHexError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveTimeoutRef = useRef<number | null>(null);
  const pendingRef = useRef<{ tema: ThemeMode; colorAcento: string } | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const persist = useCallback(
    async (nextTema: ThemeMode, nextColor: string) => {
      if (!user) {
        setSaveState('error');
        setSaveError('Tu sesión venció. Vuelve a ingresar.');
        return;
      }

      setSaveState('saving');
      setSaveError(null);

      const { error } = await supabase
        .from('miembros')
        .update({ tema: nextTema, color_acento: nextColor })
        .eq('user_id', user.id);

      if (error) {
        setSaveState('error');
        setSaveError('No pudimos guardar el cambio. Prueba de nuevo.');
        return;
      }

      updateLocalPreferences({ tema: nextTema, colorAcento: nextColor });
      writeCachedThemePreference({ tema: nextTema, colorAcento: nextColor });
      setSaveState('saved');
    },
    [user, updateLocalPreferences],
  );

  const scheduleSave = useCallback(
    (nextTema: ThemeMode, nextColor: string) => {
      pendingRef.current = { tema: nextTema, colorAcento: nextColor };
      if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = window.setTimeout(() => {
        const pending = pendingRef.current;
        if (pending) void persist(pending.tema, pending.colorAcento);
      }, SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  function handleTemaChange(next: ThemeMode) {
    if (next === tema) return;
    setTema(next);
    applyTheme(next);
    scheduleSave(next, appliedColor);
  }

  function applyValidColor(hex: string) {
    setAppliedColor(hex);
    setHexDraft(hex);
    setHexError(null);
    applyAccentColor(hex);
    scheduleSave(tema, hex);
  }

  function handleHexDraftChange(raw: string) {
    setHexDraft(raw);
    // Tolerar que tipeen el hex sin el "#" (bastante común): se completa
    // antes de validar, nunca cambia qué formato se acepta.
    let normalized = raw.trim();
    if (normalized.length > 0 && !normalized.startsWith('#')) {
      normalized = `#${normalized}`;
    }
    if (!hexToHslTriplet(normalized)) {
      setHexError('Formato inválido. Usa #RRGGBB (6 dígitos, 0-9 y A-F).');
      return;
    }
    applyValidColor(normalized);
  }

  function handleRetry() {
    void persist(tema, appliedColor);
  }

  const accentTooCloseToError = !hexError && isAccentTooCloseToDestructive(appliedColor);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="text-muted-foreground">Elige cómo se ve la app para ti.</p>
      </div>

      <OfflineBanner />

      <Card>
        <CardHeader>
          <CardTitle>Tema</CardTitle>
          <CardDescription>Oscuro cansa menos la vista de noche o con poca luz.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Dos botones toggle independientes (aria-pressed), no un
              radiogroup: con solo 2 opciones, un radiogroup "de manual"
              pediría manejo de flechas de teclado para ser correcto del
              todo. Con aria-pressed cada botón es tabulable y anunciable
              por su cuenta, sin JS extra, y el resultado visual es el
              mismo (dos botones grandes con el activo bien marcado). */}
          <div aria-label="Tema" className="grid grid-cols-2 gap-3">
            <button
              type="button"
              aria-pressed={tema === 'dark'}
              onClick={() => handleTemaChange('dark')}
              className={cn(
                'flex min-h-14 items-center justify-center gap-2 rounded-md border-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                tema === 'dark'
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Moon className="size-5" aria-hidden="true" /> Oscuro
            </button>
            <button
              type="button"
              aria-pressed={tema === 'light'}
              onClick={() => handleTemaChange('light')}
              className={cn(
                'flex min-h-14 items-center justify-center gap-2 rounded-md border-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                tema === 'light'
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Sun className="size-5" aria-hidden="true" /> Claro
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Color de acento</CardTitle>
          <CardDescription>El color de los botones principales y los detalles de la app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="h-12 w-12 shrink-0 rounded-md border-2 border-border"
              style={{ backgroundColor: appliedColor }}
            />
            <input
              type="color"
              aria-label="Elegir color de acento"
              value={appliedColor}
              onChange={(event) => applyValidColor(event.target.value)}
              className="h-12 w-16 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
            />
            <div className="flex-1 space-y-1">
              <Label htmlFor="color-acento-hex" className="sr-only">
                Código de color (hex)
              </Label>
              <Input
                id="color-acento-hex"
                value={hexDraft}
                onChange={(event) => handleHexDraftChange(event.target.value)}
                placeholder="#F59E0B"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={hexError !== null}
                aria-describedby={hexError ? 'color-acento-hex-error' : undefined}
              />
            </div>
          </div>
          {hexError ? (
            <p id="color-acento-hex-error" role="alert" className="text-sm text-destructive-text">
              {hexError}
            </p>
          ) : null}

          {accentTooCloseToError ? (
            <Alert>
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>
                Este color se parece al rojo que usamos para los avisos de error. Los errores igual se van a
                distinguir (siempre llevan ícono, texto y un contorno extra), pero si prefieres más contraste,
                prueba otro tono.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            variant="outline"
            onClick={() => applyValidColor(DEFAULT_ACCENT)}
            disabled={appliedColor.toUpperCase() === DEFAULT_ACCENT.toUpperCase()}
          >
            <RotateCcw aria-hidden="true" /> Volver al dorado
          </Button>

          <div aria-live="polite" className="min-h-5 text-sm">
            {saveState === 'saving' && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-4" /> Guardando…
              </p>
            )}
            {saveState === 'saved' && <p className="text-muted-foreground">Guardado.</p>}
            {saveState === 'error' && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-destructive-text">{saveError}</p>
                <Button type="button" size="sm" variant="outline" onClick={handleRetry}>
                  Reintentar
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
