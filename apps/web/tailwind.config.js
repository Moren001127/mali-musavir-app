/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0A1628',
          800: '#122040',
          700: '#1E2D4E',
          600: '#253660',
          500: '#2D4470',
          400: '#3D5A8A',
          300: '#5272A8',
          200: '#8BA4CC',
          100: '#C8D5E8',
          50:  '#EEF2F7',
        },
        gold: {
          DEFAULT: '#C9982A',
          light: '#E8B84B',
          pale:  '#FBF0D6',
          dark:  '#A77819',
        },
        surface: '#FFFFFF',
        border:  '#DDE3ED',
      },
      fontFamily: {
        sans:    ['DM Sans', 'system-ui', 'sans-serif'],
        heading: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono:    ['DM Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', '14px'],
      },
      boxShadow: {
        xs:  '0 1px 2px rgba(10,22,40,.06)',
        sm:  '0 1px 4px rgba(10,22,40,.08), 0 0 0 1px rgba(10,22,40,.04)',
        md:  '0 4px 12px rgba(10,22,40,.10), 0 1px 3px rgba(10,22,40,.06)',
        lg:  '0 8px 24px rgba(10,22,40,.14), 0 2px 6px rgba(10,22,40,.08)',
        xl:  '0 16px 48px rgba(10,22,40,.18), 0 4px 12px rgba(10,22,40,.10)',
        gold: '0 4px 16px rgba(201,152,42,.30)',
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '10px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
      },
      animation: {
        'fade-up': 'fadeUp 0.35s ease forwards',
        shimmer:   'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
};
