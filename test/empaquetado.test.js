// Todo archivo propio que importa el servidor (o la app de escritorio) debe ir dentro de LJtex.app;
// si falta en "files" de package.json, la app instalada no arranca.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "fs";
import {join, dirname, normalize} from "path";
import {fileURLToPath} from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).build.files;
const glob = g => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§").replace(/\*/g, "[^/]*").replace(/§/g, ".*") + "$");
const packed = f => files.some(g => glob(g).test(f));

function localImports(file, seen = new Set()) {
  if (seen.has(file)) return seen; seen.add(file);
  const src = readFileSync(join(root, file), "utf8");
  for (const m of src.matchAll(/(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
    let f = normalize(join(dirname(file), m[1]));
    if (!existsSync(join(root, f)) && existsSync(join(root, f + ".js"))) f += ".js";
    if (/\.(c|m)?js$/.test(f)) localImports(f, seen);
  }
  return seen;
}

for (const entry of ["server.js", "electron/main.cjs", "electron/preload.cjs"]) {
  test(`todo lo que usa ${entry} va dentro de la app`, () => {
    const missing = [...localImports(entry)].filter(f => !packed(f));
    assert.deepEqual(missing, [], `Faltan en "files" de package.json: ${missing.join(", ")}`);
  });
}

test("lo que lleva el atributo hidden se oculta aunque tenga display propio (si falta, paneles como «Cambios» no se cierran)", () => {
  assert.match(readFileSync(join(root, "index.html"), "utf8"), /\[hidden\]\{display:none!important\}/);
});
