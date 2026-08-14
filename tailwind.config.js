/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#2563EB', 600: '#1D4ED8', 500: '#2563EB', 400: '#3B82F6', 50: '#EFF6FF', 100: '#DBEAFE' },
        success: { DEFAULT: '#10B981', 600: '#059669', 50: '#ECFDF5' },
        warning: { DEFAULT: '#F59E0B', 600: '#D97706', 50: '#FFFBEB' },
        danger:  { DEFAULT: '#E11D48', 600: '#BE123C', 50: '#FFF1F2' },
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface2) / <alpha-value>)',
        ink:     'rgb(var(--ink) / <alpha-value>)',
        muted:   'rgb(var(--muted) / <alpha-value>)',
      },
      borderRadius: { card: '18px' },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.04), 0 8px 24px -12px rgba(15,23,42,.10)',
        'card-dark': '0 1px 2px rgba(0,0,0,.3), 0 12px 32px -16px rgba(0,0,0,.55)',
        soft: '0 4px 16px -4px rgba(79,70,229,.18)',
        glow: '0 0 0 4px rgba(79,70,229,.12)',
      },
      fontFamily: {
        // The self-hosted @fontsource-variable packages register the families as
        // "… Variable" (see src/index.css). The bare names are kept as fallbacks
        // so a locally-installed Inter/Space Grotesk still works.
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', '"Inter Variable"', 'Inter', 'sans-serif'],
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(16px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pop-in': {
          '0%': { opacity: '0', transform: 'perspective(900px) translateY(28px) rotateX(12deg) scale(.94)' },
          '100%': { opacity: '1', transform: 'perspective(900px) translateY(0) rotateX(0) scale(1)' },
        },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: {
        rise: 'rise .5s cubic-bezier(.16,1,.3,1) backwards',
        'pop-in': 'pop-in .6s cubic-bezier(.16,1,.3,1) backwards',
        'slide-in-right': 'slide-in-right .3s cubic-bezier(.16,1,.3,1)',
      },
    },
  },
  plugins: [],
};
