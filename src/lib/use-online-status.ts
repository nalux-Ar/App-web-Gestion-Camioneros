import { useEffect, useState } from 'react';

/** Refleja `navigator.onLine` en vivo. Es una señal heurística del
 *  navegador (no garantiza que haya salida a internet real), pero alcanza
 *  para el aviso liviano que pide el proyecto: avisar cuando el celular
 *  claramente no tiene señal/wifi. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    function handleOnline(): void {
      setOnline(true);
    }
    function handleOffline(): void {
      setOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
