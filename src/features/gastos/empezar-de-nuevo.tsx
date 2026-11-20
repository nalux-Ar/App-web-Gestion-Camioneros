import { useEffect, useId, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  CANCELAR_EMPEZAR_DE_NUEVO,
  CONFIRMAR_EMPEZAR_DE_NUEVO,
  EMPEZAR_DE_NUEVO,
  PREGUNTA_EMPEZAR_DE_NUEVO,
} from './gasto-varios-textos';

interface EmpezarDeNuevoProps {
  /** Lo que se hace al confirmar (el reinicio de «Nuevo gasto»). No hace falta que sea asíncrono. */
  onConfirmar: () => void;
  /** Sin poder tocar nada (por ejemplo, mientras se guarda). */
  deshabilitado?: boolean;
}

/**
 * La salida de «Nuevo gasto» después de un intento de guardar que no terminó bien: «Empezar de nuevo» en DOS toques (sin ventana
 * aparte, como `ConfirmDelete`), porque lo que ya se intentó guardar pudo haber llegado, y empezar de nuevo y guardar otra vez puede
 * terminar repitiendo gastos.
 *
 *   [Empezar de nuevo]  →  «Antes de empezar de nuevo, revisa la lista de Gastos…»  [Sí, empezar de nuevo] [Cancelar]
 *
 * Foco: al pedir la confirmación pasa a «Cancelar» (la opción segura) y al cancelar vuelve a «Empezar de nuevo». Al confirmar,
 * quien usa el componente lleva el foco a donde corresponda (el grupo de categorías).
 */
export function EmpezarDeNuevo({ onConfirmar, deshabilitado = false }: EmpezarDeNuevoProps) {
  const [confirmando, setConfirmando] = useState(false);
  const preguntaId = useId();
  const pedirRef = useRef<HTMLButtonElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const veniaConfirmando = useRef(false);

  useEffect(() => {
    if (confirmando) cancelarRef.current?.focus();
    else if (veniaConfirmando.current) pedirRef.current?.focus();
    veniaConfirmando.current = confirmando;
  }, [confirmando]);

  if (!confirmando) {
    return (
      <Button
        ref={pedirRef}
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        disabled={deshabilitado}
        onClick={() => setConfirmando(true)}
      >
        <RotateCcw aria-hidden="true" /> {EMPEZAR_DE_NUEVO}
      </Button>
    );
  }

  return (
    <div role="group" aria-labelledby={preguntaId} className="space-y-3 rounded-lg border border-border bg-card p-3">
      <p id={preguntaId} className="text-base font-medium">
        {PREGUNTA_EMPEZAR_DE_NUEVO}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          // Con un texto largo el botón crece en alto (mínimo 48 px) en vez de cortarlo en un celular angosto.
          className="h-auto min-h-12 whitespace-normal py-2 text-center"
          disabled={deshabilitado}
          onClick={() => {
            setConfirmando(false);
            onConfirmar();
          }}
        >
          {CONFIRMAR_EMPEZAR_DE_NUEVO}
        </Button>
        <Button ref={cancelarRef} type="button" variant="outline" disabled={deshabilitado} onClick={() => setConfirmando(false)}>
          {CANCELAR_EMPEZAR_DE_NUEVO}
        </Button>
      </div>
    </div>
  );
}
