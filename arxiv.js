// Preparar un proyecto para enviarlo a arXiv: un .zip con solo lo que el documento usa, el .bbl ya generado
// (arXiv no corre BibTeX/Biber), sin comentarios si se pide, y comprobado compilándolo de nuevo como lo hará arXiv.
import {execFile} from "child_process";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync} from "fs";
import {join, dirname, relative, normalize, extname} from "path";
import {tmpdir} from "os";
import {zipSync, strToU8} from "fflate";
import {randomUUID} from "crypto";

// ---------- Quitar comentarios ----------
// Deja el «%» final (para no meter espacios donde el autor los evitaba) y borra las líneas que son solo comentario.
// No toca entornos verbatim ni líneas con \url/\href (pueden llevar % legítimos); quita \begin{comment}…\end{comment}.
const VERB = /\\begin\{(verbatim\*?|Verbatim\*?|lstlisting|minted|comment|filecontents\*?)\}/;
export function stripComments(src) {
  const out = []; let inVerb = null;
  for (const line of String(src).split("\n")) {
    if (inVerb) {
      if (line.includes(`\\end{${inVerb}}`)) { if (inVerb !== "comment") out.push(line); else { const rest = line.slice(line.indexOf(`\\end{comment}`) + 13); if (rest.trim()) out.push(rest); } inVerb = null; }
      else if (inVerb !== "comment") out.push(line);
      continue;
    }
    const v = VERB.exec(line.replace(/(^|[^\\])%.*$/, "$1"));
    if (v) {
      inVerb = v[1];
      if (inVerb === "comment") { const before = line.slice(0, v.index); if (before.trim()) out.push(before); if (line.includes("\\end{comment}", v.index)) inVerb = null; continue; }
      out.push(line); if (line.includes(`\\end{${inVerb}}`, v.index)) inVerb = null; continue;
    }
    if (/\\(url|href)\{/.test(line)) { out.push(line); continue; }
    const i = firstComment(line);
    if (i < 0) { out.push(line); continue; }
    if (!line.slice(0, i).trim()) continue;            // línea que era solo comentario: fuera
    out.push(line.slice(0, i + 1));                     // texto + «%»
  }
  // no dejar más de una línea en blanco seguida (los párrafos se conservan)
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
function firstComment(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "%") continue;
    let k = i - 1, bs = 0; while (k >= 0 && line[k] === "\\") { bs++; k--; }
    if (bs % 2 === 0) return i;                         // «%» no escapado
  }
  return -1;
}

// ---------- Juntar \input / \include en un solo archivo ----------
export function flatten(mainPath, files, seen = new Set()) {
  const text = files.get(mainPath);
  if (text == null || seen.has(mainPath)) return text ?? "";
  seen.add(mainPath);
  const dir = dirname(mainPath) === "." ? "" : dirname(mainPath) + "/";
  return text.replace(/^([^%\n]*?)\\(input|include)\s*\{([^}]+)\}/gm, (m, pre, cmd, arg) => {
    if (/(^|[^\\])%/.test(pre)) return m;
    const cands = [arg, arg + ".tex", dir + arg, dir + arg + ".tex"].map(p => normalize(p).replace(/^\.\//, ""));
    const hit = cands.find(p => files.has(p));
    if (!hit) return m;                                 // no es del proyecto (p. ej. un paquete): se deja
    const body = flatten(hit, files, seen).replace(/\s+$/, "");
    return pre + (cmd === "include" ? `\\clearpage\n${body}\n\\clearpage` : `${body}\n`);
  });
}

const run = (cmd, args, cwd, ms) => new Promise(res => execFile(cmd, args, {cwd, timeout: ms, maxBuffer: 20e6}, (err, so, se) => res({err, out: String(so) + String(se)})));
const safeName = p => /^[A-Za-z0-9._\-\/+]+$/.test(p);
const BIG = 10e6;

export function registerArxiv(app, h) {
  const {db, getDocText, mainOf, engineOf, takeLock, freeLock} = h;
  const ready = new Map();   // id de descarga → {zip, name, t}

  app.post("/api/projects/:id/arxiv", async (q, r) => {
    const id = q.params.id;
    const p = db.prepare("select name from projects where id=?").get(id);
    if (!p) return r.status(404).json({error: "El proyecto no existe."});
    const opt = {strip: q.body?.strip !== false, flat: !!q.body?.flat, bib: !!q.body?.bib};
    const rows = db.prepare("select path,kind,text,data from files where project=?").all(id);
    const text = new Map(rows.filter(f => f.kind === "text").map(f => [f.path, getDocText(`${id}/${f.path}`)]));
    const bin = new Map(rows.filter(f => f.kind !== "text").map(f => [f.path, Buffer.from(f.data || [])]));
    const main = mainOf(id);
    if (!text.has(main)) return r.status(422).json({error: `El archivo principal «${main}» no existe. Elígelo con el botón «Principal» de la barra del PDF.`});
    const base = main.split("/").at(-1).replace(/\.[^.]*$/, "");
    const warn = [], eng = engineOf(id);
    if (eng === "xelatex" || eng === "lualatex") warn.push(`Tu proyecto compila con ${eng === "xelatex" ? "XeLaTeX" : "LuaLaTeX"}, pero arXiv compila con pdfLaTeX. La comprobación de abajo usa pdfLaTeX: si falla, revisa los paquetes de fuentes (fontspec, etc.).`);

    if (!(await takeLock())) return r.status(429).json({error: "Hay otra compilación en curso. Inténtalo de nuevo en unos segundos."});
    const work = mkdtempSync(join(tmpdir(), "arxiv-"));
    try {
      // 1) Compilar el proyecto tal cual, registrando qué archivos lee (-recorder) y generando el .bbl
      const src = join(work, "src"); mkdirSync(src);
      for (const [path, t] of text) { const f = join(src, path); mkdirSync(dirname(f), {recursive: true}); writeFileSync(f, t); }
      for (const [path, d] of bin) { const f = join(src, path); mkdirSync(dirname(f), {recursive: true}); writeFileSync(f, d); }
      const flags = "-no-shell-escape -interaction=nonstopmode -file-line-error %O %S";
      const c1 = await run("latexmk", ["-norc", "-recorder", "-pdf", `-pdflatex=pdflatex ${flags}`, main], src, 120000);
      if (!existsSync(join(src, base + ".pdf"))) {
        const log = existsSync(join(src, base + ".log")) ? readFileSync(join(src, base + ".log"), "utf8") : c1.out;
        return r.json({ok: false, stage: "compile", error: "El proyecto no compila con pdfLaTeX, así que todavía no se puede preparar para arXiv.", log: log.slice(-6000), warn});
      }

      // 2) Qué archivos del proyecto usó de verdad (según el registro .fls)
      const fls = readFileSync(join(src, base + ".fls"), "utf8");
      const used = new Set();
      for (const m of fls.matchAll(/^INPUT (.+)$/gm)) {
        let f = m[1].trim(); if (f.startsWith(src)) f = relative(src, f); else if (f.startsWith("/")) continue;
        f = normalize(f).replace(/^\.\//, "");
        if (text.has(f) || bin.has(f)) used.add(f);
      }
      used.add(main);
      const bbl = existsSync(join(src, base + ".bbl")) ? readFileSync(join(src, base + ".bbl"), "utf8") : null;
      const usesBib = [...text.values()].some(t => /^[^%\n]*\\(bibliography|addbibresource)\s*\{/m.test(t));
      const biblatex = [...text.values()].some(t => /^[^%\n]*\\usepackage(\[[^\]]*\])?\{biblatex\}/m.test(t));
      if (usesBib && !bbl) warn.push("Tu documento tiene bibliografía pero no se generó el .bbl; revisa que la bibliografía compile.");
      if (biblatex) warn.push("Usas biblatex: arXiv solo acepta el .bbl si fue generado con la misma versión de biblatex que tiene arXiv. Si arXiv se queja de la versión del .bbl, cambia a BibTeX (natbib/amsrefs) o súbelo con el .bib.");
      if ([...text.values()].some(t => /^[^%\n]*\\usepackage(\[[^\]]*\])?\{minted\}/m.test(t))) warn.push("Usas minted, que necesita -shell-escape: arXiv no lo permite. Cambia a listings.");

      // 3) Armar el paquete
      const pack = new Map();
      if (opt.flat) {
        pack.set(main, flatten(main, text));
        for (const f of used) if (bin.has(f)) pack.set(f, bin.get(f));
        for (const f of used) if (text.has(f) && !/\.tex$/i.test(f)) pack.set(f, text.get(f));   // .sty, .cls, .bst propios
      } else for (const f of used) pack.set(f, text.has(f) ? text.get(f) : bin.get(f));
      for (const [f, v] of pack) if (typeof v === "string" && /\.(tex|ltx)$/i.test(f) && opt.strip) pack.set(f, stripComments(v));
      if (bbl) pack.set(join(dirname(main), base + ".bbl").replace(/^\.\//, ""), bbl);
      if (opt.bib) for (const [f, t] of text) if (/\.bib$/i.test(f)) pack.set(f, t);
      // .bib que ya no hacen falta (está el .bbl)
      if (!opt.bib && bbl) for (const f of [...pack.keys()]) if (/\.bib$/i.test(f)) pack.delete(f);

      for (const f of pack.keys()) if (!safeName(f)) warn.push(`«${f}» tiene espacios, acentos u otros caracteres que arXiv no acepta en los nombres de archivo. Renómbralo.`);
      const big = [...pack].filter(([, v]) => (typeof v === "string" ? Buffer.byteLength(v) : v.length) > BIG).map(([f]) => f);
      if (big.length) warn.push(`Archivos grandes (más de 10 MB): ${big.join(", ")}. arXiv limita el tamaño total del envío; considera comprimir esas figuras.`);
      const dropped = [...text.keys(), ...bin.keys()].filter(f => !pack.has(f) && !(opt.flat && used.has(f)));

      // 4) Comprobar: compilar el paquete en una carpeta nueva, sin BibTeX (como arXiv)
      const chk = join(work, "chk"); mkdirSync(chk);
      for (const [f, v] of pack) { const pth = join(chk, f); mkdirSync(dirname(pth), {recursive: true}); writeFileSync(pth, v); }
      const once = () => run("pdflatex", ["-no-shell-escape", "-interaction=nonstopmode", "-file-line-error", main], chk, 90000);
      await once(); await once(); const c3 = await once();
      const pdfPath = join(chk, base + ".pdf");
      const okPdf = existsSync(pdfPath);
      const log = existsSync(join(chk, base + ".log")) ? readFileSync(join(chk, base + ".log"), "utf8") : c3.out;
      const pages = +(/Output written on .*?\((\d+) pages?/.exec(log)?.[1] || 0);
      const undef = new Set([...log.matchAll(/(?:Reference|Citation) [`']([^']+)' on page \d+ undefined/g)].map(m => m[1]));
      const errs = [...new Set([...log.matchAll(/^(?:\.\/)?[^\s:][^:\n]*:\d+: .+$/gm)].map(m => m[0]))].slice(0, 8);
      if (undef.size) warn.push(`Quedaron referencias o citas sin resolver: ${[...undef].slice(0, 8).join(", ")}${undef.size > 8 ? "…" : ""}.`);

      // 5) Guardar el .zip para descargarlo
      const files = {};
      for (const [f, v] of pack) files[f] = typeof v === "string" ? strToU8(v) : new Uint8Array(v);
      const zip = Buffer.from(zipSync(files, {level: 9}));
      const dl = randomUUID();
      ready.set(dl, {zip, name: p.name, t: Date.now()});
      for (const [k, v] of ready) if (Date.now() - v.t > 30 * 60000) ready.delete(k);
      r.json({ok: okPdf && !errs.length, compiled: okPdf, pages, errors: errs, warn, dl, size: zip.length,
        files: [...pack.keys()].sort(), dropped: dropped.sort(), main, bbl: !!bbl, log: okPdf && !errs.length ? undefined : log.slice(-6000)});
    } catch (e) {
      r.status(500).json({error: "No se pudo preparar el paquete: " + e.message});
    } finally {
      freeLock();
      rmSync(work, {recursive: true, force: true});
    }
  });

  app.get("/api/arxiv/:dl", (q, r) => {
    const z = ready.get(q.params.dl);
    if (!z) return r.status(404).json({error: "El paquete ya no está disponible; vuelve a prepararlo."});
    r.set({"Content-Type": "application/zip", "Cache-Control": "no-store"}).send(z.zip);
  });
}
