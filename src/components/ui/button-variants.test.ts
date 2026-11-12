import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';
import { buttonVariants } from './button-variants';

/** Las clases como las arma `Button` (con el merge de Tailwind: ahí `text-lg` pisa al `text-base` de la base). */
const clasesDe = (size: 'default' | 'sm' | 'lg' | 'icon') => cn(buttonVariants({ size }));

describe('buttonVariants', () => {
  it('el texto de los botones normales es de 16 px (text-base) y el de los grandes de 18 px (text-lg)', () => {
    for (const size of ['default', 'sm', 'icon'] as const) {
      expect(clasesDe(size), size).toContain('text-base');
      expect(clasesDe(size), size).not.toMatch(/\btext-(xs|sm)\b/);
    }
    expect(clasesDe('lg')).toContain('text-lg');
    expect(clasesDe('lg')).not.toContain('text-base');
  });

  it('ningún tamaño baja del piso táctil de 48 px (la variante compacta "sm" incluida: más angosta, no más baja)', () => {
    expect(clasesDe('default')).toContain('h-12');
    expect(clasesDe('sm')).toContain('h-12');
    expect(clasesDe('icon')).toMatch(/h-12 w-12/);
    expect(clasesDe('lg')).toContain('h-14');
    for (const size of ['default', 'sm', 'lg', 'icon'] as const) {
      expect(clasesDe(size), size).not.toMatch(/\bh-(8|9|10|11)\b/);
    }
  });

  it('"sm" es más angosta que la normal (px-3 contra px-4)', () => {
    expect(clasesDe('sm')).toContain('px-3');
    expect(clasesDe('default')).toContain('px-4');
  });
});
