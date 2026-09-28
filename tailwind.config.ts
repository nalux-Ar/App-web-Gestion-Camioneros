import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // Formato `hsl(var(--x) / <alpha-value>)`: las variables se guardan
        // como triplete HSL "suelto" (sin wrapper), lo que le permite a
        // Tailwind inyectar el canal alfa cuando se usan modificadores de
        // opacidad (`bg-destructive/10`, `border-primary/40`, etc.). Sin
        // este formato esos modificadores quedan como no-op silencioso.
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
          // Texto de error sobre fondo (no sobre botón): más claro que
          // DEFAULT para cumplir AA en modo oscuro. Ver src/index.css.
          text: 'hsl(var(--destructive-text) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        // Tokens fijos de marca: dorado metálico para wordmark/login.
        // No son personalizables por el usuario (a diferencia de --primary).
        'brand-gold': {
          100: 'hsl(var(--brand-gold-100) / <alpha-value>)',
          300: 'hsl(var(--brand-gold-300) / <alpha-value>)',
          500: 'hsl(var(--brand-gold-500) / <alpha-value>)',
          700: 'hsl(var(--brand-gold-700) / <alpha-value>)',
        },
        // Placa fija (casi negra, con borde dorado sutil) para el logo:
        // el logo tiene fondo negro sólido, así que la placa no cambia con
        // el modo claro/oscuro ni con el acento. Ver AuthShell y Header.
        'brand-plate': 'hsl(var(--brand-plate) / <alpha-value>)',
        'brand-plate-border': 'hsl(var(--brand-plate-border) / <alpha-value>)',
        'brand-plate-foreground': 'hsl(var(--brand-plate-foreground) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      minHeight: {
        dvh: '100dvh',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
