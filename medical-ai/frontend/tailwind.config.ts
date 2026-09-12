import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        clinic: {
          bg: "#f4f7f6",
          primary: "#0f766e",
          primaryDark: "#0b5a54",
          accent: "#2563eb",
          warn: "#b45309",
          danger: "#b91c1c",
        },
      },
    },
  },
  plugins: [],
};

export default config;
