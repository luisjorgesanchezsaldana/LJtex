#!/bin/bash
# Trae a esta carpeta los cambios de LJtex que están en GitHub (hechos en otra Mac o directamente en GitHub).
# Usa la clave que ya guardaste dentro de LJtex: no pide contraseñas.
# Uso:  bash scripts/bajar-de-github.sh
set -e
cd "$(dirname "$0")/.."
git --version > /dev/null 2>&1 || { echo "Falta git. Instálalo con:  xcode-select --install   y vuelve a correr este script."; exit 1; }
[ -d .git ] || { echo "Esta carpeta todavía no está conectada con GitHub. Corre primero:  bash scripts/subir-a-github.sh"; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "Esta carpeta tiene cambios que todavía no están en GitHub:"
  git status --short
  echo
  echo "Súbelos primero con:  bash scripts/subir-a-github.sh \"lo que cambió\""
  echo "(ese script también trae lo nuevo de GitHub, así que con eso basta)."
  exit 1
fi
antes=$(git rev-parse HEAD)
if ! git pull -q --rebase origin main; then
  git rebase --abort > /dev/null 2>&1 || true
  echo "No pude juntar los cambios de GitHub con los de esta carpeta. No se modificó nada; pídele ayuda a Claude."
  exit 1
fi
if [ "$antes" = "$(git rev-parse HEAD)" ]; then echo "Ya estabas al día: no hay nada nuevo en GitHub."; exit 0; fi
echo "Llegaron estos cambios:"
git log --format="  · %s (%an, %ar)" "$antes..HEAD"
if ! git diff --quiet "$antes" HEAD -- package.json package-lock.json; then
  echo; echo "Cambiaron las dependencias; instalándolas…"
  npm install --no-audit --no-fund
fi
echo
echo "Listo. Para usar esta versión en la app, genera el dmg:  npm run dist"
