import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        lotto: {
          gold: "#FFD700",
          green: "#00C896",
          dark: "#0d1117",
          panel: "#161b22",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
