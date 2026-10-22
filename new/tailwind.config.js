// Конфиг сборки Tailwind (v3) — заменяет инлайн-конфиг cdn.tailwindcss.com.
// Пересборка: tools/tailwindcss.exe -c tailwind.config.js -i vendor/tailwind/input.css -o vendor/tailwind/app.css --minify
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./*.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 900: '#1e3a8a' },
        darkbg: { 900: '#0b0f17', 800: '#111827', 700: '#1f2937', 600: '#374151' },
      },
    },
  },
  plugins: [],
};
