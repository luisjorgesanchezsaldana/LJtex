// Actualizaciones de LJtex sin terminal: busca en los «Releases» del repositorio de LJtex en GitHub un .dmg más nuevo
// que esta app, lo descarga con la clave de GitHub que ya guardaste en LJtex, reemplaza LJtex.app y lo vuelve a abrir.
// Los .dmg los construye la acción .github/workflows/dmg.yml en cada cambio.
const {app, shell} = require("electron");
const {spawn, execFileSync} = require("child_process");
const fs = require("fs");
const {join, dirname} = require("path");
const os = require("os");

const API = "https://api.github.com";
const CONF = process.env.LJTEX_GITHUB_CONF || join(os.homedir(), ".ljtex", "github.json");   // la misma clave que usa github.js
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const pkg = () => readJson(join(app.getAppPath(), "package.json")) || {};
const repo = () => pkg().ljtexRepo || "luisjorgesanchezsaldana/LJtex";
const current = () => readJson(join(app.getAppPath(), "build-info.json"));
const fail = (msg, extra = {}) => Object.assign(new Error(msg), extra);
// Bitácora y resultado de la última actualización (el script de reemplazo escribe aquí después de que LJtex se cierra)
const DIR = join(os.homedir(), ".ljtex");
const LOG = join(DIR, "actualizacion.log"), STATUS = join(DIR, "actualizacion.json"), CACHE = join(DIR, "descargas");
const log = msg => { try { fs.mkdirSync(DIR, {recursive: true}); fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch {} };

// Resultado de la última actualización, leído una sola vez al abrir LJtex
function lastResult() {
  const r = readJson(STATUS);
  if (r) try { fs.rmSync(STATUS, {force: true}); } catch {}
  if (r?.ok) try { fs.rmSync(CACHE, {recursive: true, force: true}); } catch {}   // ya instalada: borrar la descarga
  return r;
}

// La carpeta LJtex.app que se está usando (null si se corre con `npm run app`, sin empaquetar)
function bundlePath() {
  const m = /^(.*?\.app)\/Contents\/MacOS\//.exec(app.getPath("exe"));
  return m ? m[1] : null;
}

async function gh(path, opts = {}) {
  const token = require("../ghtoken.cjs").get(true) || readJson(CONF)?.token;   // la clave vive en el Llavero (o en el archivo, en versiones viejas)
  if (!token) throw fail("Para buscar actualizaciones, primero conecta LJtex con tu cuenta de GitHub (botón «Abrir desde GitHub» en la pantalla de proyectos).", {needToken: true});
  const r = await fetch(API + path, {...opts, headers: {Authorization: `token ${token}`, "User-Agent": "LJtex", "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github+json", ...(opts.headers || {})}});
  if (r.status === 401) throw fail("GitHub no reconoce tu clave. Vuelve a conectar LJtex con GitHub.", {needToken: true});
  if (r.status === 404) throw fail(`No encuentro el repositorio ${repo()} en GitHub. Para recibir actualizaciones, tu cuenta necesita acceso a ese repositorio (pídele al dueño que te invite como colaborador).`);
  if (!r.ok) throw fail(`GitHub respondió con un error (${r.status}). Intenta más tarde.`);
  return r;
}

// Los Releases que publica la acción se llaman build-<fecha del cambio en segundos>-<commit>
const parseTag = t => { const m = /^build-(\d+)-([0-9a-f]+)$/.exec(t || ""); return m ? {time: +m[1], sha: m[2]} : null; };
const archName = () => process.arch === "arm64" ? "arm64" : "x64";

async function latest() {
  const list = await (await gh(`/repos/${repo()}/releases?per_page=20`)).json();
  return (list || []).filter(r => !r.draft && !r.prerelease && parseTag(r.tag_name))
    .sort((a, b) => parseTag(b.tag_name).time - parseTag(a.tag_name).time)[0] || null;
}

async function check() {
  const cur = current();
  const rel = await latest();
  const info = rel && {tag: rel.tag_name, title: rel.name, notes: (rel.body || "").trim(), time: parseTag(rel.tag_name).time, url: rel.html_url,
    asset: (rel.assets || []).some(a => a.name.endsWith(`-${archName()}.dmg`))};
  return {
    current: cur ? {time: cur.time, sha: cur.sha} : null,
    packaged: !!bundlePath(),
    latest: info,
    available: !!(info && info.asset && (!cur || info.time > cur.time)),
  };
}

let installing = false;
// progress(fase, fracción 0..1)
async function install(progress = () => {}) {
  if (installing) throw fail("La actualización ya se está descargando.");
  const bundle = bundlePath();
  if (!bundle) throw fail("Esta copia de LJtex no es la app instalada (se abrió desde la terminal); ahí se actualiza con git.");
  installing = true;
  const work = fs.mkdtempSync(join(os.tmpdir(), "ljtex-act-"));
  try {
    const rel = await latest();
    const asset = rel && (rel.assets || []).find(a => a.name.endsWith(`-${archName()}.dmg`));
    if (!asset) throw fail("La versión más reciente todavía no tiene el instalador para esta Mac. Intenta en unos minutos.");

    // 1. Descargar el .dmg (GitHub redirige a un enlace temporal de descarga). Si ya se descargó antes completo, se reutiliza.
    fs.mkdirSync(CACHE, {recursive: true});
    const dmg = join(CACHE, `LJtex-${rel.tag_name}-${archName()}.dmg`);
    const have = (() => { try { return fs.statSync(dmg).size; } catch { return -1; } })();
    log(`instalar ${rel.tag_name} (${asset.name}) sobre ${bundle}`);
    if (!(asset.size && have === asset.size)) {
      progress("Descargando", 0);
      const r = await gh(`/repos/${repo()}/releases/assets/${asset.id}`, {headers: {Accept: "application/octet-stream"}});
      const total = +r.headers.get("content-length") || asset.size || 0, part = dmg + ".parcial";
      const out = fs.createWriteStream(part); let got = 0, last = 0;
      for await (const chunk of r.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise(res => out.once("drain", res));
        if (total && got - last > total / 100) { last = got; progress("Descargando", got / total); }
      }
      await new Promise((res, rej) => out.end(err => err ? rej(err) : res()));
      if (asset.size && fs.statSync(part).size !== asset.size) throw fail("La descarga quedó incompleta. Revisa tu conexión e intenta de nuevo.");
      fs.renameSync(part, dmg);
      log("descarga completa");
    } else log("se reutiliza la descarga anterior");

    // 2. Sacar LJtex.app del .dmg
    progress("Preparando", 1);
    const mnt = join(work, "mnt"), fresh = join(work, "LJtex.app");
    fs.mkdirSync(mnt);
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt, dmg], {stdio: "ignore", timeout: 120000});
    try {
      const name = fs.readdirSync(mnt).find(n => n.endsWith(".app"));
      if (!name) throw fail("El instalador descargado no trae LJtex.app.");
      execFileSync("ditto", [join(mnt, name), fresh], {timeout: 300000});
    } finally { try { execFileSync("hdiutil", ["detach", mnt, "-force"], {stdio: "ignore", timeout: 60000}); } catch {} }
    try { execFileSync("xattr", ["-dr", "com.apple.quarantine", fresh], {stdio: "ignore"}); } catch {}

    // 3. ¿Se puede reemplazar la app donde está? Si no (p. ej. Aplicaciones de otro usuario), se abre el .dmg para hacerlo a mano
    try { fs.accessSync(dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); }
    catch {
      log("sin permiso de escritura junto a la app: se abre el instalador");
      shell.openPath(dmg);
      return {manual: true};
    }

    // 4. Un pequeño programa espera a que LJtex se cierre, cambia la app por la nueva y la vuelve a abrir.
    //    Si algo falla, deja la versión anterior en su lugar.
    const script = join(work, "actualizar.sh");
    fs.writeFileSync(script, `#!/bin/sh
# Lo lanza LJtex justo antes de cerrarse: espera a que se cierre, pone la versión nueva y la vuelve a abrir.
PID="$1"; OLD="$2"; NEW="$3"; WORK="$4"; TAG="$5"; DMG="$6"; LOG="$7"; STATUS="$8"
log() { echo "$(date '+%Y-%m-%dT%H:%M:%S') $*" >> "$LOG"; }
i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.5; i=$((i+1)); done
sleep 1
log "LJtex cerrado; reemplazando $OLD"
ok=0; how=""
# 1) Reemplazo directo
if mv "$OLD" "$OLD.anterior" 2>>"$LOG"; then
  if ditto "$NEW" "$OLD" 2>>"$LOG"; then ok=1; how=directo; rm -rf "$OLD.anterior"
  else rm -rf "$OLD"; mv "$OLD.anterior" "$OLD"; log "falló la copia; se restauró la versión anterior"; fi
else log "macOS no dejó mover la app (Gestión de apps); se intenta con Finder"; fi
# 2) Con Finder, que sí tiene permiso de modificar apps (macOS pide una vez permitir que LJtex controle Finder)
if [ $ok = 0 ] && [ "$(basename "$NEW")" = "$(basename "$OLD")" ]; then
  if osascript -e 'on run argv' -e 'tell application "Finder" to move (POSIX file (item 1 of argv) as alias) to (POSIX file (item 2 of argv) as alias) with replacing' -e 'end run' "$NEW" "$(dirname "$OLD")" >/dev/null 2>>"$LOG"; then
    ok=1; how=finder
  else log "Finder tampoco pudo reemplazarla"; fi
fi
if [ $ok = 1 ]; then
  log "versión nueva instalada ($how)"
  xattr -dr com.apple.quarantine "$OLD" 2>/dev/null
  printf '{"ok":true,"tag":"%s","how":"%s"}\\n' "$TAG" "$how" > "$STATUS"
  rm -rf "$WORK"
else
  # 3) Último recurso: dejar la versión anterior, abrir el instalador ya descargado y explicar qué hacer
  printf '{"ok":false,"tag":"%s","dmg":"%s"}\\n' "$TAG" "$DMG" > "$STATUS"
  open "$DMG"
fi
open "$OLD"
`, {mode: 0o755});
    return {ready: true, run: () => { log("cerrando LJtex para reemplazarla"); spawn("/bin/sh", [script, String(process.pid), bundle, fresh, work, rel.tag_name, dmg, LOG, STATUS], {detached: true, stdio: "ignore"}).unref(); }};
  } catch (e) {
    try { fs.rmSync(work, {recursive: true, force: true}); } catch {}
    throw e;
  } finally { installing = false; }
}

module.exports = {check, install, current, lastResult, openDmg: f => f && fs.existsSync(f) ? shell.openPath(f) : null};
