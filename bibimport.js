// Agregar referencias a un .bib a partir de un DOI (Crossref) o de un identificador de arXiv.
// Es lo único de la app que sale a internet, y solo cuando lo usas: lo enviado es el DOI o el identificador, nunca tu texto.
const CROSSREF = process.env.CROSSREF_URL || "https://api.crossref.org/works/";
const ARXIV = process.env.ARXIV_URL || "https://export.arxiv.org/api/query";
const UA = "LJtex/1.0 (editor LaTeX local)";

// ---------- Identificadores ----------
export function parseId(raw) {
  let s = String(raw || "").trim().replace(/^<|>$/g, "");
  if (!s) return null;
  const ax = s.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Za-z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?\s*$/i);
  const doi = s.match(/(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"<>]+)/i);
  if (doi && !/arxiv\.org/i.test(s)) return {kind: "doi", id: doi[1].replace(/[.,;)]+$/, "")};
  if (ax) return {kind: "arxiv", id: ax[1].replace(/v\d+$/, "")};
  if (doi) return {kind: "doi", id: doi[1].replace(/[.,;)]+$/, "")};
  return null;
}

// ---------- Utilidades de texto ----------
const ENT = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " "};
const decode = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const plain = s => decode(String(s || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();   // quita etiquetas HTML/MathML
const esc1 = t => t.replace(/\\/g, "\\textbackslash{}").replace(/([&%#_$])/g, "\\$1").replace(/[{}]/g, m => "\\" + m);
// Escapa los caracteres especiales de LaTeX, salvo lo que está entre $…$ (fórmulas escritas así en el título), que se deja tal cual
const tex = s => { const t = plain(s); if ((t.match(/\$/g) || []).length % 2) return esc1(t); return t.split(/(\$[^$]*\$)/).map((x, i) => i % 2 ? x : esc1(x)).join(""); };
const ascii = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
const STOP = new Set(["a", "an", "the", "on", "of", "and", "in", "for", "to", "de", "la", "el", "los", "las", "un", "una", "sobre", "y", "en", "del", "with", "from", "by"]);

function makeKey(authors, year, title) {
  const first = authors[0]?.family || authors[0]?.name?.split(/\s+/).at(-1) || "";
  const w = plain(title).split(/\s+/).map(ascii).find(x => x.length > 2 && !STOP.has(x)) || "";
  return (ascii(first) || w || "ref") + (year || "") + (ascii(first) ? "" : "");
}
const person = a => a.family ? (a.given ? `${a.family}, ${a.given}` : a.family) : a.name || "";

function build(type, key, fields) {
  const pad = Math.max(...Object.keys(fields).map(k => k.length));
  const body = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `  ${k.padEnd(pad)} = {${v}}`).join(",\n");
  return `@${type}{${key},\n${body}\n}\n`;
}

// ---------- Crossref ----------
const CR_TYPE = {"journal-article": "article", "proceedings-article": "inproceedings", "book": "book", "monograph": "book", "edited-book": "book", "reference-book": "book",
  "book-chapter": "incollection", "book-section": "incollection", "dissertation": "phdthesis", "report": "techreport", "posted-content": "misc"};
export function fromCrossref(m, doi) {
  const type = CR_TYPE[m.type] || "misc";
  const authors = (m.author || []).map(a => ({family: plain(a.family || ""), given: plain(a.given || ""), name: plain(a.name || "")}));
  const year = (m.issued?.["date-parts"]?.[0]?.[0] || m.published?.["date-parts"]?.[0]?.[0] || m["published-print"]?.["date-parts"]?.[0]?.[0] || m["published-online"]?.["date-parts"]?.[0]?.[0] || "") + "";
  const title = plain((m.title || [])[0] || "Sin título"), container = plain((m["container-title"] || [])[0] || "");
  const f = {author: authors.map(a => tex(person(a))).join(" and "), title: "{" + tex(title) + "}"};
  if (type === "article") Object.assign(f, {journal: tex(container), volume: tex(m.volume || ""), number: tex(m.issue || ""), pages: tex((m.page || m["article-number"] || "").replace(/(\d)\s*[-–—]+\s*(\d)/, "$1--$2"))});
  else if (type === "inproceedings" || type === "incollection") Object.assign(f, {booktitle: tex(container), pages: tex((m.page || "").replace(/(\d)\s*[-–—]+\s*(\d)/, "$1--$2")), publisher: tex(m.publisher || "")});
  else if (type === "book") Object.assign(f, {publisher: tex(m.publisher || ""), volume: tex(m.volume || "")});
  else Object.assign(f, {howpublished: tex(container), publisher: tex(m.publisher || "")});
  f.year = year; f.doi = (m.DOI || doi).replace(/[{}]/g, "");
  return {type, key: makeKey(authors, year, title), entry: build(type, makeKey(authors, year, title), f), title, authors: authors.map(person).join("; "), year, doi: f.doi};
}

// ---------- arXiv ----------
export function fromArxiv(xml, id) {
  const e = /<entry>([^]*?)<\/entry>/.exec(xml)?.[1];
  if (!e || /<title>\s*Error\s*<\/title>/i.test(e)) return null;
  const tag = n => { const r = new RegExp(`<${n}[^>]*>([^]*?)</${n}>`, "i").exec(e); return r ? plain(r[1]) : ""; };
  const title = tag("title"), year = (tag("published") || "").slice(0, 4);
  if (!title) return null;
  const authors = [...e.matchAll(/<author>\s*<name>([^<]*)<\/name>/g)].map(m => { const n = plain(m[1]), parts = n.split(/\s+/); return {family: parts.pop() || n, given: parts.join(" ")}; });
  const cat = /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(e)?.[1] || "";
  const doi = tag("arxiv:doi");
  const key = makeKey(authors, year, title);
  const f = {author: authors.map(a => tex(person(a))).join(" and "), title: "{" + tex(title) + "}", year, eprint: id, archivePrefix: "arXiv", primaryClass: cat, url: `https://arxiv.org/abs/${id}`, doi: doi.replace(/[{}]/g, "")};
  return {type: "misc", key, entry: build("misc", key, f), title, authors: authors.map(person).join("; "), year, doi, arxiv: id};
}

// ---------- Consulta ----------
async function get(url, accept) {
  let res;
  try { res = await fetch(url, {headers: {"User-Agent": UA, Accept: accept}, signal: AbortSignal.timeout(12000)}); }
  catch (e) { const err = new Error("No pude conectarme a internet para consultar la referencia. Revisa tu conexión e inténtalo de nuevo."); err.status = 502; throw err; }
  return res;
}
export async function lookup(raw) {
  const p = parseId(raw);
  if (!p) { const e = new Error("No reconozco ese identificador. Pega un DOI (10.1007/…, o el enlace doi.org) o un identificador de arXiv (2301.01234 o el enlace de arxiv.org)."); e.status = 400; throw e; }
  if (p.kind === "doi") {
    const r = await get(CROSSREF + encodeURI(p.id), "application/json");
    if (r.status === 404) { const e = new Error(`Crossref no conoce el DOI «${p.id}». Revisa que esté completo; algunos artículos (por ejemplo, de arXiv) no tienen DOI en Crossref.`); e.status = 404; throw e; }
    if (!r.ok) { const e = new Error(`Crossref respondió con un error (${r.status}). Inténtalo más tarde.`); e.status = 502; throw e; }
    const j = await r.json().catch(() => null);
    if (!j?.message) { const e = new Error("Crossref devolvió una respuesta inesperada."); e.status = 502; throw e; }
    return {...fromCrossref(j.message, p.id), source: "Crossref"};
  }
  const r = await get(`${ARXIV}?id_list=${encodeURIComponent(p.id)}&max_results=1`, "application/atom+xml");
  if (!r.ok) { const e = new Error(`arXiv respondió con un error (${r.status}). Inténtalo más tarde.`); e.status = 502; throw e; }
  const out = fromArxiv(await r.text(), p.id);
  if (!out) { const e = new Error(`arXiv no tiene el identificador «${p.id}».`); e.status = 404; throw e; }
  return {...out, source: "arXiv"};
}

// ---------- Rutas ----------
export function registerBib(app, h) {
  const {db, who, okPath, clashes, getDocText, lastVersion, addVersion, flushPending, setDocText, takeSnapshot, touch, log, track} = h;
  app.post("/api/bib/lookup", async (q, r) => {
    try { r.json(await lookup(q.body?.id)); }
    catch (e) { r.status(e.status || 500).json({error: e.message}); }
  });
  // Agrega la entrada al final de un .bib del proyecto (lo crea si no existe). Evita claves repetidas y avisa si el DOI ya estaba.
  app.post("/api/projects/:id/bib", async (q, r) => {
    const project = q.params.id, file = String(q.body?.file || "referencias.bib"), entry = String(q.body?.entry || "").trim();
    if (!db.prepare("select 1 from projects where id=?").get(project)) return r.status(404).json({error: "El proyecto no existe."});
    if (!okPath(file) || !/\.bib$/i.test(file)) return r.status(400).json({error: "El archivo debe tener extensión .bib y un nombre válido."});
    const m = /^@(\w+)\s*\{\s*([^,\s]+)\s*,/.exec(entry);
    if (!m || entry.length > 20000 || !entry.endsWith("}") || (entry.match(/\{/g) || []).length !== (entry.match(/\}/g) || []).length) return r.status(400).json({error: "La entrada no parece una referencia BibTeX válida (debe empezar con @tipo{clave, y terminar con })."});
    // Claves que ya existen en todos los .bib del proyecto
    const bibs = db.prepare("select path,kind from files where project=?").all(project).filter(f => /\.bib$/i.test(f.path) && f.kind === "text");
    const all = bibs.map(f => getDocText(`${project}/${f.path}`)).join("\n");
    const doi = /\bdoi\s*=\s*[{"]\s*([^}"]+?)\s*[}"]/i.exec(entry)?.[1]?.toLowerCase();
    if (doi && all.toLowerCase().includes(doi) && !q.body.force) return r.status(409).json({error: "Esa referencia (mismo DOI) ya está en tu bibliografía.", dup: true});
    const keys = new Set([...all.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)].map(x => x[1]));
    let key = m[2], n = 0; while (keys.has(key)) key = m[2] + String.fromCharCode(97 + n++ % 26) + (n > 26 ? n : "");
    const final = key === m[2] ? entry : entry.replace(m[0], `@${m[1]}{${key},`);
    const me = who(q), doc = `${project}/${file}`, existing = db.prepare("select kind from files where project=? and path=?").get(project, file);
    try {
      if (!existing) {
        const all2 = db.prepare("select path from files where project=?").all(project).map(f => f.path);
        if (clashes(all2, file)) return r.status(409).json({error: `«${file}» choca con una carpeta o archivo que ya existe.`});
        const before = takeSnapshot(project);
        db.prepare("insert into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)").run(project, file, "text", final + "\n", null, null);
        touch(project); log(project, me, "create", file, "", before);
      } else {
        if (existing.kind !== "text") return r.status(400).json({error: `«${file}» no es un archivo de texto.`});
        flushPending(doc);
        const now = getDocText(doc);
        if (now !== lastVersion(doc)?.text) addVersion(doc, "", "Antes de agregar una referencia", true, now);
        const next = now.replace(/\s*$/, "") + (now.trim() ? "\n\n" : "") + final + "\n";
        await setDocText(doc, next, me);
        addVersion(doc, me, "Referencia agregada: " + key, false, next);
        track.delete(doc); touch(project);
      }
      r.json({ok: true, key, file, renamed: key !== m[2]});
    } catch (e) { r.status(500).json({error: "No se pudo guardar la referencia: " + e.message}); }
  });
}
