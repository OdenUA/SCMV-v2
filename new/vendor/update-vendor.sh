#!/usr/bin/env bash
# Обновление vendor-ассетов (запуск из корня new/, например в Git Bash: bash vendor/update-vendor.sh).
# Версии зафиксированы — при обновлении меняйте URL и пересобирайте Tailwind (команда в tailwind.config.js).
set -euo pipefail
cd "$(dirname "$0")"

FA=https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0
L=https://unpkg.com/leaflet@1.9.4/dist

mkdir -p fontawesome/css fontawesome/webfonts leaflet/images leaflet-polylinedecorator chart.js xlsx tailwind

curl -fsSL "$FA/css/all.min.css" -o fontawesome/css/all.min.css
for f in fa-brands-400.woff2 fa-brands-400.ttf fa-regular-400.woff2 fa-regular-400.ttf fa-solid-900.woff2 fa-solid-900.ttf fa-v4compatibility.woff2 fa-v4compatibility.ttf; do
  curl -fsSL "$FA/webfonts/$f" -o "fontawesome/webfonts/$f"
done

curl -fsSL "$L/leaflet.css" -o leaflet/leaflet.css
curl -fsSL "$L/leaflet.js" -o leaflet/leaflet.js
for f in layers.png layers-2x.png marker-icon.png marker-icon-2x.png marker-shadow.png; do
  curl -fsSL "$L/images/$f" -o "leaflet/images/$f"
done

curl -fsSL "https://unpkg.com/leaflet-polylinedecorator@1.6.0/dist/leaflet.polylineDecorator.js" -o leaflet-polylinedecorator/leaflet.polylineDecorator.js
curl -fsSL "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js" -o chart.js/chart.umd.min.js
curl -fsSL "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" -o xlsx/xlsx.full.min.js

# Tailwind: tools/tailwindcss.exe (standalone CLI v3.4.17, в git не входит) — скачать при необходимости:
#   curl -fsSL -o tools/tailwindcss.exe https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.17/tailwindcss-windows-x64.exe
../tools/tailwindcss.exe -c ../tailwind.config.js -i tailwind/input.css -o tailwind/app.css --minify

echo "vendor updated"
