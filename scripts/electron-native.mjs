// Descarga el módulo nativo de SQLite ya compilado para Electron (sin tocar el de Node, que usa `npm start`).
// Uso: node scripts/electron-native.mjs [darwin|linux] [arm64|x64 ...]   (por defecto: esta plataforma y arquitectura)
import {readFileSync, mkdirSync, existsSync, writeFileSync, rmSync, copyFileSync} from "fs";
import {execFileSync} from "child_process";
import {join, dirname} from "path";
import {fileURLToPath} from "url";
import {tmpdir} from "os";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ver = JSON.parse(readFileSync(join(root, "node_modules/better-sqlite3/package.json"), "utf8")).version;
const ev = JSON.parse(readFileSync(join(root, "node_modules/electron/package.json"), "utf8")).version;
const ABI = {33: 130}[+ev.split(".")[0]];
if (!ABI) throw new Error("Versión de Electron sin ABI conocido: " + ev);
const plat = process.argv[2] || process.platform, archs = process.argv.slice(3).length ? process.argv.slice(3) : [process.arch];
for (const arch of archs) {
  const out = join(root, "native", `${plat}-${arch}`, "better_sqlite3.node");
  if (existsSync(out)) { console.log("ya está", out); continue; }
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${ver}/better-sqlite3-v${ver}-electron-v${ABI}-${plat}-${arch}.tar.gz`;
  const r = await fetch(url); if (!r.ok) throw new Error(`No se pudo descargar ${url} (${r.status})`);
  const tmp = join(tmpdir(), `bs3-${plat}-${arch}-${process.pid}`); mkdirSync(tmp, {recursive: true});
  writeFileSync(join(tmp, "a.tgz"), Buffer.from(await r.arrayBuffer()));
  execFileSync("tar", ["-xzf", join(tmp, "a.tgz"), "-C", tmp]);
  mkdirSync(dirname(out), {recursive: true}); copyFileSync(join(tmp, "build/Release/better_sqlite3.node"), out); rmSync(tmp, {recursive: true, force: true});
  console.log("listo", out);
}
