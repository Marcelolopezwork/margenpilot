import type { Config } from 'tailwindcss';

// Los colores no se definen aquí: viven como variables CSS en src/index.css,
// que es lo que permite el tema claro/oscuro con un solo atributo en <html>.
// Tailwind solo las referencia. Ver docs/UI_UX_PLAN.md §2.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        subtle: 'var(--subtle)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        positive: 'var(--pos)',
        'positive-bg': 'var(--pos-bg)',
        negative: 'var(--neg)',
        'negative-bg': 'var(--neg-bg)',
        warning: 'var(--warn)',
        'warning-bg': 'var(--warn-bg)',
        info: 'var(--info)',
        'info-bg': 'var(--info-bg)',
        neutral: 'var(--neu)',
        'neutral-bg': 'var(--neu-bg)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { control: '6px', card: '10px' },
    },
  },
  plugins: [],
} satisfies Config;
