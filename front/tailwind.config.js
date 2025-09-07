/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        space: {
          900: "#0b0f1a",
          800: "#0f1422",
          700: "#141a2a",
          600: "#1b2236",
          500: "#232c45",
        },
        accent: {
          green: "#22c55e",
          blue: "#60a5fa",
          orange: "#fb923c",
          red: "#ef4444",
        },
      },
      boxShadow: {
        glow: "0 0 0.75rem rgba(96,165,250,0.25)",
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
