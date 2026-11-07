// Uso de LJtex en varias Mac con la carpeta de datos en iCloud Drive / Dropbox:
//  · candado «en uso» (con latido) para no abrir la misma base en dos Mac a la vez,
//  · comprobación de integridad al abrir (por si la sincronización quedó a medias),
//  · respaldos automáticos de la base de datos.
import {existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, statSync, copyFileSync, renameSync, rmdirSync} from "fs";
import {createHash, randomBytes} from "crypto";
import {dirname, join, basename} from "path";
import {hostname} from "os";

const BEAT = +process.env.LOCK_BEAT || 30e3, STALE = +process.env.LOCK_STALE || 120e3;
const me = {host: hostname(), pid: process.pid};
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export function acquireLock(dbPath) {
  const lockPath = dbPath + ".lock";
  if (existsSync(lockPath)) {
    let l = null; try { l = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
    if (l && !(l.host === me.host && !alive(l.pid))) {      // un candado mío con proceso muerto se ignora
      const age = Date.now() - (l.beat || 0);
      if (l.pid !== me.pid && age < STALE && !process.env.LJTEX_FORCE) {
        const quien = l.host === me.host ? "otra copia de LJtex en esta misma Mac" : `la Mac «${l.host}»`;
        throw new Error(`Los datos están en uso por ${quien} (hace ${Math.round(age / 1000)} s). Ciérrala antes de abrir aquí y espera unos segundos a que termine de sincronizar. Si estás seguro de que no se está usando, espera ${Math.ceil((STALE - age) / 1000)} s o arranca con LJTEX_FORCE=1.`);
      }
    }
  }
  const write = () => { try { writeFileSync(lockPath, JSON.stringify({...me, since, beat: Date.now()})); } catch {} };
  const since = Date.now();
  write();
  const iv = setInterval(write, BEAT); iv.unref();
  const release = () => { clearInterval(iv); try { const l = JSON.parse(readFileSync(lockPath, "utf8")); if (l.host === me.host && l.pid === me.pid) unlinkSync(lockPath); } catch {} };
  process.on("exit", release);
  return release;
}

// Copias conflictivas que crea iCloud/Dropbox («data 2.db», «data (conflicto de …).db»): avisa para no perder datos
export function conflictCopies(dbPath) {
  const dir = dirname(dbPath), stem = basename(dbPath, ".db");
  try { return readdirSync(dir).filter(f => f !== basename(dbPath) && f.startsWith(stem) && f.endsWith(".db") && !/^data-\d{4}/.test(f)); } catch { return []; }
}

export function checkIntegrity(db) {
  const r = db.pragma("quick_check", {simple: true});
  if (r !== "ok") throw new Error("La base de datos parece dañada o a medio sincronizar (" + r + "). Espera a que termine la sincronización de la carpeta; si persiste, restaura un archivo de la carpeta «respaldos».");
}

// Respaldo al arrancar (si el último tiene más de MIN horas) y luego cada cierto tiempo. Guarda los últimos KEEP.
export function startBackups(db, dbPath, {hours = 12, keep = 7} = {}) {
  const dir = join(dirname(dbPath), "respaldos"); mkdirSync(dir, {recursive: true});
  const list = () => readdirSync(dir).filter(f => /^data-\d{8}-\d{4}\.db$/.test(f)).sort();
  async function run() {
    const l = list(), last = l.length ? statSync(join(dir, l[l.length - 1])).mtimeMs : 0;
    if (Date.now() - last < hours * 3600e3 - 60e3) return;
    const d = new Date(), p = n => String(n).padStart(2, "0");
    const name = `data-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`;
    try { await db.backup(join(dir, name)); } catch (e) { console.warn("No se pudo respaldar:", e.message); return; }
    for (const f of list().slice(0, -keep)) try { unlinkSync(join(dir, f)); } catch {}
  }
  setTimeout(run, 5e3).unref(); setInterval(run, 3600e3).unref();
  return run;
}

// ───────── Sincronización por proyecto con una carpeta de iCloud/Dropbox (LJTEX_SYNC) ─────────
// Cada Mac trabaja con su base LOCAL (rápida y segura); nunca se abre una base dentro de iCloud.
// En la carpeta compartida cada proyecto es UN archivo (proyectos/<id>.ljproj, una base SQLite con solo ese proyecto: archivos,
// historial, conversaciones…) más un manifiesto <id>.json con tamaño y huellas. Al abrir se bajan los proyectos que cambió la otra Mac;
// al cerrar se suben los que cambiaste aquí. Un proyecto viaja completo o no viaja. Además se deja una copia legible (solo lectura).
const sha = f => createHash("sha256").update(readFileSync(f)).digest("hex");
const readJSON = f => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const statePath = dbPath => dbPath + ".sync.json";
const readState = dbPath => { const s = readJSON(statePath(dbPath)); return {v: 2, projects: s && s.v === 2 && s.projects ? s.projects : {}, mirror: s && s.v === 2 && s.mirror ? s.mirror : {}}; };
const writeState = (dbPath, st) => writeFileSync(statePath(dbPath), JSON.stringify(st));
const hostName = () => hostname();
function keepFile(dbPath, from, label) {
  const dir = join(dirname(dbPath), "respaldos"); mkdirSync(dir, {recursive: true});
  const to = join(dir, `${label}-${stamp()}${from.endsWith(".ljproj") ? ".ljproj" : ".db"}`); copyFileSync(from, to); return to;
}

// Huella del CONTENIDO de un proyecto (no depende de los números internos de las tablas, que cambian de una Mac a otra)
export function contentHash(db, pid) {
  const h = createHash("sha256"), put = (...v) => { for (const x of v) { if (Buffer.isBuffer(x)) h.update(x); else h.update(x == null ? "\u0000" : String(x)); h.update("\u001f"); } h.update("\u001e"); };
  const rank = new Map();
  for (const r of db.prepare("select * from projects where id=?").all(pid)) { put("p", r.id, r.name, r.t, r.modified, r.tags, r.main); if (r.engine) put("e", r.engine); }
  for (const r of db.prepare("select * from files where project=? order by path").all(pid)) put("f", r.path, r.kind, r.text, r.data, r.hash);
  for (const r of db.prepare("select * from docs where name like ? order by name").all(pid + "/%")) put("d", r.name, r.data);
  db.prepare("select id from snaps where project=? order by id").all(pid).forEach((r, i) => rank.set(r.id, i));
  for (const r of db.prepare("select * from snaps where project=? order by id").all(pid)) put("s", rank.get(r.id), r.t, r.manifest, r.mhash);
  for (const r of db.prepare("select * from versions where doc like ? order by id").all(pid + "/%")) put("v", r.doc, r.t, r.author, r.label, r.auto, r.text, r.stats, rank.get(r.snap));
  for (const r of db.prepare("select * from activity where project=? order by id").all(pid)) put("a", r.t, r.author, r.kind, r.path, r.detail, rank.get(r.snap));
  for (const r of db.prepare("select * from chats where project=? order by id").all(pid)) put("c", r.id, r.title, r.t, r.updated, r.items);
  for (const r of db.prepare("select * from agent_jobs where project=? order by id").all(pid)) put("j", r.id, r.prompt, r.t, r.text, r.changes, r.applied);
  return h.digest("hex");
}

const PTABLES = ["projects", "files", "docs", "snaps", "versions", "activity", "chats", "agent_jobs", "blobs"];
const WHERE = {projects: "id=@p", files: "project=@p", docs: "name like @l", snaps: "project=@p", versions: "doc like @l", activity: "project=@p", chats: "project=@p", agent_jobs: "project=@p"};

// Escribe el proyecto en un archivo .ljproj (base SQLite con solo ese proyecto)
export function exportProject(db, pid, out) {
  try { unlinkSync(out); } catch {}
  db.prepare("attach database ? as x").run(out);
  try {
    for (const t of PTABLES) {
      const sql = db.prepare("select sql from sqlite_master where type='table' and name=?").get(t).sql.replace(/^create table (if not exists )?"?(\w+)"?/i, "create table x.$2");
      db.exec(sql);
      if (t !== "blobs") db.prepare(`insert into x.${t} select * from main.${t} where ${WHERE[t]}`).run({p: pid, l: pid + "/%"});
    }
    const need = new Set();
    for (const {manifest} of db.prepare("select manifest from snaps where project=?").all(pid)) { try { for (const e of JSON.parse(manifest)) if (e[2]) need.add(e[2]); } catch {} }
    const ins = db.prepare("insert or ignore into x.blobs select * from main.blobs where hash=?");
    db.transaction(() => { for (const hh of need) ins.run(hh); })();
    db.exec("pragma x.user_version = 1");
  } finally { db.exec("detach database x"); }
}

// Trae un proyecto desde un .ljproj. mode: "replace" (reemplaza el que haya con ese id) o «copia» (con id nuevo y nombre distinto)
export function importProject(db, file, mode = "replace", suffix = "") {
  db.prepare("attach database ? as x").run(file);
  try {
    const pidOld = db.prepare("select id from x.projects").get().id;
    const pid = mode === "copy" ? randomBytes(4).toString("hex") : pidOld;
    const ren = mode === "copy" ? n => pid + n.slice(pidOld.length) : n => n;
    db.transaction(() => {
      if (mode === "replace") {
        for (const [t, c] of [["files", "project"], ["snaps", "project"], ["activity", "project"], ["chats", "project"], ["agent_jobs", "project"]]) db.prepare(`delete from ${t} where ${c}=?`).run(pid);
        db.prepare("delete from docs where name like ?").run(pid + "/%"); db.prepare("delete from versions where doc like ?").run(pid + "/%"); db.prepare("delete from projects where id=?").run(pid);
      }
      const pr = db.prepare("select * from x.projects").get();
      db.prepare("insert into projects(id,name,t,modified,tags,main,engine) values(?,?,?,?,?,?,?)").run(pid, pr.name + suffix, pr.t, pr.modified, pr.tags, pr.main, pr.engine ?? null);
      const fi = db.prepare("insert into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)");
      for (const r of db.prepare("select * from x.files").all()) fi.run(pid, r.path, r.kind, r.text, r.data, r.hash);
      const di = db.prepare("insert or replace into docs(name,data) values(?,?)");
      for (const r of db.prepare("select * from x.docs").all()) di.run(ren(r.name), r.data);
      db.exec("insert or ignore into blobs select * from x.blobs");
      const smap = new Map(), si = db.prepare("insert into snaps(project,t,manifest,mhash) values(?,?,?,?)");
      for (const r of db.prepare("select * from x.snaps order by id").all()) smap.set(r.id, si.run(pid, r.t, r.manifest, r.mhash).lastInsertRowid);
      const vi = db.prepare("insert into versions(doc,t,author,label,auto,text,stats,snap) values(?,?,?,?,?,?,?,?)");
      for (const r of db.prepare("select * from x.versions order by id").all()) vi.run(ren(r.doc), r.t, r.author, r.label, r.auto, r.text, r.stats, smap.get(r.snap) ?? null);
      const ai = db.prepare("insert into activity(project,t,author,kind,path,detail,snap) values(?,?,?,?,?,?,?)");
      for (const r of db.prepare("select * from x.activity order by id").all()) ai.run(pid, r.t, r.author, r.kind, r.path, r.detail, smap.get(r.snap) ?? null);
      const ci = db.prepare("insert or replace into chats(id,project,title,t,updated,items) values(?,?,?,?,?,?)");
      for (const r of db.prepare("select * from x.chats").all()) ci.run(mode === "copy" ? randomBytes(6).toString("hex") : r.id, pid, r.title, r.t, r.updated, r.items);
      const ji = db.prepare("insert or ignore into agent_jobs(id,project,prompt,t,text,changes,applied) values(?,?,?,?,?,?,?)");
      for (const r of db.prepare("select * from x.agent_jobs").all()) ji.run(mode === "copy" ? randomBytes(6).toString("hex") : r.id, pid, r.prompt, r.t, r.text, r.changes, r.applied);
    })();
    return pid;
  } finally { db.exec("detach database x"); }
}

const projDir = syncDir => join(syncDir, "proyectos");
const manPath = (syncDir, pid) => join(projDir(syncDir), pid + ".json");
const filePath = (syncDir, pid) => join(projDir(syncDir), pid + ".ljproj");
const localIds = db => db.prepare("select id from projects").all().map(r => r.id);
const nameOf = (db, pid) => db.prepare("select name from projects where id=?").get(pid)?.name || pid;

// Al abrir (con la base ya abierta y antes de atender al navegador)
export function syncStart(db, dbPath, syncDir, resolve = process.env.LJTEX_SYNC_RESOLVE) {
  mkdirSync(projDir(syncDir), {recursive: true});
  const st = readState(dbPath), notes = [], conflicts = [], incomplete = [];
  const have = new Set(localIds(db));
  const mans = readdirSync(projDir(syncDir)).filter(f => f.endsWith(".json") && !f.endsWith(".tmp")).map(f => ({pid: f.slice(0, -5), man: readJSON(join(projDir(syncDir), f))})).filter(x => x.man);
  const backup = pid => { const tmp = join(dirname(dbPath), `.tmp-${pid}.ljproj`); exportProject(db, pid, tmp); const to = keepFile(dbPath, tmp, `antes-de-sincronizar-${pid}`); unlinkSync(tmp); return to; };
  for (const {pid, man} of mans) {
    if (man.deleted) {
      if (have.has(pid)) {
        if (st.projects[pid] && st.projects[pid].hash === contentHash(db, pid)) { backup(pid); const n = nameOf(db, pid); deleteProjectRows(db, pid); notes.push(`«${n}» se eliminó en «${man.host}»; aquí también (copia en respaldos/).`); }
      }
      delete st.projects[pid]; continue;
    }
    const f = filePath(syncDir, pid);
    if (!existsSync(f) || statSync(f).size !== man.size || sha(f) !== man.fileHash) { incomplete.push(man.name || pid); continue; }
    if (!have.has(pid)) { importProject(db, f, "replace"); st.projects[pid] = {hash: man.contentHash}; notes.push(`Se bajó «${man.name}» (de «${man.host}»).`); continue; }
    const cur = contentHash(db, pid), s = st.projects[pid]?.hash;
    if (cur === man.contentHash) st.projects[pid] = {hash: cur};
    else if (s === man.contentHash) { /* lo de aquí es más nuevo: se sube al cerrar */ }
    else if (s !== undefined && s === cur) { backup(pid); importProject(db, f, "replace"); st.projects[pid] = {hash: man.contentHash}; notes.push(`Se actualizó «${man.name}» con la versión de «${man.host}».`); }
    else conflicts.push({pid, man, f});
  }
  if (incomplete.length) { writeState(dbPath, st); throw new Error(`Estos proyectos de la carpeta compartida todavía no están completos (¿iCloud sigue sincronizando?): ${incomplete.join(", ")}.\nEspera a que termine —sin nube ni círculo junto a los archivos en Finder— y vuelve a abrir.`); }
  if (conflicts.length) {
    const list = conflicts.map(c => `«${c.man.name}»`).join(", ");
    if (resolve !== "local" && resolve !== "remote" && resolve !== "both") { writeState(dbPath, st); throw new Error(`Estos proyectos cambiaron en esta Mac Y en otra (última subida de «${conflicts[0].man.host}»): ${list}.\nPara no perder nada no se tocó ninguno. Elige UNA, abriendo así una sola vez:\n  · conservar lo de esta Mac:   LJTEX_SYNC_RESOLVE=local\n  · quedarte con lo de la carpeta compartida:   LJTEX_SYNC_RESOLVE=remote\n  · conservar las dos (la otra como copia):   LJTEX_SYNC_RESOLVE=both\n(Lo que se descarte queda en la carpeta «respaldos».)`); }
    for (const c of conflicts) {
      if (resolve === "local") { keepFile(dbPath, c.f, `conflicto-remoto-${c.pid}`); notes.push(`«${c.man.name}»: se conservó lo de esta Mac (la otra versión está en respaldos/).`); }
      else if (resolve === "remote") { backup(c.pid); importProject(db, c.f, "replace"); notes.push(`«${c.man.name}»: se usó la versión de la carpeta compartida (la tuya está en respaldos/).`); }
      else { const np = importProject(db, c.f, "copy", ` (versión de ${c.man.host})`); notes.push(`«${c.man.name}»: se conservaron las dos; la otra quedó como «${nameOf(db, np)}».`); }
      st.projects[c.pid] = {hash: c.man.contentHash};
    }
  }
  writeState(dbPath, st);
  return {notes, remote: Object.fromEntries(mans.map(x => [x.pid, x.man.contentHash]))};
}

function deleteProjectRows(db, pid) {
  db.transaction(() => {
    for (const [t, c] of [["files", "project"], ["snaps", "project"], ["activity", "project"], ["chats", "project"], ["agent_jobs", "project"]]) db.prepare(`delete from ${t} where ${c}=?`).run(pid);
    db.prepare("delete from docs where name like ?").run(pid + "/%"); db.prepare("delete from versions where doc like ?").run(pid + "/%"); db.prepare("delete from projects where id=?").run(pid);
  })();
}

const safe = n => String(n).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").trim().slice(0, 80) || "proyecto";

// Copia legible (solo lectura): una carpeta por proyecto con sus archivos tal cual. No se vuelve a leer nunca.
function mirror(db, pid, syncDir, st) {
  const root = join(syncDir, "Proyectos legibles"); mkdirSync(root, {recursive: true});
  const name = nameOf(db, pid); let folder = safe(name);
  const used = Object.entries(st.mirror).filter(([k]) => k !== pid).map(([, v]) => v);
  if (used.includes(folder)) folder += ` (${pid})`;
  const old = st.mirror[pid]; if (old && old !== folder) { try { renameSync(join(root, old), join(root, folder)); } catch {} }
  st.mirror[pid] = folder;
  const base = join(root, folder); mkdirSync(base, {recursive: true});
  const want = new Set();
  for (const f of db.prepare("select path,kind,text,data from files where project=?").all(pid)) {
    const rel = f.path.split("/").filter(x => x && x !== "." && x !== "..").map(safe).join("/"); if (!rel) continue; want.add(rel);
    const p = join(base, rel), buf = f.kind === "text" ? Buffer.from(f.text || "", "utf8") : (f.data || Buffer.alloc(0));
    let same = false; try { same = existsSync(p) && statSync(p).size === buf.length && readFileSync(p).equals(buf); } catch {}
    if (!same) { mkdirSync(dirname(p), {recursive: true}); writeFileSync(p, buf); }
  }
  const walkDel = (dir, rel = "") => { for (const e of readdirSync(dir, {withFileTypes: true})) { const r = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) { walkDel(join(dir, e.name), r); try { rmdirSync(join(dir, e.name)); } catch {} } else if (!want.has(r) && r !== "_LEEME.txt") try { unlinkSync(join(dir, e.name)); } catch {} } };
  walkDel(base);
  writeFileSync(join(base, "_LEEME.txt"), "Copia de solo lectura generada por LJtex (para respaldo y para ver tus archivos).\nLos cambios hechos aquí NO se importan: edita siempre desde LJtex.\n");
}

// Al cerrar (síncrono: se llama desde el evento «exit», con la base todavía abierta)
export function syncEnd(db, dbPath, syncDir) {
  const out = [];
  try {
    mkdirSync(projDir(syncDir), {recursive: true});
    const st = readState(dbPath), ids = new Set(localIds(db));
    for (const pid of ids) {
      const cur = contentHash(db, pid), s = st.projects[pid]?.hash, name = nameOf(db, pid);
      if (s === cur) continue;
      const rm = readJSON(manPath(syncDir, pid));
      if (rm && !rm.deleted && rm.contentHash !== s && rm.contentHash !== cur) {   // la otra Mac subió una versión mientras tanto: no se pisa
        const tmp = join(dirname(dbPath), `.tmp-${pid}.ljproj`); exportProject(db, pid, tmp); const to = keepFile(dbPath, tmp, `no-subido-${pid}`); unlinkSync(tmp);
        out.push(`«${name}»: la otra Mac subió cambios mientras tanto; NO se sobrescribió. Tu versión: ${to}`); continue;
      }
      const f = filePath(syncDir, pid), tmp = f + ".tmp";
      exportProject(db, pid, tmp);
      const man = {contentHash: cur, fileHash: sha(tmp), size: statSync(tmp).size, host: hostName(), t: Date.now(), name};
      renameSync(tmp, f); writeFileSync(manPath(syncDir, pid) + ".tmp", JSON.stringify(man)); renameSync(manPath(syncDir, pid) + ".tmp", manPath(syncDir, pid));
      st.projects[pid] = {hash: cur}; out.push(`«${name}» subido`);
    }
    for (const pid of Object.keys(st.projects)) if (!ids.has(pid)) {   // eliminado aquí: se avisa a la otra Mac
      writeFileSync(manPath(syncDir, pid) + ".tmp", JSON.stringify({deleted: true, host: hostName(), t: Date.now()})); renameSync(manPath(syncDir, pid) + ".tmp", manPath(syncDir, pid));
      try { unlinkSync(filePath(syncDir, pid)); } catch {} delete st.projects[pid]; out.push("proyecto eliminado propagado");
    }
    writeState(dbPath, st);
    for (const pid of ids) { try { mirror(db, pid, syncDir, st); } catch (e) { out.push("copia legible falló: " + e.message); } }
    writeState(dbPath, st);
  } catch (e) { out.push("no se pudo sincronizar: " + e.message); }
  return out.length ? out.join("; ") : "todo al día";
}
