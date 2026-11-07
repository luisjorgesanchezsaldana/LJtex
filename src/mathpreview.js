// Vista previa de fórmulas: al pasar el cursor sobre $…$, $$…$$, \(…\), \[…\] o un entorno (equation, align…), muestra la fórmula renderizada.
import {hoverTooltip} from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";

const ENVS = {equation: "", align: "aligned", alignat: "aligned", flalign: "aligned", gather: "gathered", multline: "gathered", eqnarray: "aligned", displaymath: "", math: ""};
const MAXLINES = 80, MAXLEN = 4000;

// Quita comentarios (% no escapado) conservando longitudes
const blank = t => t.replace(/(^|[^\\])%.*$/gm, (m, a) => a + " ".repeat(m.length - a.length));

// Macros del documento: \newcommand{\R}{\mathbb{R}}, \def\R{…}, \DeclareMathOperator{\sen}{sen}
function macros(text) {
  const m = {}, t = blank(text.slice(0, 200000));
  const grab = (s, i) => { if (s[i] !== "{") return null; let d = 0; for (let k = i; k < s.length; k++) { if (s[k] === "\\") { k++; continue; } if (s[k] === "{") d++; else if (s[k] === "}" && --d === 0) return [s.slice(i + 1, k), k + 1]; } return null; };
  for (const x of t.matchAll(/\\(?:re|provide)?newcommand\*?\s*\{?(\\[A-Za-z]+)\}?\s*(\[\d\])?\s*(\[[^\]]*\])?\s*(?=\{)/g)) {
    const g = grab(t, x.index + x[0].length); if (g) m[x[1]] = g[0].replace(/#(\d)/g, "#$1");
  }
  for (const x of t.matchAll(/\\def\s*(\\[A-Za-z]+)\s*(?=\{)/g)) { const g = grab(t, x.index + x[0].length); if (g) m[x[1]] = g[0]; }
  for (const x of t.matchAll(/\\DeclareMathOperator(\*?)\s*\{(\\[A-Za-z]+)\}\s*(?=\{)/g)) {
    const g = grab(t, x.index + x[0].length); if (g) m[x[2]] = `\\operatorname${x[1] ? "*" : ""}{${g[0]}}`;
  }
  return m;
}

// Busca la fórmula que contiene `pos` dentro del párrafo (entre líneas en blanco, con tope)
function findMath(state, pos) {
  const doc = state.doc, ln = doc.lineAt(pos);
  let a = ln.number, b = ln.number;
  while (a > 1 && ln.number - a < MAXLINES && doc.line(a - 1).text.trim() !== "") a--;
  while (b < doc.lines && b - ln.number < MAXLINES && doc.line(b + 1).text.trim() !== "") b++;
  const base = doc.line(a).from, raw = doc.sliceString(base, doc.line(b).to), t = blank(raw), rel = pos - base;
  const n = t.length;
  let i = 0;
  while (i < n) {
    const c = t[i];
    if (c === "\\") {
      const d = t[i + 1];
      if (d === "(" || d === "[") {
        const close = d === "(" ? "\\)" : "\\]", k = t.indexOf(close, i + 2);
        if (k < 0) return null;
        if (rel >= i && rel < k + 2) return {from: base + i, to: base + k + 2, src: t.slice(i + 2, k), display: d === "["};
        i = k + 2; continue;
      }
      const e = /^\\begin\{([A-Za-z]+)(\*?)\}/.exec(t.slice(i, i + 40));
      if (e && e[1] in ENVS) {
        const end = `\\end{${e[1]}${e[2]}}`, k = t.indexOf(end, i + e[0].length);
        if (k < 0) return null;
        if (rel >= i && rel < k + end.length) {
          let body = t.slice(i + e[0].length, k);
          if (e[1] === "alignat") body = body.replace(/^\s*\{\d+\}/, "");
          const w = ENVS[e[1]], src = w ? `\\begin{${w}}${body}\\end{${w}}` : body;
          return {from: base + i, to: base + k + end.length, src, display: true};
        }
        i = k + end.length; continue;
      }
      i += 2; continue;
    }
    if (c === "$") {
      const dbl = t[i + 1] === "$", st = i; i += dbl ? 2 : 1;
      let k = -1;
      for (let j = i; j < n; j++) {
        if (t[j] === "\\") { j++; continue; }
        if (t[j] === "$") { k = j; break; }
      }
      if (k < 0) return null;
      const stop = dbl ? k + 2 : k + 1;
      if (rel >= st && rel < stop) return {from: base + st, to: base + stop, src: t.slice(i, k), display: dbl};
      i = stop; continue;
    }
    i++;
  }
  return null;
}

function clean(src) {
  return src.replace(/\\label\{[^}]*\}/g, "").replace(/\\(nonumber|notag)\b/g, "").replace(/\\(?:text)?(?:ref|eqref|cite[a-z]*)\{([^}]*)\}/g, "\\text{[$1]}").trim();
}

export function mathHover() {
  let cache = {len: -1, text: "", m: {}};
  return hoverTooltip((view, pos) => {
    const f = findMath(view.state, pos);
    if (!f || f.src.length > MAXLEN) return null;
    const src = clean(f.src);
    if (!src) return null;
    return {
      pos: f.from, end: f.to, above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-mathprev";
        const doc = view.state.doc;
        if (cache.len !== doc.length) cache = {len: doc.length, m: macros(doc.sliceString(0, Math.min(doc.length, 200000)))};
        try { dom.innerHTML = katex.renderToString(src, {displayMode: true, throwOnError: false, strict: "ignore", trust: false, macros: {...cache.m}, output: "html", maxExpand: 500, maxSize: 20}); }
        catch { dom.textContent = "No se pudo mostrar esta fórmula."; dom.classList.add("bad"); }
        return {dom};
      },
    };
  }, {hoverTime: 350});
}
