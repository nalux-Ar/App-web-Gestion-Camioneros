import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Variante `destructive`: el texto usa `--destructive-text` (más claro que
 * `--destructive`), no `--destructive` a secas. `--destructive` está
 * calibrado para texto/ícono sobre botón (fondo sólido) y como borde/ícono
 * sobre fondo oscuro da ~4.1:1 como texto chico, por debajo de AA (4.5:1).
 * Ver src/index.css.
 *
 * `data-accent-emphasis="destructive"` es el enganche para el tratamiento
 * extra cuando el acento elegido por el usuario se parece al rojo (ver
 * `applyAccentColor` en src/lib/theme.ts y la regla en src/index.css):
 * un contorno adicional para no depender solo del matiz de color.
 */
const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive: 'border-destructive/50 bg-destructive/10 text-destructive-text [&>svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface AlertProps extends React.ComponentProps<'div'>, VariantProps<typeof alertVariants> {}

function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      data-accent-emphasis={variant === 'destructive' ? 'destructive' : undefined}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'h5'>) {
  return (
    <h5
      data-slot="alert-title"
      className={cn('mb-1 font-medium leading-none tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-description" className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription };
