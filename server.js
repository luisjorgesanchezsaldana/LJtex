import {Server} from "@hocuspocus/server";
import {Database} from "@hocuspocus/extension-database";
import * as Y from "yjs";
import express from "express";
import SQLite from "better-sqlite3";
import {copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from "fs";
import {execFile} from "child_process";
import {homedir, tmpdir} from "os";
import {join, dirname, resolve, sep} from "path";
import {fileURLToPath} from "url";
import {createHash, randomUUID} from "crypto";
import {registerAgent} from "./agent.js";
import {registerBib} from "./bibimport.js";
import {registerZotero} from "./zotero.js";
import {registerZip} from "./zipio.js";
import {registerGithub} from "./github.js";
import {acquireLock, checkIntegrity, conflictCopies, startBackups, syncStart, syncEnd} from "./datasync.js";

const TOKEN = process.env.TOKEN || "cambia-esto";   // clave compartida del grupo
// Por seguridad LJtex solo atiende a esta misma computadora. Para dar acceso a otras de la red (servidor de grupo,
// Docker) arráncalo con LJTEX_HOST=0.0.0.0 y una clave propia en TOKEN.
const HOST = process.env.LJTEX_HOST || "127.0.0.1";
const ONLY_HERE = /^(127\.|::1$|localhost$)/i.test(HOST);
if (!ONLY_HERE && TOKEN === "cambia-esto") {
  console.error(`\nLJTEX_HOST=${HOST} abre LJtex a otras computadoras de la red, pero la clave sigue siendo la de ejemplo.\nElige una clave propia, por ejemplo:  TOKEN=una-clave-larga LJTEX_HOST=${HOST} npm start\n`);
  process.exit(1);
}
// Los datos viven FUERA de la carpeta del programa, para que actualizar o reemplazar el código no los borre.
// Por defecto: ~/Manuscrito-datos/data.db (se cambia con la variable DB).
// LJTEX_DATA=<carpeta> usa esa carpeta (p. ej. en iCloud Drive) para compartir los datos entre varias Mac.
const DB_PATH = process.env.DB || join(process.env.LJTEX_DATA || join(homedir(), "Manuscrito-datos"), "data.db");
mkdirSync(dirname(DB_PATH), {recursive: true});
if (!existsSync(DB_PATH) && existsSync("data.db")) copyFileSync("data.db", DB_PATH);   // trae la base de datos que ya tenías en esta carpeta
// LJTEX_SYNC=<carpeta de iCloud/Dropbox>: cada proyecto se baja al abrir y se sube al cerrar (nunca se abre la base dentro de iCloud).
const SYNC_DIR = process.env.LJTEX_SYNC || "";
let syncReady = false;   // solo se sube al cerrar si la sincronización arrancó bien (si no, se pisaría la versión de la otra Mac)
try {
  acquireLock(DB_PATH);
  if (SYNC_DIR) {
    process.on("exit", () => { if (!syncReady) return; const r = syncEnd(db, DB_PATH, SYNC_DIR); try { db.close(); } catch {} console.log("Sincronización al cerrar:", r); });   // antes de soltar el candado compartido
    acquireLock(join(SYNC_DIR, "data.db"));
  }
} catch (e) { console.error("\n" + e.message + "\n"); process.exit(1); }
// Dentro de la app (Electron) el módulo nativo de SQLite es otro (otro «ABI»): vive en native/<sistema>-<chip>/
const HERE = dirname(fileURLToPath(import.meta.url));
const db = new SQLite(DB_PATH, process.versions.electron ? {nativeBinding: join(HERE, "native", `${process.platform}-${process.arch}`, "better_sqlite3.node")} : {});
try { checkIntegrity(db); } catch (e) { console.error("\n" + e.message + "\n"); process.exit(1); }
const cc = conflictCopies(DB_PATH); if (cc.length) console.warn("⚠ Hay copias en conflicto en la carpeta de datos (" + cc.join(", ") + "). Revisa cuál es la buena.");
startBackups(db, DB_PATH);
console.log("Datos guardados en", DB_PATH);
db.exec(`create table if not exists docs(name text primary key, data blob);
create table if not exists versions(id integer primary key, doc text, t integer, author text, label text, auto integer, text text, stats text);
create table if not exists projects(id text primary key, name text, t integer, modified integer);
create table if not exists files(project text, path text, kind text, text text, data blob, primary key(project, path));
create table if not exists activity(id integer primary key, project text, t integer, author text, kind text, path text, detail text);
create table if not exists blobs(hash text primary key, data blob);
create table if not exists snaps(id integer primary key, project text, t integer, manifest text, mhash text);
create table if not exists chats(id text primary key, project text, title text, t integer, updated integer, items text);
create table if not exists agent_jobs(id text primary key, project text, prompt text, t integer, text text, changes text, applied text);`);
// Bases de datos anteriores
const hasCol = (tbl, col) => db.prepare(`pragma table_info(${tbl})`).all().some(c => c.name === col);
if (!hasCol("projects", "modified")) db.exec("alter table projects add column modified integer; update projects set modified = t;");
if (!hasCol("versions", "stats")) db.exec("alter table versions add column stats text");
if (!hasCol("versions", "snap")) db.exec("alter table versions add column snap integer");
if (!hasCol("activity", "snap")) db.exec("alter table activity add column snap integer");
if (!hasCol("projects", "tags")) db.exec("alter table projects add column tags text");
if (!hasCol("projects", "main")) db.exec("alter table projects add column main text");   // archivo principal (el que se compila); vacío = main.tex
if (!hasCol("projects", "engine")) db.exec("alter table projects add column engine text");   // motor de compilación (vacío = pdflatex)
if (!hasCol("files", "hash")) db.exec("alter table files add column hash text");
if (SYNC_DIR) {
  try { const si = syncStart(db, DB_PATH, SYNC_DIR); syncReady = true; console.log("Sincronización:", si.notes.length ? "\n  " + si.notes.join("\n  ") : "al día"); }
  catch (e) { console.error("\n" + e.message + "\n"); process.exit(1); }
}

// Historial: una versión automática cuando cambia el autor tras SPAN ms, y cada EVERY ms de edición continua
const SPAN = +process.env.HIST_SPAN || 20e3, EVERY = +process.env.HIST_EVERY || 5 * 60e3;

const SEED = "\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\title{Título del trabajo}\n\\author{Autores}\n\\begin{document}\n\\maketitle\n\n\\section{Introducción}\nEscribe aquí.\n\n\\end{document}\n";
const okPath = p => typeof p === "string" && p.length <= 200 && /^[\p{L}\p{N}_\-. \/]+$/u.test(p) && !p.includes("..")
  && p.split("/").every(s => s && s !== "." && s === s.trim());
const TEXMAIN = /\.(tex|ltx|latex)$/i;
const mainOf = project => db.prepare("select main from projects where id=?").get(project)?.main || "main.tex";
const BAD_PATH = "Nombre no válido. Usa letras, números, espacios, guiones, puntos y guiones bajos; las carpetas se separan con /.";
const split = n => [n.split("/")[0], n.split("/").slice(1).join("/")];
const sha1 = b => createHash("sha1").update(b).digest("hex");
const fecha = t => new Date(t).toLocaleString("es", {dateStyle: "medium", timeStyle: "short"});
const touch = id => db.prepare("update projects set modified=? where id=?").run(Date.now(), id);
const getFile = (p, path) => db.prepare("select text from files where project=? and path=?").get(p, path);
const who = q => { try { return decodeURIComponent(q.get("x-user") || "").slice(0, 60) || "Anónimo"; } catch { return "Anónimo"; } };
const log = (project, author, kind, path = "", detail = "", snap = null) =>
  db.prepare("insert into activity(project,t,author,kind,path,detail,snap) values(?,?,?,?,?,?,?)").run(project, Date.now(), author, kind, path, detail, snap);

// ---------- Qué cambió entre dos textos ----------
function lineDiff(a, b) {
  const x = a.split("\n"), y = b.split("\n");
  let s = 0; while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0; while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const xm = x.slice(s, x.length - e), ym = y.slice(s, y.length - e), n = xm.length, m = ym.length;
  if (!n || !m || n * m > 4e6) return {add: ym, del: xm, first: s};
  const W = m + 1, L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i * W + j] = xm[i] === ym[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const add = [], del = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (xm[i] === ym[j]) { i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) del.push(xm[i++]);
    else add.push(ym[j++]);
  }
  while (i < n) del.push(xm[i++]);
  while (j < m) add.push(ym[j++]);
  return {add, del, first: s};
}
// Sección de LaTeX en la que está la primera línea cambiada
function heading(text, line) {
  const ls = text.split("\n");
  if (ls.findIndex(l => l.includes("\\begin{document}")) > line) return "Preámbulo";
  for (let i = Math.min(line, ls.length - 1); i >= 0; i--) {
    const m = ls[i].match(/\\(chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/);
    if (m) return ({chapter: "Capítulo", section: "Sección", subsection: "Subsección", subsubsection: "Subsección"})[m[1]] + ": " + m[2].slice(0, 60);
  }
  return "";
}
// a = líneas añadidas, r = líneas quitadas, w = palabras netas, h = sección, p = vista previa, i = primera versión
function diffStats(a, b, init) {
  const words = s => (s.match(/\S+/g) || []).length, out = {w: words(b) - words(a)};
  if (init) return {...out, i: 1, n: b ? b.split("\n").length : 0};
  const {add, del, first} = lineDiff(a, b), clip = s => s.trim().slice(0, 110);
  out.a = add.length; out.r = del.length;
  const h = heading(b, first); if (h) out.h = h;
  out.p = [...del.filter(l => l.trim()).slice(0, 1).map(l => "− " + clip(l)), ...add.filter(l => l.trim()).slice(0, 2).map(l => "+ " + clip(l))];
  return out;
}

// ---------- Copias del proyecto completo ----------
// Cada copia es una lista (ruta, tipo, hash) de todos los archivos; el contenido se guarda una sola vez por hash.
const putBlob = (h, buf) => db.prepare("insert or ignore into blobs(hash,data) values(?,?)").run(h, buf);
const hasBlob = h => !!db.prepare("select 1 from blobs where hash=?").get(h);
const getBlob = h => db.prepare("select data from blobs where hash=?").get(h)?.data;
function manifestOf(project, override = {}, store = true) {
  return db.prepare("select path,kind,hash from files where project=? order by path").all(project).map(f => {
    let h;
    if (f.kind === "text") {
      const buf = Buffer.from(override[f.path] ?? getDocText(`${project}/${f.path}`), "utf8");
      h = sha1(buf); if (store) putBlob(h, buf);
    } else {
      h = f.hash;
      if (!h || (store && !hasBlob(h))) {
        const d = db.prepare("select data from files where project=? and path=?").get(project, f.path)?.data;
        if (d) {
          h = h || sha1(d);
          if (!f.hash) db.prepare("update files set hash=? where project=? and path=?").run(h, project, f.path);
          if (store) putBlob(h, d);
        }
      }
    }
    return [f.path, f.kind, h];
  });
}
function takeSnapshot(project, override = {}) {
  const mj = JSON.stringify(manifestOf(project, override)), mh = sha1(mj);
  const last = db.prepare("select id,mhash from snaps where project=? order by id desc limit 1").get(project);
  if (last?.mhash === mh) return last.id;
  return Number(db.prepare("insert into snaps(project,t,manifest,mhash) values(?,?,?,?)").run(project, Date.now(), mj, mh).lastInsertRowid);
}
function gcBlobs() {
  const keep = new Set();
  for (const s of db.prepare("select manifest from snaps").all()) for (const f of JSON.parse(s.manifest)) keep.add(f[2]);
  const del = db.prepare("delete from blobs where hash=?");
  db.transaction(() => { for (const {hash} of db.prepare("select hash from blobs").all()) if (!keep.has(hash)) del.run(hash); })();
}
// Qué habría que hacer para dejar el proyecto como en una copia
function plan(project, target) {
  const cur = new Map(manifestOf(project, {}, false).map(([p, k, h]) => [p, {kind: k, h}]));
  const tgt = new Map(target.map(([p, k, h]) => [p, {kind: k, h}]));
  const update = [], create = [], remove = [], rename = [];
  for (const [p, t] of tgt) {
    const c = cur.get(p);
    if (!c) create.push(p);
    else if (c.kind !== t.kind) { remove.push(p); create.push(p); }
    else if (c.h !== t.h) update.push(p);
  }
  for (const p of cur.keys()) if (!tgt.has(p)) remove.push(p);
  // Mismo contenido en otra ruta y destino libre: se renombra, así el archivo conserva su historial
  for (const from of [...remove]) {
    const c = cur.get(from);
    const to = create.find(p => !cur.has(p) && tgt.get(p).h === c.h && tgt.get(p).kind === c.kind);
    if (to && cur.has(from)) { rename.push([from, to]); remove.splice(remove.indexOf(from), 1); create.splice(create.indexOf(to), 1); }
  }
  return {update, create, remove, rename, cur, tgt};
}

// ---------- Versiones ----------
const lastVersion = doc => db.prepare("select id,text from versions where doc=? order by id desc limit 1").get(doc);
function addVersion(doc, author, label, auto, text, t = Date.now(), withSnap = true) {
  const prev = lastVersion(doc), [project, path] = split(doc);
  const id = db.prepare("insert into versions(doc,t,author,label,auto,text,stats) values(?,?,?,?,?,?,?)")
    .run(doc, t, author, label, auto ? 1 : 0, text, JSON.stringify(diffStats(prev?.text ?? "", text, !prev))).lastInsertRowid;
  if (withSnap) db.prepare("update versions set snap=? where id=?").run(takeSnapshot(project, {[path]: text}), id);
  return Number(id);
}
const getDocText = name => {
  const d = hp.documents.get(name);
  if (d) return d.getText("src").toString();
  const [p, path] = split(name);
  return getFile(p, path)?.text ?? "";
};
// Quién ha editado cada documento desde la última versión guardada
const track = new Map(), restoring = new Set();
function flushPending(name) {
  const s = track.get(name); if (!s) return;
  track.delete(name);
  const text = getDocText(name);
  if (text && text !== lastVersion(name)?.text) addVersion(name, s.authors.join(", "), "", true, text, s.lastT);
}
// Reemplaza el texto de un documento en vivo: solo cambia el trozo que difiere, para no mover los cursores de los demás
async function setDocText(doc, text, me) {
  restoring.add(doc);
  try {
    const conn = await hp.openDirectConnection(doc, {name: me});
    await conn.transact(d => {
      const t = d.getText("src"), old = t.toString();
      let s = 0; while (s < old.length && s < text.length && old[s] === text[s]) s++;
      let e = 0; while (e < old.length - s && e < text.length - s && old[old.length - 1 - e] === text[text.length - 1 - e]) e++;
      t.delete(s, old.length - s - e);
      t.insert(s, text.slice(s, text.length - e));
    });
    await conn.disconnect();
  } finally { setTimeout(() => restoring.delete(doc), 2500); }
}
// Versiones guardadas antes de que existieran las estadísticas
function ensureStats(project) {
  const pre = project + "/";
  if (!db.prepare("select 1 from versions where substr(doc,1,?)=? and stats is null limit 1").get(pre.length, pre)) return;
  const prev = new Map(), upd = db.prepare("update versions set stats=? where id=?");
  const rows = db.prepare("select id,doc,text,stats from versions where substr(doc,1,?)=? order by id").all(pre.length, pre);
  db.transaction(() => {
    for (const v of rows) {
      if (v.stats == null) upd.run(JSON.stringify(diffStats(prev.get(v.doc) ?? "", v.text, !prev.has(v.doc))), v.id);
      prev.set(v.doc, v.text);
    }
  })();
}

// Colaboración en tiempo real: un documento Yjs por archivo ("proyecto/ruta")
const hp = Server.configure({
  port: 1234,
  address: HOST,
  async onAuthenticate({token}) {
    const {t, n} = JSON.parse(token || "{}");
    if (t !== TOKEN) throw new Error("no autorizado");
    return {name: n || "Anónimo"};
  },
  extensions: [new Database({
    fetch: async ({documentName}) => {
      const r = db.prepare("select data from docs where name=?").get(documentName);
      if (r) return r.data;
      const [p, path] = split(documentName);
      const f = getFile(p, path);
      if (!f?.text) return null;
      const d = new Y.Doc(); d.getText("src").insert(0, f.text);
      return Y.encodeStateAsUpdate(d);
    },
    store: async ({documentName, state}) => {
      const [p, path] = split(documentName);
      if (!getFile(p, path)) return;   // el archivo se movió o se eliminó: no recrear su documento
      db.prepare("insert or replace into docs values(?,?)").run(documentName, state);
    },
  })],
  // Cada cambio se atribuye a quien lo hizo
  async onChange({documentName, document, context}) {
    if (restoring.has(documentName)) return;
    const [p, path] = split(documentName), row = getFile(p, path); if (!row) return;
    const author = context?.name || "Anónimo", text = document.getText("src").toString(), now = Date.now();
    let s = track.get(documentName);
    if (!s) {
      if (row.text && !lastVersion(documentName)) addVersion(documentName, "", "Estado inicial", true, row.text, now - 1);
      s = {authors: [author], start: now, lastT: now, lastText: row.text ?? ""};
      track.set(documentName, s);
    } else if (!s.authors.includes(author)) {
      if (now - s.start >= SPAN) {   // otro autor toma el relevo: se guarda lo que hizo el anterior
        if (s.lastText && s.lastText !== lastVersion(documentName)?.text) addVersion(documentName, s.authors.join(", "), "", true, s.lastText, s.lastT);
        s = {authors: [author], start: now, lastT: now, lastText: s.lastText};
        track.set(documentName, s);
      } else s.authors.push(author);   // se editó a la vez: la versión será de ambos
    }
    s.lastT = now; s.lastText = text;
  },
  async onStoreDocument({documentName, document}) {
    const clientsCount = document.getConnectionsCount();   // el valor del evento puede estar desfasado: se pregunta al documento
    const [p, path] = split(documentName), row = getFile(p, path);
    if (!row) { track.delete(documentName); return; }
    const text = document.getText("src").toString();
    if (row.text !== text) {   // solo cuenta como modificación si el texto cambió
      db.prepare("update files set text=? where project=? and path=?").run(text, p, path);
      touch(p);
    }
    if (restoring.has(documentName)) return;
    const s = track.get(documentName);
    if (s && (clientsCount === 0 || Date.now() - s.start >= EVERY)) {
      if (text && text !== lastVersion(documentName)?.text)
        addVersion(documentName, s.authors.join(", "), "", true, text, clientsCount === 0 ? s.lastT : Date.now());
      track.delete(documentName);
    }
  },
});
hp.listen();

const app = express();
app.use(express.json({limit: "25mb"}));
app.use("/api", (q, r, n) => q.get("x-token") === TOKEN ? n() : r.sendStatus(401));

// Proyectos: los modificados más recientemente primero
// Etiquetas: lista de textos cortos, sin repetir (sin distinguir mayúsculas), como mucho 12 por proyecto
const cleanTags = v => {
  const out = [], seen = new Set();
  for (const t of Array.isArray(v) ? v : []) {
    const x = String(t ?? "").replace(/[\s,]+/g, " ").trim().slice(0, 30), k = x.toLowerCase();
    if (x && !seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out.slice(0, 12);
};
const parseTags = t => { try { return cleanTags(JSON.parse(t || "[]")); } catch { return []; } };
app.get("/api/projects", (q, r) =>
  r.json(db.prepare("select id,name,t,modified,tags,main,engine from projects order by modified desc, t desc").all().map(p => ({...p, tags: parseTags(p.tags), main: p.main || "main.tex", engine: p.engine || "pdflatex"}))));
// Cambiar el nombre o las etiquetas (no cuenta como «modificación» del contenido: no cambia el orden por fecha)
app.patch("/api/projects/:id", (q, r) => {
  const p = db.prepare("select name,tags,main,engine from projects where id=?").get(q.params.id);
  if (!p) return r.status(404).json({error: "El proyecto no existe."});
  let engine = p.engine;
  if (q.body.engine != null) { if (!["pdflatex", "xelatex", "lualatex"].includes(q.body.engine)) return r.status(400).json({error: "Motor no válido."}); engine = q.body.engine === "pdflatex" ? null : q.body.engine; }
  const name = q.body.name == null ? p.name : String(q.body.name).trim().slice(0, 80);
  if (!name) return r.status(400).json({error: "El nombre no puede estar vacío."});
  const tags = q.body.tags == null ? parseTags(p.tags) : cleanTags(q.body.tags);
  let main = p.main;
  if (q.body.main != null) {
    const m = String(q.body.main);
    const f = okPath(m) && db.prepare("select kind from files where project=? and path=?").get(q.params.id, m);
    if (!f || f.kind !== "text" || !TEXMAIN.test(m)) return r.status(400).json({error: "El archivo principal debe ser un archivo .tex del proyecto."});
    main = m === "main.tex" ? null : m;
  }
  db.prepare("update projects set name=?, tags=?, main=?, engine=? where id=?").run(name, JSON.stringify(tags), main, engine, q.params.id);
  r.json({ok: true, name, tags, main: main || "main.tex", engine: engine || "pdflatex"});
});
// Duplicar: copia los archivos (con el texto más reciente de cada uno). El historial empieza de cero en la copia.
app.post("/api/projects/:id/duplicate", (q, r) => {
  const src = db.prepare("select name,tags,main,engine from projects where id=?").get(q.params.id);
  if (!src) return r.status(404).json({error: "El proyecto no existe."});
  const id = randomUUID().slice(0, 8), now = Date.now();
  const name = (String(q.body.name || "").trim() || `${src.name} (copia)`).slice(0, 80);
  const files = db.prepare("select path,kind,text,data,hash from files where project=?").all(q.params.id);
  db.transaction(() => {
    db.prepare("insert into projects(id,name,t,modified,tags,main,engine) values(?,?,?,?,?,?,?)").run(id, name, now, now, JSON.stringify(parseTags(src.tags)), src.main, src.engine);
    for (const f of files)
      db.prepare("insert into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)")
        .run(id, f.path, f.kind, f.kind === "text" ? getDocText(`${q.params.id}/${f.path}`) : null, f.data, f.hash);
  })();
  log(id, who(q), "project", "", `Copia de «${src.name}»`);
  r.json({id, name});
});
// Plantillas de proyecto nuevo
const TEMPLATES = {
  articulo: {name: "Artículo", files: {"main.tex": SEED}},
  libro: {name: "Libro", files: {
    "main.tex": "\\documentclass[11pt,a4paper,twoside]{book}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage[spanish]{babel}\n\\usepackage{amsmath,amssymb,amsthm}\n\\usepackage{graphicx}\n\\usepackage[hidelinks]{hyperref}\n\\newtheorem{teorema}{Teorema}[chapter]\n\\newtheorem{definicion}[teorema]{Definición}\n\n\\title{Título del libro}\n\\author{Autor}\n\\date{}\n\n\\begin{document}\n\\frontmatter\n\\maketitle\n\\tableofcontents\n\\mainmatter\n\\input{capitulos/cap1}\n\\input{capitulos/cap2}\n\\backmatter\n\\bibliographystyle{plain}\n\\bibliography{referencias}\n\\end{document}\n",
    "capitulos/cap1.tex": "\\chapter{Primer capítulo}\n\nEscribe aquí.\n",
    "capitulos/cap2.tex": "\\chapter{Segundo capítulo}\n\nEscribe aquí.\n",
    "referencias.bib": ""}},
  tesis: {name: "Tesis", files: {
    "main.tex": "\\documentclass[12pt,a4paper,oneside]{report}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage[spanish]{babel}\n\\usepackage{amsmath,amssymb,amsthm}\n\\usepackage{graphicx}\n\\usepackage{setspace}\n\\usepackage[margin=2.5cm]{geometry}\n\\usepackage[hidelinks]{hyperref}\n\\onehalfspacing\n\n\\begin{document}\n\\begin{titlepage}\n\\centering\n{\\large Universidad\\par}\\vspace{1cm}\n{\\large Facultad\\par}\\vspace{3cm}\n{\\LARGE\\bfseries Título de la tesis\\par}\\vspace{2cm}\n{\\large Que para obtener el título de\\par Licenciado en …\\par}\\vspace{1cm}\n{\\large Presenta:\\par Nombre del autor\\par}\\vspace{1cm}\n{\\large Director de tesis:\\par Nombre del director\\par}\\vfill\n{\\large Ciudad, año}\n\\end{titlepage}\n\n\\chapter*{Agradecimientos}\n\n\\begin{abstract}\nResumen de la tesis.\n\\end{abstract}\n\\tableofcontents\n\\input{capitulos/introduccion}\n\\input{capitulos/desarrollo}\n\\input{capitulos/conclusiones}\n\\bibliographystyle{plain}\n\\bibliography{referencias}\n\\end{document}\n",
    "capitulos/introduccion.tex": "\\chapter{Introducción}\n\nEscribe aquí.\n",
    "capitulos/desarrollo.tex": "\\chapter{Desarrollo}\n\nEscribe aquí.\n",
    "capitulos/conclusiones.tex": "\\chapter{Conclusiones}\n\nEscribe aquí.\n",
    "referencias.bib": ""}},
  beamer: {name: "Presentación (beamer)", files: {
    "main.tex": "\\documentclass{beamer}\n\\usepackage[utf8]{inputenc}\n\\usepackage[spanish]{babel}\n\\usetheme{Madrid}\n\n\\title{Título de la presentación}\n\\author{Autor}\n\\institute{Institución}\n\\date{\\today}\n\n\\begin{document}\n\\begin{frame}\n\\titlepage\n\\end{frame}\n\n\\begin{frame}{Contenido}\n\\tableofcontents\n\\end{frame}\n\n\\section{Introducción}\n\\begin{frame}{Primera diapositiva}\n\\begin{itemize}\n\\item Primer punto\n\\item Segundo punto\n\\end{itemize}\n\\end{frame}\n\n\\end{document}\n"}},
  examen: {name: "Examen", files: {
    "main.tex": "\\documentclass[12pt]{exam}\n\\usepackage[utf8]{inputenc}\n\\usepackage[spanish]{babel}\n\\usepackage{amsmath,amssymb}\n\\usepackage[margin=2cm]{geometry}\n\n\\begin{document}\n\\begin{center}\n{\\Large\\bfseries Examen de …}\\\\[2mm]\nNombre: \\hrulefill\\quad Fecha: \\hrulefill\n\\end{center}\n\n\\begin{questions}\n\\question[10] Enunciado de la primera pregunta.\n\\begin{solution}\nSolución.\n\\end{solution}\n\n\\question[10] Enunciado de la segunda pregunta.\n\\end{questions}\n\\end{document}\n"}},
  vacio: {name: "Documento vacío", files: {"main.tex": "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n"}},
};
app.get("/api/templates", (q, r) => r.json(Object.entries(TEMPLATES).map(([id, t]) => ({id, name: t.name, files: Object.keys(t.files)}))));
app.post("/api/projects", (q, r) => {
  const id = randomUUID().slice(0, 8), now = Date.now(), name = (q.body.name || "Sin título").slice(0, 80);
  const tpl = TEMPLATES[q.body.template] || TEMPLATES.articulo;
  db.transaction(() => {
    db.prepare("insert into projects(id,name,t,modified) values(?,?,?,?)").run(id, name, now, now);
    for (const [p, text] of Object.entries(tpl.files)) db.prepare("insert into files(project,path,kind,text) values(?,?,?,?)").run(id, p, "text", text);
  })();
  log(id, who(q), "project", "", name);
  r.json({id});
});
app.delete("/api/projects/:id", (q, r) => {
  const id = q.params.id;
  db.prepare("delete from projects where id=?").run(id);
  db.prepare("delete from files where project=?").run(id);
  db.prepare("delete from activity where project=?").run(id);
  db.prepare("delete from snaps where project=?").run(id);
  db.prepare("delete from thumbs where project=?").run(id);
  try { db.prepare("delete from gh_links where project=?").run(id); } catch {}
  agent?.forgetProject(id); dropBuild(id);
  db.prepare("delete from docs where name like ?").run(id + "/%");
  db.prepare("delete from versions where doc like ?").run(id + "/%");
  gcBlobs();
  r.sendStatus(204);
});

// Archivos del proyecto (árbol)
app.get("/api/projects/:id/files", (q, r) =>
  r.json(db.prepare("select path,kind from files where project=? order by path").all(q.params.id)));
app.get("/api/files/text", (q, r) => {
  const {project, path} = q.query;
  if (!getFile(project, path)) return r.sendStatus(404);
  r.json({text: getDocText(`${project}/${path}`)});
});

app.get("/api/files/raw", (q, r) => {
  const {project, path} = q.query;
  const f = db.prepare("select kind,data from files where project=? and path=?").get(project, path);
  if (!f || f.kind !== "bin") return r.sendStatus(404);
  const ext = (path.match(/\.([^.\/]+)$/) || [])[1]?.toLowerCase();
  const types = {pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp"};
  r.set({"Content-Type": types[ext] || "application/octet-stream", "Content-Security-Policy": "sandbox"}).send(f.data);
});

// ¿Choca una ruta con lo que ya hay? (mismo nombre, o archivo y carpeta con el mismo nombre)
const clashes = (paths, path) => paths.some(p => p === path || p.startsWith(path + "/") || path.startsWith(p + "/"));

function deleteFile(project, path) {
  const name = project + "/" + path;
  db.prepare("delete from files where project=? and path=?").run(project, path);
  db.prepare("delete from docs where name=?").run(name);
  db.prepare("delete from versions where doc=?").run(name);
  track.delete(name);
  hp.closeConnections(name);
}

app.post("/api/files", (q, r) => {
  const {project, path, kind, text, data, replace, how} = q.body;
  if (!okPath(path)) return r.status(400).json({error: BAD_PATH});
  if (kind !== "text" && kind !== "bin") return r.status(400).json({error: "Tipo de archivo no válido"});
  if (!db.prepare("select 1 from projects where id=?").get(project)) return r.status(404).json({error: "El proyecto no existe"});
  const all = db.prepare("select path,kind from files where project=?").all(project);
  const same = all.find(f => f.path === path);
  if (same && !(replace && kind === "bin" && same.kind === "bin"))
    return r.status(409).json({error: `Ya existe «${path}».`, exists: same.kind});
  if (!same && clashes(all.map(f => f.path), path))
    return r.status(409).json({error: `«${path}» choca con una carpeta o archivo que ya existe.`});
  const before = takeSnapshot(project);   // cómo estaba el proyecto antes de este cambio
  const buf = kind === "bin" ? Buffer.from(data, "base64") : null;
  db.prepare("insert or replace into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)")
    .run(project, path, kind, kind === "text" ? text || "" : null, buf, buf ? sha1(buf) : null);
  touch(project);
  log(project, who(q), same ? "replace" : how === "upload" ? "upload" : "create", path, "", before);
  r.json({ok: true});
});
app.delete("/api/files", (q, r) => {
  const {project, path} = q.query;
  const existed = getFile(project, path), before = existed ? takeSnapshot(project) : null;
  deleteFile(project, path);
  touch(project);
  if (existed) log(project, who(q), "delete", path, "", before);
  r.sendStatus(204);
});

// Renombrar o mover un archivo o una carpeta entera (el historial y la edición en vivo se conservan)
function moveFiles(project, from, to, me, record = true) {
  if (!okPath(from) || !okPath(to)) return {status: 400, error: BAD_PATH};
  if (from === to) return {moved: []};
  if (to.startsWith(from + "/")) return {status: 400, error: "No se puede mover una carpeta dentro de sí misma."};
  const all = db.prepare("select * from files where project=?").all(project);
  const rows = all.filter(f => f.path === from || f.path.startsWith(from + "/"));
  if (!rows.length) return {status: 404, error: "Ese archivo o carpeta ya no existe."};
  const moving = new Set(rows.map(f => f.path));
  const rest = all.map(f => f.path).filter(p => !moving.has(p));
  const map = rows.map(f => ({...f, newPath: to + f.path.slice(from.length)}));
  for (const m of map) if (clashes(rest, m.newPath))
    return {status: 409, error: `Ya existe «${m.newPath}» (o choca con una carpeta del mismo nombre).`};
  if (map.some(m => moving.has(m.newPath)))
    return {status: 409, error: "Ese movimiento haría que unos archivos ocupen el sitio de otros. Hazlo en dos pasos."};

  for (const m of map) if (m.kind === "text") flushPending(`${project}/${m.path}`);   // lo último escrito queda en el historial
  const before = record ? takeSnapshot(project) : null;
  // Estado más reciente de los documentos abiertos ahora mismo, aunque aún no se hayan guardado
  const live = new Map();
  for (const m of map) {
    const d = m.kind === "text" && hp.documents.get(`${project}/${m.path}`);
    if (d) live.set(m.path, {text: d.getText("src").toString(), state: Y.encodeStateAsUpdate(d)});
  }
  const names = map.map(m => ({from: `${project}/${m.path}`, to: `${project}/${m.newPath}`}));
  const oldNames = new Set(names.map(n => n.from));
  const mainHit = map.find(m => m.path === mainOf(project));
  db.transaction(() => {
    if (mainHit) db.prepare("update projects set main=? where id=?").run(mainHit.newPath === "main.tex" ? null : mainHit.newPath, project);   // el archivo principal sigue siéndolo si cambia de nombre o carpeta
    db.prepare("delete from files where project=? and (path=? or substr(path,1,?)=?)").run(project, from, from.length + 1, from + "/");
    for (const m of map)
      db.prepare("insert into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)")
        .run(project, m.newPath, m.kind, live.get(m.path)?.text ?? m.text, m.data, m.hash);
    // Restos de archivos que existieron antes con el nombre de destino
    for (const n of names) if (!oldNames.has(n.to)) {
      db.prepare("delete from docs where name=?").run(n.to);
      db.prepare("delete from versions where doc=?").run(n.to);
    }
    // En dos pasos para que nombres que se solapan no choquen
    names.forEach((n, i) => {
      db.prepare("update docs set name=? where name=?").run("\u0001" + i, n.from);
      db.prepare("update versions set doc=? where doc=?").run("\u0001" + i, n.from);
    });
    names.forEach((n, i) => {
      db.prepare("update docs set name=? where name=?").run(n.to, "\u0001" + i);
      db.prepare("update versions set doc=? where doc=?").run(n.to, "\u0001" + i);
    });
    for (const m of map) if (live.has(m.path))
      db.prepare("insert or replace into docs values(?,?)").run(`${project}/${m.newPath}`, live.get(m.path).state);
    touch(project);
  })();
  if (record) log(project, me, "move", from, to + (map.length > 1 ? ` (${map.length} archivos)` : ""), before);
  for (const n of names) hp.closeConnections(n.from);   // quien lo tenía abierto verá que el archivo cambió de sitio
  return {moved: map.map(m => ({from: m.path, to: m.newPath}))};
}
app.post("/api/files/move", (q, r) => {
  const res = moveFiles(q.body.project, q.body.from, q.body.to, who(q));
  res.error ? r.status(res.status).json({error: res.error}) : r.json({moved: res.moved});
});

// ---------- Historial ----------
// Línea de tiempo del proyecto: versiones de todos los archivos y altas, bajas y movimientos
app.get("/api/projects/:id/history", (q, r) => {
  const id = q.params.id, pre = id + "/";
  ensureStats(id);
  const vs = db.prepare("select id,doc,t,author,label,auto,stats,snap from versions where substr(doc,1,?)=? order by t desc, id desc limit 400").all(pre.length, pre);
  const es = db.prepare("select id,t,author,kind,path,detail,snap from activity where project=? order by t desc, id desc limit 400").all(id);
  r.json([
    ...vs.map(v => ({type: "v", id: v.id, t: v.t, author: v.author, path: v.doc.slice(pre.length), label: v.label, auto: !!v.auto, stats: JSON.parse(v.stats || "null"), snap: v.snap})),
    ...es.map(e => ({type: "e", ...e})),
  ].sort((a, b) => b.t - a.t || (a.type < b.type ? 1 : -1)).slice(0, 500));
});
// Una versión con la anterior del mismo archivo, para ver el diff
app.get("/api/versions/:id", (q, r) => {
  const v = db.prepare("select * from versions where id=?").get(q.params.id);
  if (!v) return r.sendStatus(404);
  const prev = db.prepare("select id,t,author,label,text from versions where doc=? and id<? order by id desc limit 1").get(v.doc, v.id);
  const [project, path] = split(v.doc);
  r.json({id: v.id, project, path, t: v.t, author: v.author, label: v.label, auto: !!v.auto, text: v.text, snap: v.snap,
    stats: JSON.parse(v.stats || "null"), prev: prev || null, exists: !!getFile(project, path)});
});
// Restaurar un archivo a esa versión: los coautores conectados ven el cambio al instante
app.post("/api/versions/:id/restore", async (q, r) => {
  const v = db.prepare("select * from versions where id=?").get(q.params.id);
  if (!v) return r.status(404).json({error: "Esa versión ya no existe."});
  const [project, path] = split(v.doc), me = who(q);
  if (!getFile(project, path)) return r.status(404).json({error: "El archivo ya no existe."});
  try {
    flushPending(v.doc);
    const now = getDocText(v.doc);
    if (now !== lastVersion(v.doc)?.text) addVersion(v.doc, "", "Estado antes de restaurar", true, now);
    await setDocText(v.doc, v.text, me);
    const id = addVersion(v.doc, me, "Restaurada: " + (v.label || fecha(v.t)), false, v.text);
    track.delete(v.doc);
    touch(project);
    r.json({ok: true, id});
  } catch (e) {
    r.status(500).json({error: "No se pudo restaurar: " + e.message});
  }
});
app.get("/api/versions", (q, r) => r.json(db.prepare("select * from versions where doc=? order by t").all(q.query.doc)));
// Versión con nombre
app.post("/api/versions", (q, r) => {
  const {doc, label} = q.body, [project, path] = split(String(doc || ""));
  if (!getFile(project, path)) return r.status(404).json({error: "El archivo ya no existe."});
  flushPending(doc);   // lo que ya habían escrito otros queda en su propia versión
  const id = addVersion(doc, who(q), String(label || "").slice(0, 120) || "Versión guardada", false, getDocText(doc));
  touch(project);
  r.status(201).json({id});
});

// ---------- Restaurar el proyecto completo ----------
// Qué cambiaría si se volviera al estado de esa copia
app.get("/api/snaps/:id/preview", (q, r) => {
  const s = db.prepare("select * from snaps where id=?").get(q.params.id);
  if (!s || !db.prepare("select 1 from projects where id=?").get(s.project)) return r.status(404).json({error: "Esa copia del proyecto ya no existe."});
  const pl = plan(s.project, JSON.parse(s.manifest));
  r.json({
    when: s.t,
    update: pl.update.map(p => {
      if (pl.tgt.get(p).kind !== "text") return {path: p, bin: true};
      const st = diffStats(getDocText(`${s.project}/${p}`), getBlob(pl.tgt.get(p).h).toString("utf8"));
      return {path: p, a: st.a, r: st.r};
    }),
    create: pl.create, remove: pl.remove, rename: pl.rename,
  });
});
// Dejar todos los archivos como en esa copia. Antes se guarda el estado actual para poder deshacerlo.
app.post("/api/snaps/:id/restore", async (q, r) => {
  const s = db.prepare("select * from snaps where id=?").get(q.params.id);
  if (!s || !db.prepare("select 1 from projects where id=?").get(s.project)) return r.status(404).json({error: "Esa copia del proyecto ya no existe."});
  const project = s.project, me = who(q);
  try {
    const before = takeSnapshot(project);
    const pl = plan(project, JSON.parse(s.manifest));
    const changed = pl.update.length + pl.create.length + pl.remove.length + pl.rename.length;
    if (!changed) return r.json({ok: true, changed: 0});
    const label = "Proyecto restaurado: " + fecha(s.t), ids = [];
    for (const p of pl.remove) { if (pl.cur.get(p).kind === "text") flushPending(`${project}/${p}`); deleteFile(project, p); }
    for (const [from, to] of pl.rename) {
      const res = moveFiles(project, from, to, me, false);
      if (res.error) { deleteFile(project, from); pl.create.push(to); }   // si no se puede renombrar, se borra y se vuelve a crear
    }
    for (const p of pl.update) {
      const t = pl.tgt.get(p), data = getBlob(t.h), name = `${project}/${p}`;
      if (t.kind === "text") {
        flushPending(name);
        await setDocText(name, data.toString("utf8"), me);
        ids.push(addVersion(name, me, label, false, data.toString("utf8"), undefined, false));
      } else db.prepare("update files set data=?, hash=? where project=? and path=?").run(data, t.h, project, p);
    }
    for (const p of pl.create) {
      const t = pl.tgt.get(p), data = getBlob(t.h), name = `${project}/${p}`;
      db.prepare("delete from docs where name=?").run(name);
      db.prepare("delete from versions where doc=?").run(name);
      db.prepare("insert or replace into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)")
        .run(project, p, t.kind, t.kind === "text" ? data.toString("utf8") : null, t.kind === "bin" ? data : null, t.kind === "bin" ? t.h : null);
    }
    const after = takeSnapshot(project);   // las versiones creadas aquí apuntan al proyecto ya restaurado
    for (const id of ids) db.prepare("update versions set snap=? where id=?").run(after, id);
    touch(project);
    log(project, me, "restore-project", "", "al estado del " + fecha(s.t), before);
    r.json({ok: true, changed});
  } catch (e) {
    r.status(500).json({error: "No se pudo restaurar el proyecto: " + e.message + ". Se guardó una copia del estado anterior en el historial."});
  }
});

// Última compilación de cada proyecto (carpeta temporal), para consultar SyncTeX
const builds = new Map();   // proyecto → {dir, base}
function dropBuild(project) { const d = builds.get(project)?.dir; if (d) { try { rmSync(d, {recursive: true, force: true}); } catch {} builds.delete(project); } }
process.on("exit", () => { for (const b of builds.values()) try { rmSync(b.dir, {recursive: true, force: true}); } catch {} });
let closing = false;
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, async () => {
  if (closing) return; closing = true;
  try { await Promise.race([hp.destroy(), new Promise(r => setTimeout(r, 4000))]); } catch {}   // guarda lo último que se estaba editando
  process.exit(0);
});
const synctex = (project, args) => new Promise((ok, no) => {
  const b = builds.get(project);
  if (!b) return no(new Error("Compila primero el proyecto."));
  execFile("synctex", args.map(a => a === "@PDF" ? b.base + ".pdf" : a.replace("@PDF", b.base + ".pdf")), {cwd: b.dir, timeout: 10000}, (err, out) => err ? no(err) : ok({out, dir: b.dir}));
});
const field = (out, k) => (new RegExp("^" + k + ":(.*)$", "m").exec(out) || [])[1];
// Del código al PDF: dónde cae una línea del código en la página
app.post("/api/synctex/forward", async (q, r) => {
  const {project, file} = q.body, line = Math.floor(+q.body.line), col = Math.max(0, Math.floor(+q.body.col) || 0);
  if (!okPath(file) || !(line >= 1)) return r.status(400).json({error: "Datos no válidos."});
  try {
    const {out} = await synctex(project, ["view", "-i", `${line}:${col}:${file}`, "-o", "@PDF"]);
    const page = +field(out, "Page");
    if (!page) return r.json({none: true});
    const n = k => +field(out, k) || 0;
    r.json({page, x: n("x"), y: n("y"), h: n("h"), v: n("v"), W: n("W"), H: n("H")});
  } catch (e) { r.status(e.message.startsWith("Compila") ? 409 : 500).json({error: e.message.startsWith("Compila") ? e.message : "No se pudo consultar SyncTeX."}); }
});
// Del PDF al código: qué línea produjo ese punto de la página
app.post("/api/synctex/inverse", async (q, r) => {
  const {project} = q.body, page = Math.floor(+q.body.page), x = +q.body.x, y = +q.body.y;
  if (!(page >= 1) || !isFinite(x) || !isFinite(y)) return r.status(400).json({error: "Datos no válidos."});
  try {
    const {out, dir} = await synctex(project, ["edit", "-o", `${page}:${x.toFixed(2)}:${y.toFixed(2)}:@PDF`]);
    const input = field(out, "Input"), line = +field(out, "Line");
    if (!input || !(line >= 1)) return r.json({none: true});
    // SyncTeX devuelve la ruta absoluta de la carpeta temporal, que en macOS puede venir como /private/var/… en vez de /var/…:
    // se compara contra las dos formas y, si no coincide, contra el final de la ruta.
    const abs = resolve(dir, input).split(sep).join("/");
    let real = dir; try { real = realpathSync(dir); } catch {}
    const paths = db.prepare("select path from files where project=?").all(project).map(f => f.path);
    let rel = paths.find(p => [dir, real].some(d => abs === resolve(d, p).split(sep).join("/")));
    if (!rel) rel = paths.filter(p => abs === p || abs.endsWith("/" + p)).sort((a, b) => b.length - a.length)[0];
    if (!rel) return r.json({none: true, outside: true});
    r.json({file: rel, line});
  } catch (e) { r.status(e.message.startsWith("Compila") ? 409 : 500).json({error: e.message.startsWith("Compila") ? e.message : "No se pudo consultar SyncTeX."}); }
});


// ---------- Buscar y reemplazar en todo el proyecto ----------
function searchRegex(b) {
  const q = String(b.q ?? ""); if (!q) return null;
  let src = b.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (b.word) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, "gmu" + (b.case ? "" : "i"));
}
const projectTexts = project => db.prepare("select path from files where project=? and kind='text' order by path").all(project).map(f => ({path: f.path, text: getDocText(`${project}/${f.path}`)}));
app.post("/api/projects/:id/search", (q, r) => {
  let re; try { re = searchRegex(q.body); } catch (e) { return r.status(400).json({error: "Expresión regular no válida: " + e.message}); }
  if (!re) return r.json({files: [], total: 0});
  const out = []; let total = 0;
  for (const f of projectTexts(q.params.id)) {
    const lines = f.text.split("\n"), hits = []; let n = 0;
    lines.forEach((ln, i) => {
      re.lastIndex = 0; let m, first = null, c = 0;
      while ((m = re.exec(ln)) && c < 50) { if (!m[0]) { re.lastIndex++; continue; } c++; if (first === null) first = m.index; }
      if (c) { n += c; if (hits.length < 200) hits.push({line: i + 1, col: first, text: ln.slice(0, 300)}); }
    });
    if (n) { out.push({path: f.path, n, hits}); total += n; }
  }
  r.json({files: out, total});
});
app.post("/api/projects/:id/replace", async (q, r) => {
  const project = q.params.id; let re;
  try { re = searchRegex(q.body); } catch (e) { return r.status(400).json({error: "Expresión regular no válida: " + e.message}); }
  if (!re) return r.status(400).json({error: "Escribe qué buscar."});
  const rep = String(q.body.replace ?? ""), only = Array.isArray(q.body.paths) ? new Set(q.body.paths) : null, me = who(q);
  const plan = [];
  for (const f of projectTexts(project)) {
    if (only && !only.has(f.path)) continue;
    let n = 0; const text = f.text.replace(re, (...a) => { n++; return q.body.regex ? a[0].replace(new RegExp(re.source, re.flags.replace("g", "")), rep) : rep; });
    if (n && text !== f.text) plan.push({...f, text, n});
  }
  if (!plan.length) return r.json({changed: 0, files: 0});
  try {
    const before = takeSnapshot(project); let count = 0;
    for (const f of plan) {
      const name = `${project}/${f.path}`;
      flushPending(name);
      if (f.text0 === undefined) { const now = getDocText(name); if (now !== lastVersion(name)?.text) addVersion(name, "", "Estado antes de reemplazar", true, now); }
      await setDocText(name, f.text, me);
      addVersion(name, me, `Reemplazar «${String(q.body.q).slice(0, 40)}» → «${rep.slice(0, 40)}»`, false, f.text);
      track.delete(name); count += f.n;
    }
    touch(project);
    log(project, me, "replace", "", `«${String(q.body.q).slice(0, 60)}» → «${rep.slice(0, 60)}» (${count} en ${plan.length} archivos)`, before);
    r.json({changed: count, files: plan.length});
  } catch (e) { r.status(500).json({error: "No se pudo reemplazar: " + e.message}); }
});


// ---------- Referencias cruzadas: etiquetas, citas, archivos ----------
const stripComments = t => t.replace(/(^|[^\\])%.*$/gm, "$1");
const REFCMDS = "ref|eqref|autoref|cref|Cref|vref|pageref|nameref|subref|labelcref|cpageref";
const CITECMDS = "cite[a-zA-Z]*|nocite|parencite|textcite|autocite|footcite|smartcite|supercite|citeauthor|citeyear|citetitle|fullcite";
function analyzeXref(project) {
  const labels = [], refs = [], cites = [], bibs = [], incs = [], dupL = new Map(), files = new Set();
  const all = db.prepare("select path,kind from files where project=?").all(project);
  for (const f of all) files.add(f.path);
  const lineOf = (text, idx) => { let n = 1; for (let i = text.indexOf("\n"); i >= 0 && i < idx; i = text.indexOf("\n", i + 1)) n++; return n; };
  for (const f of projectTexts(project)) {
    if (/\.bib$/i.test(f.path)) {
      for (const m of f.text.matchAll(/^\s*@(?!comment|string|preamble)(\w+)\s*[{(]\s*([^,\s]+)\s*,/gim)) bibs.push({key: m[2], file: f.path, line: lineOf(f.text, m.index), type: m[1].toLowerCase()});
      continue;
    }
    if (!/\.(tex|sty|cls)$/i.test(f.path)) continue;
    const t = stripComments(f.text);
    for (const m of t.matchAll(/\\label\s*\{([^}]+)\}/g)) labels.push({key: m[1].trim(), file: f.path, line: lineOf(t, m.index)});
    for (const m of t.matchAll(new RegExp(`\\\\(?:${REFCMDS})\\*?\\s*\\{([^}]+)\\}`, "g"))) for (const k of m[1].split(",")) if (k.trim()) refs.push({key: k.trim(), file: f.path, line: lineOf(t, m.index)});
    for (const m of t.matchAll(new RegExp(`\\\\(?:${CITECMDS})\\*?\\s*(?:\\[[^\\]]*\\]\\s*){0,2}\\{([^}]+)\\}`, "g"))) for (const k of m[1].split(",")) if (k.trim()) cites.push({key: k.trim(), file: f.path, line: lineOf(t, m.index), nocite: /nocite/.test(m[0].slice(0, 9))});
    for (const m of t.matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) bibs.push({key: m[1].trim(), file: f.path, line: lineOf(t, m.index), type: "bibitem"});
    for (const m of t.matchAll(/\\(input|include|subfile|includegraphics|bibliography|addbibresource)\*?\s*(?:\[[^\]]*\])*\s*\{([^}]+)\}/g)) {
      const kind = m[1], line = lineOf(t, m.index);
      for (const nm of (kind === "bibliography" ? m[2].split(",") : [m[2]])) {
        const name = nm.trim().replace(/^\.\//, ""); if (!name) continue;
        const cand = kind === "input" || kind === "include" || kind === "subfile" ? [name, name + ".tex"]
          : kind === "includegraphics" ? [name, ...["png", "jpg", "jpeg", "pdf", "gif", "webp", "svg", "eps"].map(e => `${name}.${e}`)]
          : [name, name + ".bib"];
        const hit = cand.find(c => files.has(c));
        incs.push({kind, name, file: f.path, line, target: hit || null});
      }
    }
  }
  const lab = new Set(labels.map(l => l.key)), bib = new Set(bibs.map(b => b.key)), usedL = new Set(refs.map(r => r.key));
  const usedC = new Set(cites.map(c => c.key)), star = cites.some(c => c.key === "*");
  for (const l of labels) dupL.set(l.key, (dupL.get(l.key) || 0) + 1);
  const dupB = new Map(); for (const b of bibs) dupB.set(b.key, (dupB.get(b.key) || 0) + 1);
  const hasBib = bibs.length > 0;
  return {
    labels, bibs, incs, refs, cites,
    problems: {
      undefinedRefs: refs.filter(r => !lab.has(r.key)),
      undefinedCites: hasBib || incs.some(i => i.kind === "bibliography" || i.kind === "addbibresource") ? cites.filter(c => c.key !== "*" && !bib.has(c.key)) : [],
      missingFiles: incs.filter(i => !i.target && i.kind !== "bibliography" && i.kind !== "addbibresource").concat(incs.filter(i => !i.target && (i.kind === "bibliography" || i.kind === "addbibresource"))),
      dupLabels: labels.filter(l => dupL.get(l.key) > 1),
      dupBib: bibs.filter(b => dupB.get(b.key) > 1 && b.type !== "bibitem"),
      unusedLabels: labels.filter(l => !usedL.has(l.key)),
      unusedBib: star ? [] : bibs.filter(b => !usedC.has(b.key)),
    },
  };
}
app.get("/api/projects/:id/xref", (q, r) => {
  const a = analyzeXref(q.params.id), p = a.problems;
  r.json({...a, refs: a.refs, cites: a.cites, counts: {errors: p.undefinedRefs.length + p.undefinedCites.length + p.missingFiles.length + p.dupLabels.length, info: p.unusedLabels.length + p.unusedBib.length}});
});

// ---------- Conteo de palabras ----------
function countWords(src) {
  let t = String(src).replace(/(?<!\\)%.*$/gm, "");
  const body = t.match(/\\begin\{document\}([\s\S]*)\\end\{document\}/); if (body) t = body[1];
  t = t.replace(/\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|displaymath|verbatim|lstlisting|tikzpicture|thebibliography)\}[\s\S]*?\\end\{\1\}/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]*\$/g, " ")
    .replace(/\\(?:cite|ref|eqref|label|includegraphics|input|include|usepackage|documentclass|bibliography|bibliographystyle|url|pageref|autoref|cref)\*?(?:\[[^\]]*\])*\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+\*?/g, " ").replace(/[{}\\&~^_#]/g, " ");
  return (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
}
app.get("/api/projects/:id/stats", (q, r) => {
  const per = {}; let total = 0;
  for (const f of projectTexts(q.params.id)) if (TEXMAIN.test(f.path)) { per[f.path] = countWords(f.text); total += per[f.path]; }
  r.json({words: total, per});
});

// Diccionarios del corrector ortográfico (vienen en node_modules; se descargan una vez al navegador)
const DICT_LANGS = new Set(["es", "en", "en-gb", "fr", "de", "pt", "it", "ca"]);
app.get("/api/dict/:lang/:file", (q, r) => {
  const {lang, file} = q.params, f = join(dirname(fileURLToPath(import.meta.url)), "node_modules", "dictionary-" + lang, file);
  if (!DICT_LANGS.has(lang) || !["index.aff", "index.dic"].includes(file) || !existsSync(f)) return r.sendStatus(404);
  r.set("Cache-Control", "private, max-age=86400").type("text/plain; charset=utf-8").sendFile(f);
});

// Miniaturas de la primera página (solo en esta computadora; no se sincronizan: se regeneran al compilar)
db.exec("create table if not exists thumbs(project text primary key, t integer, img blob)");
app.post("/api/projects/:id/thumb", (q, r) => {
  const buf = Buffer.from(String(q.body.img || ""), "base64");
  if (!buf.length || buf.length > 400e3 || buf[0] !== 0xff || buf[1] !== 0xd8) return r.status(400).json({error: "Miniatura no válida."});
  if (!db.prepare("select 1 from projects where id=?").get(q.params.id)) return r.sendStatus(404);
  db.prepare("insert or replace into thumbs(project,t,img) values(?,?,?)").run(q.params.id, Date.now(), buf);
  r.json({ok: true});
});
app.get("/api/thumbs", (q, r) => r.json(Object.fromEntries(db.prepare("select project,img from thumbs").all().map(t => [t.project, "data:image/jpeg;base64," + t.img.toString("base64")]))));

// Vista rápida: compilar solo el capítulo abierto. Con \include se usa \includeonly (se conservan numeración y referencias gracias a los .aux de la
// última compilación completa); con \input se omiten los demás capítulos.
function quickMain(project, mainText, onlyPath, paths) {
  const t = mainText.replace(/(^|[^\\])%.*$/gm, "$1");
  const bd = t.search(/\\begin\{document\}/); if (bd < 0) return null;
  const resolve = n => { n = n.trim().replace(/^\.\//, ""); return [n, n + ".tex"].find(c => paths.has(c)); };
  const incs = [...mainText.matchAll(/\\(include|input)\s*\{([^}]+)\}/g)].map(m => ({kind: m[1], name: m[2].trim(), at: m.index, len: m[0].length, target: resolve(m[2])}));
  const mine = incs.filter(i => i.target === onlyPath); if (!mine.length) return null;
  const bodyStart = mainText.search(/\\begin\{document\}/);
  // Numeración: se suman los capítulos (o secciones) de los archivos anteriores para que el abierto conserve su número
  const own = String(projectTextMap.get(onlyPath) || ""), unit = /\\chapter\b/.test(own) ? "chapter" : /\\section\b/.test(own) ? "section" : null;
  const first = mine[0].at; let before = 0;
  if (unit) for (const i of incs) if (i.at > bodyStart && i.at < first && i.target && i.target !== onlyPath)
    before += (String(projectTextMap.get(i.target) || "").replace(/(^|[^\\])%.*$/gm, "$1").match(new RegExp("\\\\" + unit + "\\s*(\\[[^\\]]*\\])?\\s*\\{", "g")) || []).length;
  const setc = unit && before ? `\\setcounter{${unit}}{${before}}\n` : "";
  if (mine.some(i => i.kind === "include")) {
    const keep = mine.filter(i => i.kind === "include").map(i => i.name).join(",");
    const noOld = mainText.replace(/\\includeonly\s*\{[^}]*\}/g, m => "%".padEnd(m.length, " "));
    const ins = noOld.slice(0, bodyStart) + `\\includeonly{${keep}}` + noOld.slice(bodyStart);
    const k = ins.indexOf(mine.find(i => i.kind === "include").name, ins.indexOf("\\begin{document}")), ln = ins.lastIndexOf("\\include", k);
    return {text: setc && ln > 0 ? ins.slice(0, ln) + setc + ins.slice(ln) : ins, mode: "includeonly"};
  }
  let out = mainText;
  const heavy = f => /\\(chapter|section|part)\b/.test(String(projectTextMap.get(f) || ""));
  for (const i of incs) {
    if (i.at < bodyStart || i.target === onlyPath || !i.target || i.kind !== "input" || !heavy(i.target)) continue;
    const blank = "%" + " ".repeat(Math.max(0, i.len - 1));
    out = out.slice(0, i.at) + blank + out.slice(i.at + i.len);
  }
  if (setc) { const ln = out.indexOf("\\input", out.indexOf("\\begin{document}")); const at = mine[0].at; const q = out.lastIndexOf("\\input", at + 1); out = out.slice(0, q >= 0 ? q : at) + setc + out.slice(q >= 0 ? q : at); }
  return {text: out, mode: "input"};
}
let projectTextMap = new Map();
function copyAux(from, to) {
  const walk = (d, rel = "") => { for (const e of readdirSync(join(d, rel), {withFileTypes: true})) {
    const p = join(rel, e.name);
    if (e.isDirectory()) walk(d, p);
    else if (/\.aux$/.test(e.name)) { mkdirSync(dirname(join(to, p)), {recursive: true}); copyFileSync(join(d, p), join(to, p)); }
  } };
  try { walk(from); } catch {}
}

// Compilación: reconstruye todo el proyecto en una carpeta temporal y compila main.tex
let busy = false;
app.post("/api/compile", (q, r) => {
  if (busy) return r.status(429).json({log: "Hay otra compilación en curso. Inténtalo de nuevo en unos segundos."});
  const {project, path, text} = q.body, only = typeof q.body.only === "string" ? q.body.only : null;
  const files = db.prepare("select path,kind,text,data from files where project=?").all(project);
  // Se compila el archivo abierto si es un documento completo (tiene \documentclass); si es un capítulo o no hay ninguno abierto, el archivo principal del proyecto
  const isDoc = f => f && f.kind === "text" && TEXMAIN.test(f.path) && /^[^%\n]*\\documentclass/m.test(String(f.path === path && text != null ? text : f.text || "").replace(/%.*$/gm, ""));
  const open = typeof path === "string" ? files.find(f => f.path === path) : null;
  const main = isDoc(open) ? open.path : mainOf(project), base = main.split("/").at(-1).replace(/\.[^.]*$/, "");
  if (!files.some(f => f.path === main))
    return r.status(422).json({log: `El archivo principal «${main}» no existe. Elige otro con el botón «Principal» de la barra del PDF (o con la ☆ junto a un archivo del árbol).`});
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "tex-"));
  for (const f of files) {
    const p = join(dir, f.path); mkdirSync(dirname(p), {recursive: true});
    const live = f.kind === "text" && hp.documents.get(`${project}/${f.path}`);   // texto más reciente de cada coautor
    writeFileSync(p, f.path === path && text != null ? text : f.kind === "bin" ? f.data : live ? live.getText("src").toString() : f.text || "");
  }
  let partial = null;
  const prev = builds.get(project);
  if (only && only !== main && prev && prev.base === base) {
    const live = p => { const f = files.find(x => x.path === p); const d = hp.documents.get(`${project}/${p}`); return p === path && text != null ? text : d ? d.getText("src").toString() : f?.text || ""; };
    projectTextMap = new Map(files.filter(f => f.kind === "text").map(f => [f.path, live(f.path)]));
    const qm = quickMain(project, live(main), only, new Set(files.map(f => f.path)));
    if (qm) { writeFileSync(join(dir, main), qm.text); if (qm.mode === "includeonly") copyAux(prev.dir, dir); partial = {only, mode: qm.mode}; }
  }
  const eng = db.prepare("select engine from projects where id=?").get(project)?.engine;
  const flags = "-no-shell-escape -interaction=nonstopmode -file-line-error -synctex=1 %O %S";
  const eargs = eng === "xelatex" ? ["-norc", "-xelatex", `-xelatex=xelatex ${flags}`] : eng === "lualatex" ? ["-norc", "-lualatex", `-lualatex=lualatex ${flags}`] : ["-norc", "-pdf", `-pdflatex=pdflatex ${flags}`];
  execFile("latexmk", [...eargs, main],
    {cwd: dir, timeout: 60000}, (err) => {
      busy = false;
      let pdf = null, out = "";
      try { pdf = readFileSync(join(dir, base + ".pdf")); } catch {}
      try { out = readFileSync(join(dir, base + ".log"), "utf8"); } catch { out = err ? "No se pudo ejecutar latexmk. ¿Está instalado TeX Live?\n" + err.message : ""; }
      const sync = !!pdf && existsSync(join(dir, base + ".synctex.gz"));
      if (sync) { dropBuild(project); builds.set(project, {dir, base}); while (builds.size > 6) dropBuild(builds.keys().next().value); }   // se conserva la última compilación para saltar entre código y PDF
      else rmSync(dir, {recursive: true, force: true});
      pdf ? r.json({pdf: pdf.toString("base64"), log: out.slice(-400000), failed: !!err, sync, main, partial})   // con errores leves LaTeX igual produce PDF
          : r.status(422).json({log: out.slice(-400000), main});
    });
});
// Comprobación de compilación para el asistente: ¿compila el documento con los cambios propuestos? (no toca nada; usa una carpeta temporal)
function latexErrors(log) {
  const out = new Set();
  for (const m of String(log).matchAll(/^(?:\.\/)?([^\s:][^:\n]*):(\d+): (.+)$/gm)) out.add(`${m[1]}:${m[2]}: ${m[3].trim()}`);
  if (!out.size) for (const m of String(log).matchAll(/^! (.+)$/gm)) out.add(m[1].trim());
  return [...out];
}
function runTexDir(map, main) {                       // map: path → {kind, text|data}; devuelve {pdf, errors}
  return new Promise(done => {
    const dir = mkdtempSync(join(tmpdir(), "texchk-"));
    try {
      for (const [path, f] of map) { const p = join(dir, path); mkdirSync(dirname(p), {recursive: true}); writeFileSync(p, f.kind === "bin" ? f.data : f.text || ""); }
    } catch (e) { rmSync(dir, {recursive: true, force: true}); return done(null); }
    const base = main.split("/").at(-1).replace(/\.[^.]*$/, "");
    execFile("latexmk", ["-norc", "-pdf", "-pdflatex=pdflatex -no-shell-escape -interaction=nonstopmode -file-line-error %O %S", main], {cwd: dir, timeout: 45000}, err => {
      let log = "", pdf = false;
      try { pdf = existsSync(join(dir, base + ".pdf")); } catch {}
      try { log = readFileSync(join(dir, base + ".log"), "utf8"); } catch {}
      rmSync(dir, {recursive: true, force: true});
      done({pdf, errors: latexErrors(log), timeout: !!err?.killed});
    });
  });
}
async function texCheck(project, openPath, overrides) {
  if (busy) return null;
  const rows = db.prepare("select path,kind,text,data from files where project=?").all(project);
  const before = new Map(rows.map(f => [f.path, f.kind === "bin" ? {kind: "bin", data: f.data} : {kind: "text", text: hp.documents.get(`${project}/${f.path}`)?.getText("src").toString() ?? f.text ?? ""}]));
  const after = new Map(before);
  for (const [p, t] of overrides) { if (t === null) after.delete(p); else after.set(p, {kind: "text", text: t}); }
  const docOf = (map, p) => { const f = map.get(p); return f && f.kind === "text" && TEXMAIN.test(p) && /^[^%\n]*\\documentclass/m.test(String(f.text || "").replace(/%.*$/gm, "")); };
  const main = openPath && docOf(after, openPath) ? openPath : mainOf(project);
  if (!after.has(main)) return null;
  busy = true;
  try {
    const a = await runTexDir(after, main);
    if (!a) return null;
    if (a.timeout) return {state: "skip", main};
    if (a.pdf && !a.errors.length) return {state: "ok", main};
    // Con errores: ¿ya estaban antes de los cambios?
    const b = before.has(main) ? await runTexDir(before, main) : null;
    const old = new Set(b?.errors || []), strip = e => e.replace(/^[^:]+:\d+: /, "");
    const oldMsgs = new Set([...old].map(strip)), fresh = a.errors.filter(e => !old.has(e) && !oldMsgs.has(strip(e)));
    return {state: fresh.length || !a.errors.length ? "new" : "same", main, errors: (fresh.length ? fresh : a.errors).slice(0, 5), before: old.size, nopdf: !a.pdf};
  } finally { busy = false; }
}
// Asistente de Claude (solo desde esta computadora; ver agent.js)
const agent = registerAgent(app, {db, hp, who, okPath, clashes, getFile, getDocText, lastVersion, addVersion, flushPending, setDocText, takeSnapshot, touch, log, deleteFile, track, lineDiff, verify: texCheck});
registerZip(app, {db, getDocText, who, log, clashes, okPath});
registerBib(app, {db, who, okPath, clashes, getFile, getDocText, lastVersion, addVersion, flushPending, setDocText, takeSnapshot, touch, log, track});
registerZotero(app, {db, who, okPath, clashes, getFile, getDocText, lastVersion, addVersion, flushPending, setDocText, takeSnapshot, touch, log, track});
registerGithub(app, {db, who, okPath, clashes, getDocText, setDocText, flushPending, addVersion, deleteFile, takeSnapshot, touch, log});
if (existsSync("dist")) app.use(express.static("dist"));
app.listen(3000, HOST, () => console.log(`API en ${HOST}:3000, colaboración en ${HOST}:1234` + (ONLY_HERE ? " (solo esta computadora)" : " (abierto a la red)")));
