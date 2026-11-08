// Sincronizar un proyecto con un repositorio de GitHub, para escribir a varias manos: cada quien en su Mac, a su ritmo.
// Todo va por la API de GitHub con una clave personal (token): no hace falta instalar git ni usar la terminal.
// Cómo se sincroniza: se comparan tres estados de cada archivo: el de la última sincronización («base»), el tuyo y el de GitHub.
// Si solo cambió uno, gana ese. Si cambiaron los dos, se mezclan línea por línea; si los dos tocaron las mismas líneas,
// quedan ambas versiones en el archivo, entre líneas de marca (comentarios de LaTeX), para que alguien elija.
import {createHash, randomUUID} from "crypto";
import {chmodSync, mkdirSync, readFileSync, writeFileSync} from "fs";
import {homedir} from "os";
import {dirname, join} from "path";
import {isLocal} from "./agent.js";

const API = (process.env.LJTEX_GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
const WEB = (process.env.LJTEX_GITHUB_WEB || "https://github.com").replace(/\/+$/, "");
const CONF = process.env.LJTEX_GITHUB_CONF || join(homedir(), ".ljtex", "github.json");   // la clave vive solo en esta Mac
const MAX_TEXT = 1e6;     // un texto mayor de 1 MB se guarda como archivo sin edición en vivo (igual que al importar .zip)
const MAX_FILE = 90e6;    // GitHub no acepta archivos de más de 100 MB
const TEXT_EXT = new Set(["tex", "bib", "sty", "cls", "bst", "bbx", "cbx", "lbx", "def", "cfg", "ltx", "dtx", "ins", "txt", "md", "csv", "tsv", "json",
  "yml", "yaml", "xml", "html", "css", "js", "py", "r", "m", "sh", "tikz", "pgf", "bbl", "clo", "fd", "rmd", "ipynb", "gp", "dat", "keep", "gitignore"]);
const JUNK = /(^|\/)(\.git|__MACOSX)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/;
const RC = /(^|\/)\.?latexmkrc$/i;   // latexmk ejecutaría su contenido como código: nunca se trae
const ext = p => (/\.([^./]+)$/.exec(p.toLowerCase()) || [])[1] || "";
const sha1 = b => createHash("sha1").update(b).digest("hex");
// El identificador que GitHub da a un archivo: así se sabe si cambió sin descargarlo
export const gitSha = buf => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Mezcla de tres versiones (línea por línea) ----------
export const MARK = {
  a: "%<<<<<<< CONFLICTO (LJtex) · tu versión:",
  b: "%======= la versión que llegó de GitHub:",
  c: "%>>>>>>> fin del conflicto · deja la versión buena y borra las tres líneas de marca",
};
export const hasMarks = t => t.split("\n").some(l => l.startsWith("%<<<<<<< CONFLICTO") || l.startsWith("%======= la versión que llegó") || l.startsWith("%>>>>>>> fin del conflicto"));

// Tramos en que «b» difiere de «a»: [{a0,a1,b0,b1}] (las líneas a[a0..a1) se cambiaron por b[b0..b1))
function hunks(a, b) {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const n = a.length - s - e, m = b.length - s - e;
  if (!n && !m) return [];
  if (!n || !m || n * m > 1.6e7) return [{a0: s, a1: s + n, b0: s, b1: s + m}];
  const W = m + 1, L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i * W + j] = a[s + i] === b[s + j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const out = []; let i = 0, j = 0, cur = null;
  while (i < n || j < m) {
    if (i < n && j < m && a[s + i] === b[s + j]) { if (cur) { out.push(cur); cur = null; } i++; j++; continue; }
    if (!cur) cur = {a0: s + i, a1: s + i, b0: s + j, b1: s + j};
    if (j >= m || (i < n && L[(i + 1) * W + j] >= L[i * W + j + 1])) { i++; cur.a1 = s + i; }
    else { j++; cur.b1 = s + j; }
  }
  if (cur) out.push(cur);
  return out;
}
// base = última versión común; mine = la tuya; theirs = la de GitHub
export function merge3(base, mine, theirs) {
  if (mine === theirs || base === theirs) return {text: mine, conflicts: 0};
  if (base === mine) return {text: theirs, conflicts: 0};
  const O = base.split("\n"), A = mine.split("\n"), B = theirs.split("\n");
  const hs = [...hunks(O, A).map(h => ({...h, s: 0})), ...hunks(O, B).map(h => ({...h, s: 1}))].sort((x, y) => x.a0 - y.a0 || x.a1 - y.a1);
  const out = []; let pos = 0, conflicts = 0, k = 0;
  while (k < hs.length) {
    const grp = [hs[k]]; let r0 = hs[k].a0, r1 = hs[k].a1; k++;
    while (k < hs.length && hs[k].a0 <= r1) { r1 = Math.max(r1, hs[k].a1); grp.push(hs[k]); k++; }
    for (let x = pos; x < r0; x++) out.push(O[x]);
    const side = (s, lines) => {
      const g = grp.filter(h => h.s === s);
      if (!g.length) return O.slice(r0, r1);
      return lines.slice(g[0].b0 - (g[0].a0 - r0), g.at(-1).b1 + (r1 - g.at(-1).a1));
    };
    const a = side(0, A), b = side(1, B), hasA = grp.some(h => h.s === 0), hasB = grp.some(h => h.s === 1);
    if (!hasB) out.push(...a);
    else if (!hasA) out.push(...b);
    else if (a.join("\n") === b.join("\n")) out.push(...a);
    else { conflicts++; out.push(MARK.a, ...a, MARK.b, ...b, MARK.c); }
    pos = r1;
  }
  for (let x = pos; x < O.length; x++) out.push(O[x]);
  return {text: out.join("\n"), conflicts};
}

// ¿Texto editable o archivo binario?
export function classify(path, buf, prefer) {
  if (buf.length <= MAX_TEXT && !buf.includes(0) && (prefer === "text" || TEXT_EXT.has(ext(path)) || !ext(path))) {
    try { new TextDecoder("utf-8", {fatal: true}).decode(buf); return "text"; } catch {}
  }
  return "bin";
}

// Decide el estado final de cada archivo. local: ruta → {kind, buf, sha}; remote y base: ruta → sha
export async function reconcile(local, remote, base, fetchBlob) {
  const target = new Map(), conflicts = [], merged = [], notes = [];
  const fromRemote = async (p, sha, prefer) => { const buf = await fetchBlob(sha); return {kind: classify(p, buf, prefer), buf, sha}; };
  const paths = [...new Set([...local.keys(), ...remote.keys(), ...base.keys()])].sort();
  for (const p of paths) {
    const l = local.get(p), ls = l?.sha ?? null, r = remote.get(p) ?? null, b = base.get(p) ?? null;
    if (ls === r) { if (l) target.set(p, l); continue; }                                   // iguales
    if (ls === b) { if (r) target.set(p, await fromRemote(p, r, l?.kind)); continue; }     // solo cambió en GitHub
    if (r === b) { if (l) target.set(p, l); continue; }                                    // solo cambió aquí
    if (l && r) {                                                                          // cambió en los dos lados
      const rf = await fromRemote(p, r, l.kind);
      if (l.kind === "text" && rf.kind === "text") {
        const bt = b ? (await fetchBlob(b)).toString("utf8") : "";
        const m = merge3(bt, l.buf.toString("utf8"), rf.buf.toString("utf8")), buf = Buffer.from(m.text, "utf8");
        target.set(p, {kind: "text", buf, sha: gitSha(buf)});
        if (m.conflicts) conflicts.push({path: p, n: m.conflicts}); else merged.push(p);
      } else {
        target.set(p, l);
        notes.push(`«${p}» cambió aquí y en GitHub; como no es un archivo de texto no se pueden mezclar, así que se conservó tu versión.`);
      }
    } else if (l) {
      target.set(p, l);
      notes.push(`«${p}» lo borraron en GitHub, pero tú lo habías modificado: se conservó (si sobra, bórralo y vuelve a sincronizar).`);
    } else {
      target.set(p, await fromRemote(p, r));
      notes.push(`«${p}» lo habías borrado aquí, pero en GitHub lo modificaron: se recuperó (si sobra, bórralo y vuelve a sincronizar).`);
    }
  }
  return {target, conflicts, merged, notes};
}

// ---------- Clave y llamadas a GitHub ----------
function readConf() { try { return JSON.parse(readFileSync(CONF, "utf8")); } catch { return {}; } }
function writeConf(c) {
  mkdirSync(dirname(CONF), {recursive: true});
  writeFileSync(CONF, JSON.stringify(c, null, 1), {mode: 0o600});
  try { chmodSync(CONF, 0o600); } catch {}
}
async function gh(token, method, path, body, ms = 60000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  let r;
  try {
    r = await fetch(API + path, {method, signal: ctl.signal, body: body ? JSON.stringify(body) : undefined,
      headers: {Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "LJtex", ...(body ? {"Content-Type": "application/json"} : {})}});
  } catch (e) {
    throw Object.assign(new Error(e.name === "AbortError" ? "GitHub tardó demasiado en responder. Inténtalo de nuevo." : "No pude conectarme con GitHub. Revisa tu conexión a internet."), {status: 0});
  } finally { clearTimeout(t); }
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
  if (!r.ok) {
    const msg = j?.message || "";
    let human = `GitHub respondió con un error (${r.status}${msg ? ": " + msg : ""}).`;
    if (r.status === 401) human = "GitHub no aceptó tu clave: quizá caducó o la borraste. Conecta LJtex de nuevo con una clave nueva (menú ⋯ › GitHub… › Cambiar clave).";
    else if (r.status === 403 && /rate limit/i.test(msg)) human = "GitHub limita cuántas peticiones se hacen por hora y ya se llegó al límite. Espera unos minutos.";
    else if (r.status === 403) human = "Tu clave de GitHub no tiene permiso para esto. Crea una clave nueva con la casilla «repo» marcada.";
    else if (r.status === 404) human = "No encuentro ese repositorio en GitHub, o tu cuenta no tiene acceso a él (si te invitaron, acepta primero la invitación).";
    throw Object.assign(new Error(human), {status: r.status, gh: msg});
  }
  return {j, headers: r.headers};
}
const call = async (...a) => (await gh(...a)).j;
const R = l => `/repos/${encodeURIComponent(l.owner)}/${encodeURIComponent(l.repo)}`;
const BR = l => l.branch.split("/").map(encodeURIComponent).join("/");

export function registerGithub(app, h) {
  const {db, getDocText, setDocText, flushPending, addVersion, deleteFile, takeSnapshot, touch, log, okPath, clashes, who} = h;
  db.exec("create table if not exists gh_links(project text primary key, owner text, repo text, branch text, head text, tree text, base text, t integer, last integer)");
  const linkOf = p => db.prepare("select * from gh_links where project=?").get(p);
  const saveBase = (p, head, tree, base) =>
    db.prepare("update gh_links set head=?, tree=?, base=?, last=? where project=?").run(head, tree, JSON.stringify(Object.fromEntries(base)), Date.now(), p);
  const token = () => {
    const t = readConf().token;
    if (!t) throw Object.assign(new Error("Primero conecta LJtex con tu cuenta de GitHub."), {status: 428, needToken: true});
    return t;
  };
  const info = p => {
    const l = linkOf(p); if (!l) return {linked: false};
    return {linked: true, full: `${l.owner}/${l.repo}`, url: `${WEB}/${l.owner}/${l.repo}`, branch: l.branch, last: l.last};
  };
  // Un proyecto no se sincroniza dos veces a la vez (p. ej. dos clics seguidos)
  const busy = new Map();
  const once = (key, fn) => { if (busy.has(key)) return busy.get(key); const pr = fn().finally(() => busy.delete(key)); busy.set(key, pr); return pr; };

  function localFiles(project) {
    const m = new Map();
    for (const f of db.prepare("select path,kind,data from files where project=?").all(project)) {
      const buf = f.kind === "text" ? Buffer.from(getDocText(`${project}/${f.path}`), "utf8") : (f.data || Buffer.alloc(0));
      m.set(f.path, {kind: f.kind, buf, sha: gitSha(buf)});
    }
    return m;
  }
  async function remoteState(tok, l, known) {
    const ref = await call(tok, "GET", `${R(l)}/git/ref/heads/${BR(l)}`);
    const head = ref.object.sha;
    if (known && known.head === head && known.tree) return {head, tree: known.tree, files: known.base, same: true, skipped: []};
    const c = await call(tok, "GET", `${R(l)}/git/commits/${head}`);
    const t = await call(tok, "GET", `${R(l)}/git/trees/${c.tree.sha}?recursive=1`, null, 120000);
    if (t.truncated) throw new Error("El repositorio tiene demasiados archivos para sincronizarlo desde LJtex.");
    const files = new Map(), skipped = [];
    for (const e of t.tree || []) {
      if (e.type !== "blob") continue;
      if (e.mode === "120000" || JUNK.test(e.path) || RC.test(e.path) || !okPath(e.path) || (e.size ?? 0) > MAX_FILE) { skipped.push(e.path); continue; }
      files.set(e.path, e.sha);
    }
    return {head, tree: c.tree.sha, files, skipped};
  }
  const blob = async (tok, l, sha) => {
    const j = await call(tok, "GET", `${R(l)}/git/blobs/${sha}`, null, 180000);
    return Buffer.from(j.content || "", j.encoding === "base64" ? "base64" : "utf8");
  };
  // Quiénes hicieron los cambios que llegan (para el historial)
  async function whoChanged(tok, l, from, to) {
    if (!from || from === to) return [];
    try {
      const c = await call(tok, "GET", `${R(l)}/compare/${from}...${to}`);
      const names = (c.commits || []).map(x => (/^(.{1,60}?): .*\(desde LJtex\)/.exec(x.commit?.message || "") || [])[1] || x.commit?.author?.name || x.author?.login).filter(Boolean);
      return [...new Set(names)];
    } catch { return []; }
  }

  // Deja los archivos del proyecto como en «target» (los coautores conectados ven el cambio al instante)
  async function applyLocal(project, local, target, me, label) {
    const upd = [], cre = [], rem = [], held = [];
    for (const [p, t] of target) { const x = local.get(p); if (!x) cre.push(p); else if (x.sha !== t.sha || x.kind !== t.kind) upd.push(p); }
    for (const p of local.keys()) if (!target.has(p)) rem.push(p);
    if (!upd.length && !cre.length && !rem.length) return {created: [], updated: [], removed: [], held};
    const before = takeSnapshot(project), ids = [];
    for (const p of rem) { if (local.get(p).kind === "text") flushPending(`${project}/${p}`); deleteFile(project, p); }
    for (const p of upd) {
      const t = target.get(p), x = local.get(p), name = `${project}/${p}`;
      if (t.kind === "text" && x.kind === "text") {
        flushPending(name);
        let txt = t.buf.toString("utf8");
        const now = getDocText(name), was = x.buf.toString("utf8");
        if (now !== was) txt = merge3(was, now, txt).text;   // lo que alguien escribió mientras se sincronizaba no se pierde
        await setDocText(name, txt, me);
        db.prepare("update files set text=? where project=? and path=?").run(txt, project, p);
        ids.push(addVersion(name, me, label, false, txt, undefined, false));
      } else if (t.kind === "bin" && x.kind === "bin") {
        db.prepare("update files set data=?, hash=? where project=? and path=?").run(t.buf, sha1(t.buf), project, p);
      } else { deleteFile(project, p); cre.push(p); }
    }
    for (const p of cre) {
      const t = target.get(p), name = `${project}/${p}`;
      const all = db.prepare("select path from files where project=?").all(project).map(f => f.path);
      if (clashes(all, p)) { held.push(p); continue; }   // choca con una carpeta o archivo del mismo nombre
      db.prepare("delete from docs where name=?").run(name);
      db.prepare("delete from versions where doc=?").run(name);
      db.prepare("insert into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)")
        .run(project, p, t.kind, t.kind === "text" ? t.buf.toString("utf8") : null, t.kind === "bin" ? t.buf : null, t.kind === "bin" ? sha1(t.buf) : null);
    }
    const after = takeSnapshot(project);
    for (const id of ids) db.prepare("update versions set snap=? where id=?").run(after, id);
    touch(project);
    const created = cre.filter(p => !held.includes(p)), n = created.length + upd.length + rem.length;
    log(project, me, "github", "", `${label}: ${n} ${n === 1 ? "archivo" : "archivos"}`, before);
    return {created, updated: upd, removed: rem, held};
  }

  // Sincroniza: trae lo nuevo de GitHub, lo mezcla con lo tuyo y sube el resultado
  async function doSync(project, me, acc = null) {
    const l = linkOf(project);
    if (!l) throw Object.assign(new Error("Este proyecto no está vinculado con GitHub."), {status: 404});
    const tok = token();
    const out = acc || {pulled: {created: [], updated: [], removed: []}, pushed: [], conflicts: [], merged: [], notes: [], authors: [], skipped: []};
    const local = localFiles(project);
    const marked = [...local].filter(([, f]) => f.kind === "text" && hasMarks(f.buf.toString("utf8"))).map(([p]) => p);
    if (marked.length) return {...out, blocked: marked};
    const base = new Map(Object.entries(JSON.parse(l.base || "{}")));
    const rem = await remoteState(tok, l, {head: l.head, tree: l.tree, base});
    const cache = new Map();
    const fetchBlob = async sha => { if (!cache.has(sha)) cache.set(sha, await blob(tok, l, sha)); return cache.get(sha); };
    const {target, conflicts, merged, notes} = await reconcile(local, rem.files, base, fetchBlob);
    const authors = rem.same ? [] : await whoChanged(tok, l, l.head, rem.head);
    const label = "Traído de GitHub" + (authors.length ? ` (cambios de ${authors.join(", ")})` : "");
    const ap = await applyLocal(project, local, target, me, label);
    for (const p of ap.held) { target.delete(p); notes.push(`«${p}» no se pudo traer porque choca con una carpeta o un archivo del mismo nombre en este proyecto.`); }
    out.pulled.created.push(...ap.created); out.pulled.updated.push(...ap.updated); out.pulled.removed.push(...ap.removed);
    out.conflicts.push(...conflicts); out.merged.push(...merged); out.notes.push(...notes); out.skipped.push(...rem.skipped);
    for (const a of authors) if (!out.authors.includes(a)) out.authors.push(a);
    const remoteBase = new Map([...rem.files].filter(([p]) => !ap.held.includes(p)));
    if (conflicts.length) {                    // no se sube nada hasta que alguien elija la versión buena
      saveBase(project, rem.head, rem.tree, remoteBase);
      return out;
    }
    const up = [...target].filter(([p, t]) => t.sha !== rem.files.get(p)).map(([p]) => p);
    const del = [...rem.files.keys()].filter(p => !target.has(p) && !ap.held.includes(p));
    let head = rem.head, tree = rem.tree;
    if (up.length || del.length) {
      const entries = [];
      for (const p of up) {
        const b = await call(tok, "POST", `${R(l)}/git/blobs`, {content: target.get(p).buf.toString("base64"), encoding: "base64"}, 180000);
        entries.push({path: p, mode: "100644", type: "blob", sha: b.sha});
      }
      for (const p of del) entries.push({path: p, mode: "100644", type: "blob", sha: null});
      const nt = await call(tok, "POST", `${R(l)}/git/trees`, {base_tree: rem.tree, tree: entries}, 120000);
      const all = [...up, ...del];
      const message = `${me}: ${all.length === 1 ? all[0] : all.length + " archivos"} (desde LJtex)\n\n` + [...up.map(p => "· " + p), ...del.map(p => "× " + p + " (borrado)")].slice(0, 80).join("\n");
      const nc = await call(tok, "POST", `${R(l)}/git/commits`, {message, tree: nt.sha, parents: [rem.head]});
      try { await call(tok, "PATCH", `${R(l)}/git/refs/heads/${BR(l)}`, {sha: nc.sha, force: false}); }
      catch (e) {
        // Alguien subió algo justo ahora: se trae eso también y se vuelve a intentar
        if (e.status === 422 && (out.retries || 0) < 3) { out.retries = (out.retries || 0) + 1; saveBase(project, rem.head, rem.tree, remoteBase); return doSync(project, me, out); }
        throw e;
      }
      head = nc.sha; tree = nt.sha;
      out.pushed.push(...up, ...del);
    }
    saveBase(project, head, tree, new Map([...target].map(([p, t]) => [p, t.sha])));
    return out;
  }

  // Proyecto nuevo con el contenido de un repositorio
  async function cloneRepo(full, me) {
    const tok = token();
    const [owner, repo] = String(full).split("/");
    if (!owner || !repo) throw Object.assign(new Error("Repositorio no válido."), {status: 400});
    const ri = await call(tok, "GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    const l = {owner: ri.owner.login, repo: ri.name, branch: ri.default_branch || "main"};
    let rem;
    try { rem = await remoteState(tok, l); }
    catch (e) { if (e.status === 409 || e.status === 404) throw Object.assign(new Error("Ese repositorio está vacío en GitHub: no hay nada que abrir todavía."), {status: 409}); throw e; }
    const rows = [];
    for (const [p, sha] of rem.files) { const buf = await blob(tok, l, sha); rows.push({path: p, kind: classify(p, buf), buf}); }
    let main = null;
    if (!rows.some(f => f.path === "main.tex")) {
      const docs = rows.filter(f => f.kind === "text" && /\.tex$/i.test(f.path) && /^[^%\n]*\\documentclass/m.test(f.buf.toString("utf8").replace(/%.*$/gm, "")));
      const root = docs.filter(f => !f.path.includes("/")), pool = root.length ? root : docs;
      main = (pool.find(f => /\\begin\{document\}/.test(f.buf.toString("utf8"))) || pool[0])?.path || null;
    }
    const fromLJ = /^Proyecto de LJtex: (.+)$/.exec(ri.description || "")?.[1];   // el nombre original, con acentos y espacios
    const id = randomUUID().slice(0, 8), now = Date.now(), name = (fromLJ || ri.name.replace(/[-_]+/g, " ")).slice(0, 80);
    db.transaction(() => {
      db.prepare("insert into projects(id,name,t,modified,tags,main) values(?,?,?,?,?,?)").run(id, name, now, now, "[]", main);
      for (const f of rows)
        db.prepare("insert into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)")
          .run(id, f.path, f.kind, f.kind === "text" ? f.buf.toString("utf8") : null, f.kind === "bin" ? f.buf : null, f.kind === "bin" ? sha1(f.buf) : null);
      db.prepare("insert into gh_links(project,owner,repo,branch,head,tree,base,t,last) values(?,?,?,?,?,?,?,?,?)")
        .run(id, l.owner, l.repo, l.branch, rem.head, rem.tree, JSON.stringify(Object.fromEntries(rem.files)), now, now);
    })();
    log(id, me, "project", "", `Abierto desde GitHub (${l.owner}/${l.repo}, ${rows.length} archivos)`);
    return {id, name, files: rows.length, skipped: rem.skipped};
  }

  // ---------- Rutas ----------
  const local = (q, r) => { if (isLocal(q)) return true; r.status(403).json({error: "GitHub solo se puede usar desde la computadora donde corre LJtex.", reason: "remote"}); return false; };
  const fail = (r, e) => r.status(e.status === 401 ? 424 : e.status >= 400 && e.status < 600 ? e.status : 502).json({error: e.message, needToken: !!e.needToken || e.status === 401});
  const exists = id => !!db.prepare("select 1 from projects where id=?").get(id);

  app.get("/api/github/status", (q, r) => {
    if (!isLocal(q)) return r.json({connected: false, reason: "remote"});
    const c = readConf();
    r.json({connected: !!c.token, login: c.login || "", name: c.name || "", newTokenUrl: `${WEB}/settings/tokens/new?scopes=repo&description=LJtex`});
  });
  app.post("/api/github/token", async (q, r) => {
    if (!local(q, r)) return;
    const t = String(q.body?.token || "").trim();
    if (!t) return r.status(400).json({error: "Pega la clave que te dio GitHub."});
    if (/^github_pat_/.test(t)) return r.status(400).json({error: "Esa es una clave de tipo «fine-grained», que no sirve para repositorios de otras personas. Usa el enlace del paso 1: crea una clave «classic» con la casilla «repo»."});
    if (!/^[A-Za-z0-9_]{20,255}$/.test(t)) return r.status(400).json({error: "Eso no parece una clave de GitHub. Debe empezar con «ghp_» y no tener espacios."});
    try {
      const {j, headers} = await gh(t, "GET", "/user");
      const scopes = (headers.get("x-oauth-scopes") || "").split(",").map(s => s.trim());
      if (headers.get("x-oauth-scopes") != null && !scopes.includes("repo")) return r.status(400).json({error: "La clave es válida, pero no tiene marcada la casilla «repo». Crea otra con el enlace del paso 1 (ya la trae marcada)."});
      writeConf({...readConf(), token: t, login: j.login, name: j.name || ""});
      r.json({ok: true, login: j.login, name: j.name || ""});
    } catch (e) { fail(r, e.status === 401 ? Object.assign(new Error("GitHub no reconoce esa clave. Revisa que la copiaste completa."), {status: 400}) : e); }
  });
  app.delete("/api/github/token", (q, r) => {
    if (!local(q, r)) return;
    const c = readConf(); delete c.token; delete c.login; delete c.name; writeConf(c);
    r.json({ok: true});
  });

  // Repositorios a los que tienes acceso (tuyos y de otros que te invitaron) e invitaciones pendientes
  app.get("/api/github/repos", async (q, r) => {
    if (!local(q, r)) return;
    try {
      const tok = token();
      const [repos, inv] = await Promise.all([
        call(tok, "GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"),
        call(tok, "GET", "/user/repository_invitations?per_page=100").catch(() => []),
      ]);
      const linked = new Map(db.prepare("select g.project, g.owner, g.repo, p.name from gh_links g join projects p on p.id=g.project").all().map(x => [`${x.owner}/${x.repo}`.toLowerCase(), {id: x.project, name: x.name}]));
      r.json({
        repos: (repos || []).map(x => ({full: x.full_name, private: x.private, updated: x.pushed_at || x.updated_at, owner: x.owner?.login, url: x.html_url, project: linked.get(x.full_name.toLowerCase()) || null})),
        invitations: (inv || []).map(x => ({id: x.id, full: x.repository?.full_name, from: x.inviter?.login})),
      });
    } catch (e) { fail(r, e); }
  });
  // Avisos para la pantalla principal: invitaciones pendientes y proyectos de LJtex que alguien
  // te compartió (invitación ya aceptada) pero que todavía no has abierto en esta computadora
  app.get("/api/github/shared", async (q, r) => {
    if (!isLocal(q)) return r.json({connected: false, reason: "remote"});
    const c = readConf();
    if (!c.token) return r.json({connected: false});
    try {
      const [inv, repos] = await Promise.all([
        call(c.token, "GET", "/user/repository_invitations?per_page=100", null, 15000).catch(() => []),
        call(c.token, "GET", "/user/repos?per_page=100&sort=updated&affiliation=collaborator", null, 15000).catch(() => []),
      ]);
      const linked = new Set(db.prepare("select owner, repo from gh_links").all().map(x => `${x.owner}/${x.repo}`.toLowerCase()));
      const me = String(c.login || "").toLowerCase();
      r.json({
        connected: true,
        invitations: (inv || []).map(x => ({id: x.id, full: x.repository?.full_name, from: x.inviter?.login, name: /^Proyecto de LJtex: (.+)$/.exec(x.repository?.description || "")?.[1] || null})),
        unopened: (repos || [])
          .filter(x => x.owner?.login?.toLowerCase() !== me && !linked.has(x.full_name.toLowerCase()) && /^Proyecto de LJtex: /.test(x.description || ""))
          .map(x => ({full: x.full_name, from: x.owner?.login, name: /^Proyecto de LJtex: (.+)$/.exec(x.description)[1]})),
      });
    } catch (e) { r.json({connected: true, invitations: [], unopened: [], error: e.message}); }
  });
  app.post("/api/github/invitations/:id/accept", async (q, r) => {
    if (!local(q, r)) return;
    try { await call(token(), "PATCH", `/user/repository_invitations/${encodeURIComponent(q.params.id)}`); r.json({ok: true}); }
    catch (e) { fail(r, e); }
  });
  app.post("/api/github/clone", async (q, r) => {
    if (!local(q, r)) return;
    try { r.json(await once("clone:" + q.body?.repo, () => cloneRepo(q.body?.repo, who(q)))); }
    catch (e) { fail(r, e); }
  });

  app.get("/api/projects/:id/github", (q, r) => {
    if (!isLocal(q)) return r.json({linked: false, reason: "remote"});
    r.json({...info(q.params.id), connected: !!readConf().token, login: readConf().login || ""});
  });
  // Crear un repositorio nuevo (privado) en tu cuenta y subir el proyecto
  app.post("/api/projects/:id/github/create", async (q, r) => {
    if (!local(q, r)) return;
    const id = q.params.id, me = who(q);
    const p = db.prepare("select name from projects where id=?").get(id);
    if (!p) return r.status(404).json({error: "El proyecto no existe."});
    if (linkOf(id)) return r.status(409).json({error: "Este proyecto ya está vinculado con GitHub."});
    const name = String(q.body?.name || "").trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || /^\.+$/.test(name)) return r.status(400).json({error: "El nombre del repositorio solo puede tener letras sin acentos, números, guiones (-), guiones bajos (_) y puntos."});
    try {
      const tok = token();
      let repo;
      try { repo = await call(tok, "POST", "/user/repos", {name, private: q.body?.private !== false, auto_init: true, description: `Proyecto de LJtex: ${p.name}`.slice(0, 300)}); }
      catch (e) { if (e.status === 422) throw Object.assign(new Error(`Ya tienes un repositorio que se llama «${name}» en GitHub. Elige otro nombre.`), {status: 409}); throw e; }
      const l = {owner: repo.owner.login, repo: repo.name, branch: repo.default_branch || "main"};
      let rem;
      for (let i = 0; ; i++) {   // GitHub tarda un momento en preparar el repositorio recién creado
        try { rem = await remoteState(tok, l); break; } catch (e) { if (i >= 9) throw e; await sleep(1000); }
      }
      db.prepare("insert into gh_links(project,owner,repo,branch,head,tree,base,t,last) values(?,?,?,?,?,?,?,?,?)")
        .run(id, l.owner, l.repo, l.branch, rem.head, rem.tree, JSON.stringify(Object.fromEntries(rem.files)), Date.now(), null);
      const res = await once(id, () => doSync(id, me));
      log(id, me, "github", "", `Guardado en GitHub: ${l.owner}/${l.repo}`);
      r.json({...res, ...info(id)});
    } catch (e) { fail(r, e); }
  });
  app.post("/api/projects/:id/github/sync", async (q, r) => {
    if (!local(q, r)) return;
    if (!exists(q.params.id)) return r.status(404).json({error: "El proyecto no existe."});
    try { const res = await once(q.params.id, () => doSync(q.params.id, who(q))); r.json({...res, ...info(q.params.id)}); }
    catch (e) { fail(r, e); }
  });
  // ¿Hay algo nuevo en GitHub? ¿Hay cambios tuyos sin subir?
  app.get("/api/projects/:id/github/check", async (q, r) => {
    if (!isLocal(q)) return r.json({});
    const l = linkOf(q.params.id); if (!l) return r.json({linked: false});
    const base = JSON.parse(l.base || "{}"), lf = localFiles(q.params.id);
    const mine = lf.size !== Object.keys(base).length || [...lf].some(([p, f]) => base[p] !== f.sha);
    if (q.query.local) return r.json({linked: true, local: mine, last: l.last});   // sin preguntar a GitHub (rápido, sin internet)
    let remote = null, by = null, at = null;
    try {
      const tok = token(), ref = await call(tok, "GET", `${R(l)}/git/ref/heads/${BR(l)}`, null, 15000);
      remote = ref.object.sha !== l.head;
      if (remote) {   // quién subió lo último (para el aviso «María subió cambios»)
        const c = await call(tok, "GET", `${R(l)}/commits/${ref.object.sha}`, null, 15000).catch(() => null);
        by = c?.author?.login || c?.commit?.author?.name || null; at = c?.commit?.author?.date || null;
        if (by && readConf().login && by.toLowerCase() === readConf().login.toLowerCase()) by = "tú (desde otra computadora)";
      }
    } catch {}
    r.json({linked: true, local: mine, remote, by, at, last: l.last});
  });
  app.delete("/api/projects/:id/github", (q, r) => {
    if (!local(q, r)) return;
    db.prepare("delete from gh_links where project=?").run(q.params.id);
    log(q.params.id, who(q), "github", "", "Se desvinculó de GitHub (el repositorio sigue en GitHub)");
    r.json({ok: true});
  });
  // Coautores: quién tiene acceso y quién tiene la invitación pendiente
  app.get("/api/projects/:id/github/people", async (q, r) => {
    if (!local(q, r)) return;
    const l = linkOf(q.params.id); if (!l) return r.status(404).json({error: "Este proyecto no está vinculado con GitHub."});
    try {
      const tok = token();
      const [cs, inv] = await Promise.all([call(tok, "GET", `${R(l)}/collaborators?per_page=100`), call(tok, "GET", `${R(l)}/invitations?per_page=100`).catch(() => [])]);
      r.json({owner: l.owner, people: (cs || []).map(c => c.login), invited: (inv || []).map(i => i.invitee?.login).filter(Boolean)});
    } catch (e) { fail(r, e.status === 403 ? Object.assign(new Error(`Solo ${l.owner} (dueño del repositorio) puede ver e invitar coautores.`), {status: 403}) : e); }
  });
  app.post("/api/projects/:id/github/invite", async (q, r) => {
    if (!local(q, r)) return;
    const l = linkOf(q.params.id); if (!l) return r.status(404).json({error: "Este proyecto no está vinculado con GitHub."});
    const user = String(q.body?.user || "").trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9-]{1,39}$/.test(user)) return r.status(400).json({error: "Escribe el nombre de usuario de GitHub de tu coautor (solo letras, números y guiones)."});
    try {
      const {j} = await gh(token(), "PUT", `${R(l)}/collaborators/${encodeURIComponent(user)}`, {permission: "push"});
      r.json({ok: true, invited: !!j, user});
    } catch (e) { fail(r, e.status === 404 ? Object.assign(new Error(`No existe el usuario «${user}» en GitHub (o tú no eres el dueño del repositorio).`), {status: 404}) : e); }
  });

  return {forget: p => db.prepare("delete from gh_links where project=?").run(p)};
}
