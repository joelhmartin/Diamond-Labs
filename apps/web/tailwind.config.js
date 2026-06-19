/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
          950: "rgb(var(--brand-950) / <alpha-value>)",
        },
        accent: {
          400: "rgb(var(--accent-400) / <alpha-value>)",
          500: "rgb(var(--accent-500) / <alpha-value>)",
          600: "rgb(var(--accent-600) / <alpha-value>)",
        },
        surface: {
          50: "rgb(var(--surface-50) / <alpha-value>)",
          100: "rgb(var(--surface-100) / <alpha-value>)",
          200: "rgb(var(--surface-200) / <alpha-value>)",
          300: "rgb(var(--surface-300) / <alpha-value>)",
          400: "rgb(var(--surface-400) / <alpha-value>)",
        },
        navy: {
          DEFAULT: "rgb(var(--navy) / <alpha-value>)",
          light: "rgb(var(--navy-light) / <alpha-value>)",
          dark: "rgb(var(--navy-dark) / <alpha-value>)",
        },
        "on-dark": "rgb(var(--text-on-dark) / <alpha-value>)",
        "accent-on-dark": "rgb(var(--accent-on-dark) / <alpha-value>)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        heading: "var(--font-heading)",
        drama: "var(--font-drama)",
        mono: "var(--font-mono)",
      },
      borderRadius: {
        "2xl": "1.5rem",
        "3xl": "2rem",
        "4xl": "3rem",
        "5xl": "4rem",
      },
      maxWidth: {
        "6xl": "1440px",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float-1": "float-1 8s ease-in-out infinite",
        "float-2": "float-2 10s ease-in-out infinite",
        "float-3": "float-3 12s ease-in-out infinite",
      },
      keyframes: {
        "float-1": {
          '0%, 100%': { transform: 'translateY(0) rotate(45deg)' },
          '50%': { transform: 'translateY(-20px) rotate(45deg)' },
        },
        "float-2": {
          '0%, 100%': { transform: 'translateY(0) rotate(45deg) scale(1.1)' },
          '50%': { transform: 'translateY(-30px) rotate(45deg) scale(1.1)' },
        },
        "float-3": {
          '0%, 100%': { transform: 'translateY(0) rotate(45deg) scale(0.9)' },
          '50%': { transform: 'translateY(-15px) rotate(45deg) scale(0.9)' },
        }
      }
    },
  },
  plugins: [],
};
