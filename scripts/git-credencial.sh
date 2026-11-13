#!/bin/sh
# git pregunta aquí la clave de GitHub; se le da la que guardaste dentro de LJtex:
# primero la del Llavero de macOS (donde LJtex la guarda ahora) y, si no está, la del archivo viejo ~/.ljtex/github.json.
# Así no hay que escribir contraseñas, y si cambias la clave en LJtex, git usa la nueva.
[ "$1" = get ] || exit 0
cat > /dev/null
D=$(cd "$(dirname "$0")/.." && pwd)
exec node -e '
let t = null;
try { t = require(process.argv[1] + "/ghtoken.cjs").get(true); } catch {}
if (!t) { try { t = require(require("os").homedir() + "/.ljtex/github.json").token; } catch {} }
if (!t) process.exit(1);
process.stdout.write("username=x-access-token\npassword=" + t + "\n");' "$D"
