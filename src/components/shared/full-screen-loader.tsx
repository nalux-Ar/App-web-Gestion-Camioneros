import { Spinner } from './spinner';

interface FullScreenLoaderProps {
  label?: string;
}

/** Loader de pantalla completa para los estados "todavía no sabemos si hay
 *  sesión / si el usuario tiene un transportista" de los guards de ruta. */
export function FullScreenLoader({ label = 'Cargando…' }: FullScreenLoaderProps) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-foreground"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-8 text-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
