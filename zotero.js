// Sincronizar con Zotero (de Zotero hacia el proyecto, en un solo sentido), todo en esta computadora:
// Zotero de escritorio expone su biblioteca en http://127.0.0.1:23119 mientras está abierto. No hay cuentas, claves ni internet.
// Si tiene el plugin Better BibTeX se usa su exportación (claves de cita estables); si no, la API local de Zotero 7.
import {isLocal} from "./agent.js";

const Z = (process.env.ZOTERO_URL || "http://127.0.0.1:23119").replace(/\/+$/, "");
const HEAD = "% Generado desde Zotero por LJtex. Se sobrescribe al sincronizar: no lo edites aquí (tus referencias propias van en otro .bib).\n\n";
const MAX = 20e6;

async function zget(path, ms = 15000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(Z + path, {headers: {"Zotero-API-Version": "3", "User-Agent": "LJtex"}, signal: ctl.signal}); }
  finally { clearTimeout(t); }
}
const keysOf = t => new Set([...String(t).matchAll(/^\s*@\w+\s*\{\s*([^,\s]+)\s*,/gm)].map(m => m[1]));

// Estado de Zotero: ¿abierto?, ¿API local activada?, ¿Better BibTeX?, colecciones
export async function zoteroStatus() {
  let r;
  try { r = await zget("/api/users/0/collections?limit=100", 4000); }
  catch { return {ok: false, reason: "closed"}; }
  if (r.status === 403) return {ok: false, reason: "disabled"};
  if (!r.ok) return {ok: false, reason: r.status === 404 ? "old" : "error", detail: r.status};
  let list = await r.json().catch(() => []);
  const total = +r.headers.get("total-results") || list.length;
  for (let s = 100; s < Math.min(total, 1000); s += 100) {
    const n = await zget(`/api/users/0/collections?limit=100&start=${s}`, 8000).then(x => x.json()).catch(() => []);
    list = list.concat(n);
  }
  const by = new Map(list.map(c => [c.data?.key || c.key, c.data || c]));
  const pathOf = k => { const out = []; for (let c = by.get(k), g = 0; c && g < 20; c = by.get(c.parentCollection), g++) out.unshift(c.name); return out; };
  const collections = [...by.keys()].map(k => ({key: k, name: by.get(k).name, path: pathOf(k)})).sort((a, b) => a.path.join("/").localeCompare(b.path.join("/")));
  let bbt = false;
  try { bbt = (await (await zget("/better-bibtex/cayw?probe=true", 2500)).text()).trim() === "ready"; } catch {}
  return {ok: true, bbt, collections, total: undefined};
}

// Descarga la biblioteca o una colección como BibTeX
export async function zoteroBib(collection) {
  const st = await zoteroStatus();
  if (!st.ok) throw Object.assign(new Error("zotero"), {st});
  const col = collection ? st.collections.find(c => c.key === collection) : null;
  if (collection && !col) throw new Error("Esa colección ya no existe en Zotero.");
  let text = "";
  if (st.bbt) {
    const p = col ? `/better-bibtex/export/collection?/1/${col.path.map(encodeURIComponent).join("/")}.bibtex` : "/better-bibtex/export/library?/1/library.bibtex";
    const r = await zget(p, 120000);
    if (r.ok) text = await r.text();
  }
  if (!text) {
    const base = col ? `/api/users/0/collections/${col.key}/items/top` : "/api/users/0/items/top";
    for (let s = 0, total = Infinity; s < total && text.length < MAX; s += 100) {
      const r = await zget(`${base}?format=bibtex&limit=100&start=${s}`, 60000);
      if (!r.ok) throw new Error(`Zotero respondió ${r.status}.`);
      total = +r.headers.get("total-results") || 0;
      text += (await r.text()).trim() + "\n\n";
      if (!total) break;
    }
  }
  if (text.length > MAX) throw new Error("La biblioteca es demasiado grande para sincronizarla de una vez. Elige una colección.");
  return {text: text.trim() ? text.trim() + "\n" : "", bbt: st.bbt};
}

export function registerZotero(app, {db, who, okPath, clashes, getDocText, lastVersion, addVersion, flushPending, setDocText, takeSnapshot, touch, log, track}) {
  app.get("/api/zotero/status", async (q, r) => {
    if (!isLocal(q)) return r.json({ok: false, reason: "remote"});
    r.json(await zoteroStatus());
  });

  app.post("/api/zotero/sync", async (q, r) => {
    if (!isLocal(q)) return r.status(403).json({error: "Zotero solo se puede sincronizar desde la computadora donde corre LJtex."});
    const project = String(q.body?.project || ""), file = String(q.body?.file || "zotero.bib").trim(), collection = String(q.body?.collection || "");
    if (!db.prepare("select 1 from projects where id=?").get(project)) return r.status(404).json({error: "El proyecto no existe."});
    if (!okPath(file) || !/\.bib$/i.test(file)) return r.status(400).json({error: "El archivo debe tener extensión .bib y un nombre válido."});
    let got;
    try { got = await zoteroBib(collection); }
    catch (e) {
      const why = e.st?.reason;
      return r.status(502).json({error: why === "closed" ? "No encuentro Zotero. Ábrelo (la aplicación de escritorio) e inténtalo de nuevo."
        : why === "disabled" ? "Zotero tiene desactivado el acceso local. En Zotero: Ajustes › Avanzado › «Permitir que otras aplicaciones de esta computadora se comuniquen con Zotero»."
        : why === "old" ? "Esta versión de Zotero no tiene la API local. Actualiza a Zotero 7 o superior."
        : e.message || "No pude leer Zotero."});
    }
    if (!got.text) return r.status(422).json({error: collection ? "Esa colección no tiene referencias." : "Tu biblioteca de Zotero no tiene referencias."});
    const next = HEAD + got.text, doc = `${project}/${file}`, me = who(q);
    const existing = db.prepare("select kind from files where project=? and path=?").get(project, file);
    try {
      let before = new Set();
      if (!existing) {
        const all = db.prepare("select path from files where project=?").all(project).map(f => f.path);
        if (clashes(all, file)) return r.status(409).json({error: `«${file}» choca con una carpeta o archivo que ya existe.`});
        const snap = takeSnapshot(project);
        db.prepare("insert into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)").run(project, file, "text", next, null, null);
        touch(project); log(project, me, "create", file, "Sincronizado con Zotero", snap);
      } else {
        if (existing.kind !== "text") return r.status(400).json({error: `«${file}» no es un archivo de texto.`});
        flushPending(doc);
        const now = getDocText(doc);
        before = keysOf(now);
        if (now === next) return r.json({ok: true, file, unchanged: true, count: keysOf(next).size, bbt: got.bbt});
        if (now !== lastVersion(doc)?.text) addVersion(doc, "", "Antes de sincronizar con Zotero", true, now);
        await setDocText(doc, next, me);
        addVersion(doc, me, "Sincronizado con Zotero", false, next);
        track.delete(doc); touch(project);
      }
      const keys = keysOf(next);
      // Claves que también están en otros .bib del proyecto (LaTeX se quejaría de entradas repetidas)
      const others = db.prepare("select path from files where project=? and kind='text'").all(project).filter(f => /\.bib$/i.test(f.path) && f.path !== file);
      const mine = new Set(others.flatMap(f => [...keysOf(getDocText(`${project}/${f.path}`))]));
      r.json({ok: true, file, count: keys.size, added: [...keys].filter(k => !before.has(k)).length, removed: [...before].filter(k => !keys.has(k)).length,
        dups: [...keys].filter(k => mine.has(k)).slice(0, 10), bbt: got.bbt, created: !existing});
    } catch (e) { r.status(500).json({error: "No se pudo guardar la bibliografía: " + e.message}); }
  });
}
