#!/bin/bash
# Sube el código de LJtex a su repositorio de GitHub (sirve la primera vez y todas las siguientes).
# Usa la clave que ya guardaste dentro de LJtex: no pide contraseñas.
# Uso:  bash scripts/subir-a-github.sh ["descripción del cambio"]
set -e
cd "$(dirname "$0")/.."
REPO="https://github.com/luisjorgesanchezsaldana/LJtex.git"
git --version > /dev/null 2>&1 || { echo "Falta git. Instálalo con:  xcode-select --install   y vuelve a correr este script."; exit 1; }
{ [ -f "$HOME/.ljtex/github.json" ] || security find-generic-password -s "LJtex GitHub" -a ljtex > /dev/null 2>&1; } || { echo "Primero conecta LJtex con GitHub (botón GitHub dentro de un proyecto)."; exit 1; }
[ -d .git ] || git init -q -b main
git config --unset-all credential.helper > /dev/null 2>&1 || true
git config --add credential.helper ""   # ignora otras claves guardadas en el llavero de la Mac
git config --add credential.helper "!sh '$PWD/scripts/git-credencial.sh'"
git config user.name > /dev/null || git config user.name "Luis Jorge Sánchez Saldaña"
git config user.email > /dev/null || git config user.email "luisjorgesanchezsaldana@users.noreply.github.com"
git remote get-url origin > /dev/null 2>&1 || git remote add origin "$REPO"
git add -A
git diff --cached --quiet || git commit -q -m "${1:-Cambios en LJtex}"
# Si en GitHub hay algo nuevo (de otra Mac), se trae antes de subir
if git ls-remote --exit-code --heads origin main > /dev/null 2>&1 && ! git pull -q --rebase origin main; then
  git rebase --abort > /dev/null 2>&1 || true
  echo "No pude juntar tus cambios con los que hay en GitHub. Tus cambios siguen guardados aquí; pídele ayuda a Claude."
  exit 1
fi
git push -u origin main
echo
echo "Listo: el código está en https://github.com/luisjorgesanchezsaldana/LJtex"
