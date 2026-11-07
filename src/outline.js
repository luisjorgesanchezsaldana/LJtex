// Esquema del documento: secciones y enunciados (teoremas, lemas, definiciones…), siguiendo \input / \include desde el archivo raíz.
const LEVEL = {part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6};
const NAMES = {theorem: "Teorema", thm: "Teorema", lemma: "Lema", lem: "Lema", proposition: "Proposición", prop: "Proposición", corollary: "Corolario", cor: "Corolario",
  definition: "Definición", defn: "Definición", dfn: "Definición", remark: "Observación", rem: "Observación", example: "Ejemplo", ex: "Ejemplo", conjecture: "Conjetura",
  claim: "Afirmación", observation: "Observación", notation: "Notación", fact: "Hecho", problem: "Problema", question: "Pregunta", exercise: "Ejercicio", axiom: "Axioma",
  assumption: "Hipótesis", hypothesis: "Hipótesis", proposicion: "Proposición", teorema: "Teorema", lema: "Lema", definicion: "Definición", corolario: "Corolario", ejemplo: "Ejemplo", observacion: "Observación"};
const nocomment = l => l.replace(/(^|[^\\])%.*$/, "$1");
const tidy = s => s.replace(/\\(?:label|ref|eqref|cite[a-z]*)\{[^}]*\}/g, "").replace(/\\(?:textbf|textit|emph|texttt|textsc|mathrm|text)\s*\{([^{}]*)\}/g, "$1")
  .replace(/\\[a-zA-Z]+\*?\s*/g, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
function group(text, i) {                          // texto del grupo {…} que empieza en text[i] === "{" (equilibrado)
  let d = 0;
  for (let k = i; k < text.length; k++) {
    const c = text[k]; if (c === "\\") { k++; continue; }
    if (c === "{") d++; else if (c === "}" && --d === 0) return text.slice(i + 1, k);
  }
  return text.slice(i + 1);
}

// Extrae los elementos de un archivo
export function parseFile(text, file, extra = {}) {
  const names = {...NAMES, ...extra};
  for (const m of text.matchAll(/\\newtheorem\*?\{([^}]+)\}(?:\[[^\]]*\])?\{([^}]*)\}/g)) names[m[1]] = tidy(m[2]) || names[m[1]] || m[1];
  const lines = text.split("\n"), items = [], incs = [];
  let inDoc = !/\\begin\{document\}/.test(text);                       // en archivos incluidos no hay \begin{document}
  const lineOf = new Array(lines.length);
  let off = 0; lines.forEach((l, n) => { lineOf[n] = off; off += l.length + 1; });
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n], l = nocomment(raw);
    if (!inDoc) { if (/\\begin\{document\}/.test(l)) inDoc = true; continue; }
    if (/\\end\{document\}/.test(l)) break;
    const inc = /\\(input|include|subfile)\s*\{([^}]+)\}/.exec(l); if (inc) { incs.push({at: items.length, name: inc[2].trim(), line: n + 1}); continue; }
    const sec = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/.exec(l);
    if (sec) {
      const i = lineOf[n] + sec.index + sec[0].length - 1;
      let title = tidy(group(text, i)); if (!title) title = "(sin título)";
      items.push({file, line: n + 1, kind: "sec", level: LEVEL[sec[1]], star: !!sec[2], title}); continue;
    }
    if (/\\appendix\b/.test(l)) { items.push({file, line: n + 1, kind: "mark", level: 0, title: "Apéndices"}); continue; }
    if (/\\begin\{abstract\}/.test(l)) { items.push({file, line: n + 1, kind: "mark", level: 2, title: "Resumen"}); continue; }
    if (/\\(bibliography\{|printbibliography)/.test(l)) { items.push({file, line: n + 1, kind: "mark", level: 2, title: "Bibliografía"}); continue; }
    const env = /\\begin\{([A-Za-z]+)(\*?)\}(?:\s*\[([^\]]*)\])?/.exec(l);
    if (env && names[env[1]]) {
      let label = "", rest = l.slice(env.index + env[0].length);
      for (let k = n; k < Math.min(lines.length, n + 4) && !label; k++) { const m = /\\label\{([^}]+)\}/.exec(nocomment(lines[k])); if (m) label = m[1]; }
      let ex = tidy(rest), k = n + 1;
      while (ex.length < 3 && k < Math.min(lines.length, n + 6)) { ex = tidy(nocomment(lines[k++])); }
      items.push({file, line: n + 1, kind: "stm", env: env[1], star: !!env[2], name: names[env[1]], opt: tidy(env[3] || ""), label, excerpt: ex.slice(0, 70)});
    }
  }
  return {items, incs};
}

// Resuelve el nombre de \input{…} a un archivo del proyecto
function resolve(name, from, has) {
  const dir = from.includes("/") ? from.replace(/\/[^/]*$/, "/") : "";
  for (const base of [name, dir + name]) for (const c of [base, base + ".tex"]) { const p = c.replace(/^\.\//, ""); if (has(p)) return p; }
  return null;
}

// Esquema completo desde `root`; `textOf(path)` devuelve el texto (o null si no está disponible).
export function buildOutline(root, textOf, has, paths = []) {
  const out = [], seen = new Set(), extra = {};
  for (const p of paths) {                                // \newtheorem puede estar en otro archivo (el preámbulo)
    const t = textOf(p); if (typeof t !== "string") continue;
    for (const m of t.matchAll(/\\newtheorem\*?\{([^}]+)\}(?:\[[^\]]*\])?\{([^}]*)\}/g)) extra[m[1]] = tidy(m[2]) || m[1];
  }
  const walk = path => {
    if (seen.has(path)) return; seen.add(path);
    const t = textOf(path); if (typeof t !== "string") return;
    const {items, incs} = parseFile(t, path, extra);
    let ii = 0;
    const flush = upto => { while (ii < upto) out.push(items[ii++]); };
    for (const inc of incs) { flush(inc.at); const p = resolve(inc.name, path, has); if (p) walk(p); }
    flush(items.length);
  };
  if (has(root)) walk(root);
  return {items: out, reached: seen};
}

// Asigna la sangría: los niveles de sección presentes se numeran 0,1,2…; los enunciados cuelgan de su sección
export function layout(items, showStm) {
  const lv = [...new Set(items.filter(i => i.kind === "sec").map(i => i.level))].sort((a, b) => a - b), rank = new Map(lv.map((l, i) => [l, i]));
  let d = -1;
  const res = [];
  for (const it of items) {
    if (it.kind === "sec") { d = rank.get(it.level); res.push({...it, depth: d}); }
    else if (it.kind === "mark") res.push({...it, depth: it.level === 0 ? 0 : Math.max(0, d)});
    else if (showStm) res.push({...it, depth: d + 1});
  }
  return res;
}
