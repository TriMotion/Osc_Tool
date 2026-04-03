import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#1a1a2e",
          light: "#222244",
          lighter: "#2a2a4a",
        },
        accent: {
          DEFAULT: "#00d4aa",
          dim: "#00a080",
        },
      },
    },
  },
  plugins: [],
};

export default config;
