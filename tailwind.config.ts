import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(59, 130, 246)',
        secondary: 'rgb(139, 92, 246)',
        success: 'rgb(34, 197, 94)',
        warning: 'rgb(251, 146, 60)',
        danger: 'rgb(239, 68, 68)',
      },
      borderRadius: {
        '10': '10px',
        '12': '12px',
        '16': '16px',
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
      },
      fontSize: {
        metric: ['3.5rem', { lineHeight: '1', fontWeight: '800' }],
      },
      boxShadow: {
        glow: '0 0 40px rgba(59, 130, 246, 0.1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-in': 'slideIn 0.4s ease-out',
        'glow': 'pulse-glow 2s ease-in-out infinite',
        'pop': 'counter-pop 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  darkMode: ['class', '[data-theme="dark"]'],
  plugins: [],
}
export default config
