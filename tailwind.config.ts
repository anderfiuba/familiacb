import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        papel: "#F3F5F2",
        tinta: "#14202B",
        suave: "#5E6B78",
        linha: "#DCE1DC",
        real: { DEFAULT: "#1F8A5B", claro: "#E3F2EA" },
        peso: { DEFAULT: "#2F6FC9", claro: "#E4EDFA" },
        alerta: { DEFAULT: "#B4430E", claro: "#FBEDE4" },
      },
      fontFamily: {
        titulo: ["var(--font-titulo)", "system-ui", "sans-serif"],
        corpo: ["var(--font-corpo)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        painel: "18px",
        campo: "10px",
      },
      keyframes: {
        pulso: {
          "0%": { boxShadow: "0 0 0 0 rgba(47,111,201,.45)" },
          "70%": { boxShadow: "0 0 0 12px rgba(47,111,201,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(47,111,201,0)" },
        },
      },
      animation: {
        pulso: "pulso 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
