import { WifiOff } from 'lucide-react';

import { useOnlineStatus } from '@/lib/use-online-status';

/** Aviso liviano de "sin señal" para formularios. No bloquea el
 *  envío (podría reconectarse justo al tocar el botón): solo avisa. */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-base text-muted-foreground"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <span>Sin señal. Revisa la conexión antes de guardar.</span>
    </div>
  );
}
