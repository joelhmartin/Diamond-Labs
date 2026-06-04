/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#F4F9FB",
          100: "#E3F1F7",
          200: "#C2E6F4",
          300: "#9DD8F1",
          400: "#65C7F1",
          500: "#13AEEF",
          600: "#1393C9",
          700: "#13739B",
          800: "#115673",
          900: "#0D384A",
          950: "#0A242E",
        },
        accent: {
          400: "#fbb94d",
          500: "#F79D1E",
          600: "#d9850a",
        },
        surface: {
          50: "#FFFFFF",
          100: "#F7F7F5",
          200: "#EEEDE9",
          300: "#E2E0DB",
          400: "#D1CFC8",
        },
        navy: {
          DEFAULT: "#0B1A2E",
          light: "#132844",
          dark: "#060d17",
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        heading: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        drama: ['"Cormorant Garamond"', "Georgia", "serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
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
