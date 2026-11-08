// Dónde vive la clave de GitHub: en el Llavero de macOS (cifrada, como las contraseñas de Safari).
// Fuera de macOS (Linux, Docker) o si el Llavero no responde, se queda en ~/.ljtex/github.json como antes.
// Se usa la herramienta «security» de macOS, que funciona igual desde el servidor de LJtex y desde la app.
const {execFileSync} = require("child_process");

const SERVICE = "LJtex GitHub", ACCOUNT = "ljtex";
const available = (process.platform === "darwin" || process.env.LJTEX_KEYCHAIN_TEST === "1") && !process.env.LJTEX_NO_KEYCHAIN;   // LJTEX_KEYCHAIN_TEST: solo para las pruebas
let cache;   // undefined = sin leer todavía

function get(fresh = false) {
  if (!available) return null;
  if (fresh) cache = undefined;
  if (cache !== undefined) return cache;
  try {
    cache = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
      {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000}).trim() || null;
  } catch { cache = null; }
  return cache;
}

// La clave se pasa por la entrada estándar de «security -i», no como argumento (así no aparece en la lista de procesos)
function set(token) {
  if (!available || !/^[A-Za-z0-9_]{20,255}$/.test(String(token || ""))) return false;
  if (get() === token) return true;
  try {
    execFileSync("security", ["-i"], {input: `add-generic-password -U -s "${SERVICE}" -a "${ACCOUNT}" -l "LJtex (GitHub)" -j "Clave con la que LJtex sincroniza tus proyectos con GitHub" -w "${token}"\n`,
      stdio: ["pipe", "ignore", "ignore"], timeout: 10000});
  } catch { cache = undefined; return false; }
  cache = undefined;
  return get() === token;
}

function remove() {
  cache = null;
  if (!available) return;
  try { execFileSync("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT], {stdio: "ignore", timeout: 10000}); } catch {}
}

module.exports = {available, get, set, remove};
