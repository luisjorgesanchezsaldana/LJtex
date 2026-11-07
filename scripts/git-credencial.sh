#!/bin/sh
# git pregunta aquí la clave de GitHub; se le da la que guardaste dentro de LJtex (~/.ljtex/github.json).
# Así no hay que escribir contraseñas, y si cambias la clave en LJtex, git usa la nueva.
[ "$1" = get ] || exit 0
cat > /dev/null
exec node -e 'const c = require(require("os").homedir() + "/.ljtex/github.json"); if (!c.token) process.exit(1); process.stdout.write("username=x-access-token\npassword=" + c.token + "\n");'
