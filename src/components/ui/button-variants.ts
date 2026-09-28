import { cva } from 'class-variance-authority';

/**
 * Separado de button.tsx (no es solo estilo): un archivo que exporta un
 * componente junto con un valor que no es componente (como esta función
 * `cva`) rompe el Fast Refresh boundary de Vite
 * (`react-refresh/only-export-components`) y fuerza recargas completas en
 * vez de HMR. Mismo criterio que en features/auth y features/member.
 *
 * Tamaños ≥48px (piso táctil del proyecto: se usa en el celular, en ruta):
 * `default` ya cumple 48px por su cuenta, `lg` es el CTA principal (56px)
 * y `icon` es 48x48. `sm` (40px) queda para acciones secundarias/compactas
 * (p.ej. "Reintentar" al lado de un mensaje de error).
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-12 px-4 py-2',
        sm: 'h-10 rounded-md px-3 text-sm',
        lg: 'h-14 rounded-md px-8 text-base',
        icon: 'h-12 w-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);
