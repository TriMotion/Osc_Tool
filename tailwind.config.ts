import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // New surface system
        panel: "#0a0a0a",
        elevated: "#111111",

        // Domain accents
        input: {
          DEFAULT: "#00ff8c",
          dim: "#00cc70",
        },
        output: {
          DEFAULT: "#f59e0b",
          dim: "#d97706",
        },
        deck: {
          DEFAULT: "#b91c1c",
          dim: "#991b1b",
        },
        timeline: {
          DEFAULT: "#4488ff",
          dim: "#3366cc",
        },
        diag: {
          DEFAULT: "#555555",
          dim: "#444444",
        },

        // Semantic status
        success: "#22c55e",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#888888",
      },
    },
  },
  plugins: [],
};

export default config;
