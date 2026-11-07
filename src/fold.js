// Plegado de código LaTeX: entornos (\begin…\end) y secciones (\section, \chapter…), con la flechita junto al número de línea.
import {foldService, codeFolding} from "@codemirror/language";

const LEVEL = {part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6};
const HEAD = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[\[{]/;
const BEGIN = /^\s*\\begin\{([^}]+)\}/;
const STOP = /^\s*\\(end\{document\}|appendix\b|bibliographystyle\b|bibliography\{|printbibliography\b|backmatter\b)/;
const MAX_LINES = 40000;
const nocomment = t => t.replace(/(^|[^\\])%.*$/, "$1");
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function envEnd(state, line, env) {                       // línea donde se cierra el entorno que abre `line` (o null)
  const open = new RegExp("\\\\begin\\{" + esc(env) + "\\}", "g"), close = new RegExp("\\\\end\\{" + esc(env) + "\\}", "g");
  const count = (t, re) => (t.match(re) || []).length;
  let depth = 0, t = nocomment(line.text);
  depth += count(t, open) - count(t, close);
  if (depth <= 0) return null;                            // se abre y se cierra en la misma línea
  const last = Math.min(state.doc.lines, line.number + MAX_LINES);
  for (let n = line.number + 1; n <= last; n++) {
    const l = state.doc.line(n); t = nocomment(l.text);
    depth += count(t, open) - count(t, close);
    if (depth <= 0) return l;
  }
  return null;
}

function sectionEnd(state, line, level) {                 // última línea de contenido de la sección, sin las vacías del final
  const last = Math.min(state.doc.lines, line.number + MAX_LINES);
  let end = line.number;
  for (let n = line.number + 1; n <= last; n++) {
    const t = state.doc.line(n).text, h = HEAD.exec(t);
    if ((h && LEVEL[h[1]] <= level) || STOP.test(t)) break;
    end = n;
  }
  while (end > line.number && !state.doc.line(end).text.trim()) end--;
  return end > line.number ? state.doc.line(end) : null;
}

const service = foldService.of((state, from) => {
  const line = state.doc.lineAt(from), text = line.text;
  if (!text.includes("\\")) return null;
  const h = HEAD.exec(text);
  if (h) { const e = sectionEnd(state, line, LEVEL[h[1]]); return e ? {from: line.to, to: e.to} : null; }
  const b = BEGIN.exec(text);
  if (b && b[1] !== "document") {                           // \begin{document} no se pliega: «plegar todo» plegaría el documento entero
    const e = envEnd(state, line, b[1]); if (!e) return null;
    const before = state.doc.line(e.number - 1);          // la línea del \end se queda visible
    return before.number > line.number ? {from: line.to, to: before.to} : null;
  }
  return null;
});

export const latexFold = () => [service, codeFolding({
  preparePlaceholder: (state, range) => state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
  placeholderDOM(view, onclick, prepared) {
    const s = document.createElement("span"); s.className = "cm-foldPlaceholder"; s.textContent = `⋯ ${prepared} ${prepared === 1 ? "línea" : "líneas"}`;
    s.title = "Clic para desplegar"; s.setAttribute("role", "button"); s.onclick = onclick; return s;
  },
})];
