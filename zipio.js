// Importar un proyecto desde un .zip (por ejemplo, el que descargas de Overleaf) y exportar el proyecto como .zip.
import express from "express";
import {unzipSync, zipSync, strToU8} from "fflate";
import {randomUUID, createHash} from "crypto";

const MAX_ZIP = 150e6;            // tamaño del .zip que se sube
const MAX_TOTAL = 400e6;          // tamaño total al descomprimir (protege de «bombas» de compresión)
const MAX_FILES = 3000;
const MAX_TEXT = 1e6;             // un texto mayor de 1 MB se guarda como archivo sin edición en vivo
const TEXT_EXT = new Set(["tex", "bib", "sty", "cls", "bst", "bbx", "cbx", "lbx", "def", "cfg", "ltx", "dtx", "ins", "txt", "md", "csv", "tsv", "json",
  "yml", "yaml", "xml", "html", "css", "js", "py", "r", "m", "sh", "tikz", "pgf", "bbl", "sty", "clo", "fd", "tex~", "rmd", "ipynb", "gp", "dat"]);
// Archivos que genera LaTeX al compilar: no son parte del proyecto
const BUILD = /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex\.gz|synctex|blg|bcf|run\.xml|nav|snm|vrb|idx|ilg|ind|glo|gls|glg|acn|acr|alg|xdv|dvi)$/i;
const JUNK = /(^|\/)(__MACOSX|\.git|\.svn|node_modules)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/;
// latexmk ejecuta el contenido de estos archivos como código: nunca se importan
const RC = /(^|\/)\.?latexmkrc$/i;

const sha1 = b => createHash("sha1").update(b).digest("hex");
const ext = p => (/\.([^./]+)$/.exec(p.toLowerCase()) || [])[1] || "";

// Nombre de ruta seguro y aceptado por Manuscrito. Devuelve null si no se puede (rutas con «..», vacías…).
function safePath(raw) {
  const segs = String(raw).replace(/\\/g, "/").split("/").map(s => s.trim()).filter(s => s && s !== ".");
  if (!segs.length || segs.some(s => s === "..")) return null;
  const out = segs.map(s => s.replace(/[^\p{L}\p{N}_\-. ]/gu, "_").replace(/^\.+$/, "_")).map(s => s.slice(0, 100));
  const p = out.join("/");
  return p.length <= 200 ? p : null;
}

function decodeText(u8) {
  if (u8.includes(0)) return null;
  try { return {text: new TextDecoder("utf-8", {fatal: true}).decode(u8)}; }
  catch { try { return {text: new TextDecoder("windows-1252").decode(u8), converted: true}; } catch { return null; } }
}

export function registerZip(app, h) {
  const {db, getDocText, who, log, clashes, okPath} = h;

  // ---------- Exportar ----------
  app.get("/api/projects/:id/export", (q, r) => {
    const p = db.prepare("select name from projects where id=?").get(q.params.id);
    if (!p) return r.status(404).json({error: "El proyecto no existe."});
    const files = {};
    for (const f of db.prepare("select path,kind,data from files where project=?").all(q.params.id))
      files[f.path] = f.kind === "text" ? strToU8(getDocText(`${q.params.id}/${f.path}`)) : new Uint8Array(f.data || []);
    const zip = zipSync(files, {level: 6});
    r.set({"Content-Type": "application/zip", "Cache-Control": "no-store"}).send(Buffer.from(zip));
  });

  // ---------- Importar ----------
  app.post("/api/projects/import", express.raw({type: () => true, limit: MAX_ZIP}), (q, r) => {
    let name = "Proyecto importado";
    try { name = decodeURIComponent(q.get("x-name") || "").replace(/\.zip$/i, "").trim().slice(0, 80) || name; } catch {}
    if (!Buffer.isBuffer(q.body) || !q.body.length) return r.status(400).json({error: "No llegó ningún archivo."});
    // 1) Descomprimir con límites
    let entries, total = 0, count = 0;
    try {
      entries = unzipSync(new Uint8Array(q.body), {filter: f => {
        if (f.name.endsWith("/")) return false;
        total += f.originalSize; count++;
        if (total > MAX_TOTAL || count > MAX_FILES) throw new Error("LIMIT");
        return true;
      }});
    } catch (e) {
      return r.status(400).json({error: e.message === "LIMIT"
        ? `El .zip es demasiado grande al descomprimirse (máximo ${MAX_TOTAL / 1e6} MB y ${MAX_FILES} archivos).`
        : "No pude leer ese archivo: no parece un .zip válido (o está dañado)."});
    }
    // 2) Quitar la carpeta raíz común (lo habitual al comprimir una carpeta) y los archivos que sobran
    let names = Object.keys(entries).map(n => n.replace(/\\/g, "/")), skipped = [], notes = [];
    const real = names.filter(n => !JUNK.test(n));
    const top = new Set(real.map(n => n.split("/")[0]));
    const strip = top.size === 1 && real.every(n => n.includes("/")) ? [...top][0] + "/" : "";
    if (strip) notes.push(`Se quitó la carpeta «${strip.slice(0, -1)}» que contenía todo.`);

    const files = new Map(), renamed = [];
    for (const orig of Object.keys(entries)) {
      const n = orig.replace(/\\/g, "/");
      if (JUNK.test(n)) continue;                                           // basura del sistema: se ignora sin avisar
      const rel = strip && n.startsWith(strip) ? n.slice(strip.length) : n;
      if (RC.test(rel)) { skipped.push([rel, "no se importa por seguridad (latexmk lo ejecutaría como código)"]); continue; }
      if (rel.split("/").some(s => s === "..")) { skipped.push([rel, "ruta no válida"]); continue; }
      if (rel.split("/").some(s => s.startsWith(".") && s !== "." )) { skipped.push([rel, "archivo oculto"]); continue; }
      if (BUILD.test(rel)) continue;                                        // aux, log… los vuelve a generar LaTeX
      let path = safePath(rel);
      if (!path) { skipped.push([rel, "ruta no válida"]); continue; }
      if (path !== rel.replace(/\\/g, "/").split("/").map(s => s.trim()).filter(s => s && s !== ".").join("/")) renamed.push([rel, path]);
      if (clashes([...files.keys()], path) && !files.has(path)) { skipped.push([rel, "choca con una carpeta o archivo del mismo nombre"]); continue; }
      if (files.has(path)) {                                                // dos nombres distintos que quedaron iguales
        const base = path; let k = 2;
        do path = base.replace(/(\.[^./]+)?$/, `_${k++}$1`); while (files.has(path));
        renamed.push([rel, path]);
      }
      if (!okPath(path)) { skipped.push([rel, "nombre no válido"]); continue; }
      files.set(path, entries[orig]);
    }
    if (!files.size) return r.status(400).json({error: "El .zip no contiene archivos que importar."});

    // 3) Clasificar: texto editable o archivo binario
    const rows = [];
    let converted = 0;
    for (const [path, u8] of files) {
      let dec = TEXT_EXT.has(ext(path)) && u8.length <= MAX_TEXT ? decodeText(u8) : null;
      if (dec?.converted) converted++;
      rows.push(dec ? {path, kind: "text", text: dec.text} : {path, kind: "bin", buf: Buffer.from(u8)});
    }
    if (converted) notes.push(`${converted} ${converted === 1 ? "archivo estaba" : "archivos estaban"} en una codificación antigua (Latin-1) y se ${converted === 1 ? "convirtió" : "convirtieron"} a UTF-8.`);

    // 4) Archivo principal (el que se compila): main.tex si existe; si no, el .tex que contiene \documentclass (sin renombrar nada)
    let main = null;
    if (!rows.some(f => f.path === "main.tex")) {
      const docs = rows.filter(f => f.kind === "text" && /\.tex$/i.test(f.path) && /^[^%\n]*\\documentclass/m.test(f.text.replace(/%.*$/gm, "")));
      const root = docs.filter(f => !f.path.includes("/")), pool = root.length ? root : docs;
      const PREF = /^(main|ms|paper|article|manuscript|manuscrito|thesis|tesis|report|index|document)\.tex$/i;
      const pick = pool.length === 1 ? pool[0] : pool.find(f => PREF.test(f.path.split("/").at(-1))) || pool.find(f => /\\begin\{document\}/.test(f.text)) || pool.slice().sort((x, y) => x.path.localeCompare(y.path))[0];
      if (pick) {
        main = pick.path;
        notes.push(`No había «main.tex»: se marcó «${pick.path}» como archivo principal (el que se compila).` + (pool.length > 1 ? ` Otros candidatos: ${pool.filter(f => f !== pick).map(f => f.path).slice(0, 5).join(", ")}. Puedes cambiarlo con el botón «Principal» de la barra del PDF.` : ""));
      } else notes.push("No encontré ningún archivo con \\documentclass. Cuando lo tengas, márcalo como principal con el botón «Principal» de la barra del PDF.");
    }

    // 5) Crear el proyecto
    const id = randomUUID().slice(0, 8), now = Date.now();
    db.transaction(() => {
      db.prepare("insert into projects(id,name,t,modified,tags,main) values(?,?,?,?,?,?)").run(id, name, now, now, "[]", main);
      for (const f of rows)
        db.prepare("insert into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)")
          .run(id, f.path, f.kind, f.kind === "text" ? f.text : null, f.kind === "bin" ? f.buf : null, f.kind === "bin" ? sha1(f.buf) : null);
    })();
    log(id, who(q), "project", "", `Importado desde .zip (${rows.length} archivos)`);
    r.json({id, name, main: main || "main.tex", files: rows.length, text: rows.filter(f => f.kind === "text").length, skipped: skipped.slice(0, 50), skippedCount: skipped.length,
      renamed: renamed.slice(0, 50), notes});
  });
}
