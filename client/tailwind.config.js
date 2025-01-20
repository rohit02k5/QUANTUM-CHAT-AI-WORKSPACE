/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}", // Include all JS/TS/JSX/TSX files in src folder
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg-color)', // Use CSS variables with Tailwind
        text: 'var(--text-color)',
      },
    }, // You can customize themes here
  },
  plugins: [],
};

