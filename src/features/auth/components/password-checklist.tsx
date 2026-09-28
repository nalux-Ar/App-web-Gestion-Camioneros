import { Check, X } from 'lucide-react';

import { PASSWORD_REQUIREMENTS } from '../password';

/** Checklist en vivo de requisitos de contraseña. Nunca depende solo del
 *  color: cada ítem tiene ícono (check/cruz) + texto. La región con
 *  `aria-live` está aparte (visualmente oculta) para no saturar al lector
 *  de pantalla con la lista completa en cada tecla, solo lo que falta. */
export function PasswordChecklist({ password }: { password: string }) {
  const missing = PASSWORD_REQUIREMENTS.filter((requirement) => !requirement.test(password));

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1 text-sm">
        {PASSWORD_REQUIREMENTS.map((requirement) => {
          const met = requirement.test(password);
          return (
            <li key={requirement.id} className="flex items-center gap-2">
              {met ? (
                <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <X className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className={met ? 'text-foreground' : 'text-muted-foreground'}>{requirement.label}</span>
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" className="sr-only">
        {missing.length === 0
          ? 'La contraseña cumple los requisitos.'
          : `Te falta: ${missing.map((requirement) => requirement.label).join(', ')}.`}
      </p>
    </div>
  );
}
