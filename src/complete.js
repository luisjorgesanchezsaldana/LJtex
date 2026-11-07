// Autocompletado para LaTeX: comandos, entornos, símbolos y operadores matemáticos,
// claves de bibliografía (.bib), etiquetas (\label), archivos del proyecto y paquetes.
import {snippetCompletion, acceptCompletion, snippet, completionStatus} from "@codemirror/autocomplete";
import {EditorState, Prec} from "@codemirror/state";
import {keymap} from "@codemirror/view";

// ---------- Catálogos ----------
// [nombre, plantilla (sin la barra), detalle]. ${} = hueco; con nombre, se repite donde aparezca igual.
const TEXT = [
  ["section", "section{${}}", "sección"], ["subsection", "subsection{${}}", "subsección"], ["subsubsection", "subsubsection{${}}", "subsubsección"],
  ["chapter", "chapter{${}}", "capítulo"], ["part", "part{${}}", "parte"], ["paragraph", "paragraph{${}}", "párrafo con título"],
  ["textbf", "textbf{${}}", "negrita"], ["textit", "textit{${}}", "cursiva"], ["emph", "emph{${}}", "énfasis"], ["underline", "underline{${}}", "subrayado"],
  ["texttt", "texttt{${}}", "monoespaciado"], ["textsc", "textsc{${}}", "versalitas"], ["textsf", "textsf{${}}", "sans serif"],
  ["textcolor", "textcolor{${red}}{${}}", "color de texto"], ["footnote", "footnote{${}}", "nota al pie"], ["url", "url{${}}", "enlace"],
  ["href", "href{${https://}}{${texto}}", "enlace con texto"],
  ["label", "label{${}}", "etiqueta"], ["ref", "ref{${}}", "referencia"], ["eqref", "eqref{${}}", "referencia a ecuación (1)"],
  ["pageref", "pageref{${}}", "número de página"], ["autoref", "autoref{${}}", "referencia con nombre (hyperref)"], ["cref", "cref{${}}", "referencia inteligente (cleveref)"],
  ["cite", "cite{${}}", "cita"], ["citep", "citep{${}}", "cita entre paréntesis (natbib)"], ["citet", "citet{${}}", "cita en el texto (natbib)"],
  ["parencite", "parencite{${}}", "cita (biblatex)"], ["textcite", "textcite{${}}", "cita en texto (biblatex)"], ["nocite", "nocite{${*}}", "incluir sin citar"],
  ["includegraphics", "includegraphics[width=${0.8\\linewidth}]{${}}", "insertar imagen"], ["caption", "caption{${}}", "pie de figura o tabla"],
  ["centering", "centering", "centrar"], ["item", "item ${}", "elemento de lista"], ["noindent", "noindent ", "sin sangría"],
  ["usepackage", "usepackage{${}}", "cargar paquete"], ["documentclass", "documentclass{${article}}", "clase del documento"],
  ["title", "title{${}}", "título"], ["author", "author{${}}", "autores"], ["date", "date{${\\today}}", "fecha"], ["maketitle", "maketitle", "mostrar el título"],
  ["tableofcontents", "tableofcontents", "índice"], ["listoffigures", "listoffigures", "índice de figuras"], ["appendix", "appendix", "apéndice"],
  ["newpage", "newpage", "página nueva"], ["clearpage", "clearpage", "página nueva y vaciar flotantes"], ["hline", "hline", "línea horizontal en tabla"],
  ["vspace", "vspace{${1em}}", "espacio vertical"], ["hspace", "hspace{${1em}}", "espacio horizontal"], ["quad", "quad", "espacio"],
  ["newcommand", "newcommand{\\${nombre}}[${0}]{${}}", "definir macro"], ["renewcommand", "renewcommand{\\${nombre}}[${0}]{${}}", "redefinir macro"],
  ["DeclareMathOperator", "DeclareMathOperator{\\${nombre}}{${}}", "definir operador"], ["newtheorem", "newtheorem{${teorema}}{${Teorema}}", "definir teorema"],
  ["input", "input{${}}", "incluir archivo"], ["include", "include{${}}", "incluir archivo (página nueva)"],
  ["bibliography", "bibliography{${}}", "archivo .bib (BibTeX)"], ["bibliographystyle", "bibliographystyle{${plain}}", "estilo de bibliografía"],
  ["addbibresource", "addbibresource{${}}", "archivo .bib (biblatex)"], ["printbibliography", "printbibliography", "imprimir bibliografía (biblatex)"],
  ["today", "today", "fecha de hoy"], ["LaTeX", "LaTeX", "logo"], ["ldots", "ldots", "puntos suspensivos"], ["textbackslash", "textbackslash", "barra invertida"],
  ["tiny", "tiny", "tamaño"], ["small", "small", "tamaño"], ["large", "large", "tamaño"], ["Large", "Large", "tamaño"], ["huge", "huge", "tamaño"],
];
const ENVS = [
  ["itemize", "lista con viñetas"], ["enumerate", "lista numerada"], ["description", "lista de descripciones"], ["equation", "ecuación numerada"],
  ["equation*", "ecuación sin número"], ["align", "ecuaciones alineadas"], ["align*", "ecuaciones alineadas sin número"], ["gather", "ecuaciones centradas"],
  ["multline", "ecuación larga"], ["split", "dividir una ecuación"], ["cases", "definición por casos"], ["matrix", "matriz"], ["pmatrix", "matriz con paréntesis"],
  ["bmatrix", "matriz con corchetes"], ["vmatrix", "determinante"], ["figure", "figura"], ["table", "tabla"], ["tabular", "tabla simple"],
  ["center", "centrado"], ["abstract", "resumen"], ["document", "documento"], ["theorem", "teorema"], ["lemma", "lema"], ["proposition", "proposición"],
  ["corollary", "corolario"], ["definition", "definición"], ["remark", "observación"], ["example", "ejemplo"], ["proof", "demostración"],
  ["verbatim", "texto literal"], ["quote", "cita"], ["minipage", "minipágina"], ["subfigure", "subfigura"], ["lstlisting", "código"], ["frame", "diapositiva (beamer)"],
];
const ENV_BODY = {tabular: "{${cc}}\n\t${}\n", figure: "[${htbp}]\n\t\\centering\n\t${}\n", table: "[${htbp}]\n\t\\centering\n\t${}\n", minipage: "{${0.5\\linewidth}}\n\t${}\n",
  subfigure: "{${0.45\\linewidth}}\n\t${}\n", frame: "\n\t${}\n"};
const GREEK = {alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω"};
const SYMS = {infty: "∞", partial: "∂", nabla: "∇", cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", leq: "≤", geq: "≥", neq: "≠", approx: "≈", equiv: "≡",
  sim: "∼", simeq: "≃", propto: "∝", ll: "≪", gg: "≫", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", in: "∈", notin: "∉", cup: "∪", cap: "∩",
  emptyset: "∅", forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐",
  Leftrightarrow: "⇔", leftrightarrow: "↔", mapsto: "↦", to: "→", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", circ: "∘", otimes: "⊗", oplus: "⊕",
  perp: "⊥", parallel: "∥", angle: "∠", hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", prime: "′", star: "⋆", bullet: "•", dagger: "†", quad: "␣", qquad: "␣␣"};
const MATH = [
  ["frac", "frac{${}}{${}}", "fracción"], ["dfrac", "dfrac{${}}{${}}", "fracción grande"], ["sqrt", "sqrt{${}}", "raíz cuadrada"], ["sqrt[n]", "sqrt[${n}]{${}}", "raíz n-ésima"],
  ["sum", "sum_{${i=1}}^{${n}} ${}", "sumatoria Σ"], ["prod", "prod_{${i=1}}^{${n}} ${}", "productoria Π"], ["int", "int_{${a}}^{${b}} ${} \\,d${x}", "integral ∫"],
  ["iint", "iint_{${D}} ${} \\,dA", "integral doble"], ["oint", "oint_{${C}} ${}", "integral de contorno ∮"], ["lim", "lim_{${x \\to \\infty}} ${}", "límite"],
  ["limsup", "limsup_{${n \\to \\infty}}", "límite superior"], ["liminf", "liminf_{${n \\to \\infty}}", "límite inferior"],
  ["binom", "binom{${n}}{${k}}", "coeficiente binomial"], ["left(", "left( ${} \\right)", "paréntesis ajustables"], ["left[", "left[ ${} \\right]", "corchetes ajustables"],
  ["left\\{", "left\\\\{ ${} \\right\\\\}", "llaves ajustables"], ["left|", "left| ${} \\right|", "barras ajustables"], ["langle", "langle ${} \\rangle", "⟨ ⟩"],
  ["mathbb", "mathbb{${R}}", "pizarra (ℝ, ℕ…)"], ["mathcal", "mathcal{${}}", "caligráfica"], ["mathbf", "mathbf{${}}", "negrita matemática"], ["mathrm", "mathrm{${}}", "romana"],
  ["mathfrak", "mathfrak{${}}", "gótica"], ["boldsymbol", "boldsymbol{${}}", "símbolo en negrita"], ["text", "text{${}}", "texto dentro de la fórmula"],
  ["operatorname", "operatorname{${}}", "operador con nombre"], ["vec", "vec{${}}", "vector"], ["hat", "hat{${}}", "sombrero"], ["bar", "bar{${}}", "barra"],
  ["tilde", "tilde{${}}", "tilde"], ["dot", "dot{${}}", "punto (derivada)"], ["ddot", "ddot{${}}", "doble punto"], ["overline", "overline{${}}", "línea superior"],
  ["underbrace", "underbrace{${}}_{${}}", "llave inferior"], ["overbrace", "overbrace{${}}^{${}}", "llave superior"], ["overset", "overset{${}}{${}}", "símbolo encima"],
  ["sin", "sin", "seno"], ["cos", "cos", "coseno"], ["tan", "tan", "tangente"], ["arcsin", "arcsin", "arcoseno"], ["arccos", "arccos", "arcocoseno"], ["arctan", "arctan", "arcotangente"],
  ["sinh", "sinh", "seno hiperbólico"], ["cosh", "cosh", "coseno hiperbólico"], ["tanh", "tanh", "tangente hiperbólica"],
  ["log", "log", "logaritmo"], ["ln", "ln", "logaritmo natural"], ["exp", "exp", "exponencial"], ["max", "max", "máximo"], ["min", "min", "mínimo"],
  ["sup", "sup", "supremo"], ["inf", "inf", "ínfimo"], ["det", "det", "determinante"], ["dim", "dim", "dimensión"], ["ker", "ker", "núcleo"], ["gcd", "gcd", "máximo común divisor"],
  ["arg", "arg", "argumento"], ["Pr", "Pr", "probabilidad"], ["mod", "mod", "módulo"], ["bmod", "bmod", "módulo binario"],
  ["mathbb{E}", "mathbb{E}", "esperanza 𝔼"], ["mathbb{R}", "mathbb{R}", "reales ℝ"], ["mathbb{N}", "mathbb{N}", "naturales ℕ"], ["mathbb{Z}", "mathbb{Z}", "enteros ℤ"],
  ["mathbb{Q}", "mathbb{Q}", "racionales ℚ"], ["mathbb{C}", "mathbb{C}", "complejos ℂ"], ["mathbb{P}", "mathbb{P}", "probabilidad ℙ"],
  ["xrightarrow", "xrightarrow{${}}", "flecha con texto"], ["stackrel", "stackrel{${}}{${}}", "apilar"], ["not", "not", "negar un símbolo"],
];
const PKGS = ["amsmath", "amssymb", "amsthm", "mathtools", "graphicx", "hyperref", "geometry", "babel", "inputenc", "fontenc", "xcolor", "tikz", "pgfplots", "booktabs",
  "biblatex", "natbib", "float", "caption", "subcaption", "listings", "enumitem", "siunitx", "microtype", "setspace", "fancyhdr", "lmodern", "cleveref", "multirow",
  "array", "longtable", "algorithm", "algorithmic", "algpseudocode", "url", "csquotes", "cancel", "bm", "physics", "tcolorbox", "titlesec", "appendix", "authblk", "lipsum"];
const CLASSES = ["article", "report", "book", "amsart", "amsbook", "beamer", "memoir", "letter", "revtex4-2", "IEEEtran", "scrartcl", "scrreprt", "scrbook", "standalone"];
const BSTYLES = ["plain", "unsrt", "alpha", "abbrv", "apalike", "ieeetr", "siam", "acm", "plainnat", "abbrvnat", "unsrtnat"];
const MATHENVS = /^(equation|align|gather|multline|eqnarray|displaymath|math|flalign|alignat)\*?$/;
const IMG = /\.(png|jpe?g|pdf|svg|eps|gif|webp)$/i;

const cmd = (n, tpl, d, type, boost) => snippetCompletion("\\" + tpl, {label: "\\" + n, detail: d, type, boost});
const COMMANDS = () => {
  const out = [];
  for (const [n, t, d] of TEXT) out.push({c: [n, t, d, "function"], math: false});
  for (const [n, t, d] of MATH) out.push({c: [n, t, d, "keyword"], math: true});
  for (const [n, s] of Object.entries(GREEK)) out.push({c: [n, n, s, "keyword"], math: true});
  for (const [n, s] of Object.entries(SYMS)) out.push({c: [n, n, s, "keyword"], math: true});
  out.push({c: ["begin", "begin{${env}}\n\t${}\n\\end{${env}}", "entorno", "namespace"], math: false});
  out.push({c: ["end", "end{${}}", "cerrar entorno", "namespace"], math: false});
  for (const [e, d] of ENVS) out.push({c: [`begin{${e}}`, `begin{${e}}${ENV_BODY[e] ?? "\n\t${}\n"}\\end{${e}}`, d, "namespace"], math: MATHENVS.test(e), env: true});
  return out;
};
const ALL = COMMANDS();

// ---------- Contexto ----------
// ¿El cursor está dentro de una fórmula? Recorre el texto anterior (sin comentarios) alternando $, \[ \], \( \) y entornos matemáticos.
export function inMath(text) {
  const t = text.replace(/(^|[^\\])%[^\n]*/g, "$1");
  const re = /\\\$|\$\$|\$|\\\[|\\\]|\\\(|\\\)|\\(begin|end)\{([a-zA-Z*]+)\}/g;
  let m, dollar = false, dd = false, br = false, par = false, env = 0;
  while ((m = re.exec(t))) {
    const s = m[0];
    if (s === "$$") dd = !dd; else if (s === "$") dollar = !dollar;
    else if (s === "\\[") br = true; else if (s === "\\]") br = false;
    else if (s === "\\(") par = true; else if (s === "\\)") par = false;
    else if (m[1] && MATHENVS.test(m[2])) env += m[1] === "begin" ? 1 : -1;
  }
  return dollar || dd || br || par || env > 0;
}
// Entornos abiertos sin cerrar antes del cursor (el último es el más interno).
function openEnvs(text) {
  const t = text.replace(/(^|[^\\])%[^\n]*/g, "$1"), re = /\\(begin|end)\{([^}]+)\}/g, st = []; let m;
  while ((m = re.exec(t))) { if (m[1] === "begin") st.push(m[2]); else { const i = st.lastIndexOf(m[2]); if (i >= 0) st.length = i; } }
  return st;
}
const count = (text, s) => { let n = 0, i = -1; while ((i = text.indexOf(s, i + 1)) >= 0) n++; return n; };

// Al elegir un entorno dentro de \begin{…}: completa el nombre y, si falta, añade el \end{…} correspondiente.
function beginApply(name) {
  return (view, _c, from, to) => {
    const doc = view.state.doc, end = doc.sliceString(to, to + 1) === "}" ? to + 1 : to;
    const whole = doc.sliceString(0, from) + name + "}" + doc.sliceString(end);
    const needsEnd = doc.lineAt(end).to === end && count(whole, `\\begin{${name}}`) > count(whole, `\\end{${name}}`);
    if (needsEnd) {
      const ind = /^\s*/.exec(doc.lineAt(from).text)[0];
      view.dispatch({changes: {from, to: end, insert: `${name}}\n${ind}\t\n${ind}\\end{${name}}`}, selection: {anchor: from + name.length + 3 + ind.length},
        scrollIntoView: true, userEvent: "input.complete"});
    } else view.dispatch({changes: {from, to: end, insert: name + "}"}, selection: {anchor: from + name.length + 1}, userEvent: "input.complete"});
  };
}

// Completa el nombre y cierra la llave solo si no estaba ya cerrada (el editor suele cerrarla al escribir «{»).
const closeApply = name => (view, _c, from, to) => {
  const end = view.state.doc.sliceString(to, to + 1) === "}" ? to + 1 : to;
  view.dispatch({changes: {from, to: end, insert: name + "}"}, selection: {anchor: from + name.length + 1}, userEvent: "input.complete"});
};

// ---------- Datos del proyecto (bibliografía, etiquetas, archivos) ----------
function parseBib(text, file) {
  const out = [], re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g; let m;
  const hits = []; while ((m = re.exec(text))) if (!/^(string|preamble|comment)$/i.test(m[1])) hits.push({type: m[1], key: m[2], i: m.index});
  hits.forEach((h, k) => {
    const body = text.slice(h.i, hits[k + 1]?.i ?? text.length);
    const f = n => { const r = new RegExp(`\\b${n}\\s*=\\s*(?:\\{([^]*?)\\}\\s*(?:,|\\n|$)|"([^"]*)")`, "i").exec(body); return (r?.[1] ?? r?.[2] ?? "").replace(/\s+/g, " ").replace(/[{}]/g, "").trim(); };
    const au = f("author"), first = au.split(/\s+and\s+/)[0].split(",")[0].trim(), many = /\sand\s/.test(au);
    out.push({key: h.key, label: h.key, detail: [first && first + (many ? " et al." : ""), f("year") || f("date").slice(0, 4)].filter(Boolean).join(" "), info: f("title") || `${h.type} en ${file}`, type: "constant"});
  });
  return out;
}
const parseLabels = (text, file) => [...text.replace(/(^|[^\\])%[^\n]*/g, "$1").matchAll(/\\label\{([^}]+)\}/g)].map(m => ({label: m[1], detail: file, type: "constant"}));


// ---------- Macros y entornos definidos por el usuario ----------
// Devuelve el contenido de un grupo {…} que empieza en text[i] === "{" (con llaves anidadas), o null.
function group(text, i) {
  if (text[i] !== "{") return null;
  let d = 0;
  for (let j = i; j < text.length && j < i + 4000; j++) {
    const c = text[j];
    if (c === "\\") { j++; continue; }
    if (c === "{") d++; else if (c === "}" && --d === 0) return {body: text.slice(i + 1, j), end: j + 1};
  }
  return null;
}
export function parseMacros(raw, file) {
  const text = raw.replace(/(^|[^\\])%[^\n]*/g, "$1"), macros = [], envs = [];
  const clean = b => b.replace(/\s+/g, " ").trim();
  const add = (name, n, body, kind, how) => macros.push({name, n, body: clean(body), kind, file, how});
  let m, re = /\\(?:re|provide)?newcommand\*?\s*(?:\{\s*\\([a-zA-Z@]+)\s*\}|\\([a-zA-Z@]+))\s*(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*(?=\{)/g;
  while ((m = re.exec(text))) { const g = group(text, re.lastIndex); if (g) add(m[1] || m[2], +(m[3] || 0), g.body, "macro", m[0].trim().replace(/\s+/g, " ")); }
  re = /\\DeclareRobustCommand\*?\s*(?:\{\s*\\([a-zA-Z@]+)\s*\}|\\([a-zA-Z@]+))\s*(?:\[(\d)\])?\s*(?=\{)/g;
  while ((m = re.exec(text))) { const g = group(text, re.lastIndex); if (g) add(m[1] || m[2], +(m[3] || 0), g.body, "macro", "\\DeclareRobustCommand"); }
  re = /\\DeclareMathOperator\*?\s*\{\s*\\([a-zA-Z@]+)\s*\}\s*(?=\{)/g;
  while ((m = re.exec(text))) { const g = group(text, re.lastIndex); if (g) add(m[1], 0, g.body, "operador", "\\DeclareMathOperator"); }
  re = /\\DeclarePairedDelimiter\s*\{\s*\\([a-zA-Z@]+)\s*\}\s*(?=\{)/g;
  while ((m = re.exec(text))) { const a = group(text, re.lastIndex), b = a && group(text, a.end); if (b) add(m[1], 1, a.body + " … " + b.body, "delimitador", "\\DeclarePairedDelimiter"); }
  re = /\\(?:g|e|x)?def\s*\\([a-zA-Z@]+)((?:#\d)*)\s*(?=\{)/g;
  while ((m = re.exec(text))) { const g = group(text, re.lastIndex); if (g) add(m[1], m[2].length / 2, g.body, "macro", "\\def"); }
  re = /\\newtheorem(\*?)\s*\{([^}]+)\}\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  while ((m = re.exec(text))) envs.push({name: m[2].trim(), detail: clean(m[3]) || "teorema", file});
  re = /\\(?:re)?newenvironment\s*\{([^}]+)\}/g;
  while ((m = re.exec(text))) envs.push({name: m[1].trim(), detail: "entorno propio", file});
  return {macros, envs};
}
const macroOption = mc => {
  const tpl = mc.name + "{${}}".repeat(Math.max(0, mc.n));
  const label = "\\" + mc.name, detail = (mc.n ? `${mc.n} arg. · ` : "") + (mc.body.length > 38 ? mc.body.slice(0, 37) + "…" : mc.body);
  return snippetCompletion("\\" + tpl, {label, detail, type: "variable", boost: 60, info: `${mc.how.startsWith("\\") ? mc.how : "\\newcommand"}{\\${mc.name}} → ${mc.body}\n(${mc.file})`});
};

export function latexComplete({files, fetchText, current, snippets = () => []}) {
  let cache = {bib: [], labels: [], macros: [], envs: []}, stamp = 0, loading = null, ready = false;
  async function refresh() {
    const list = files().filter(f => f.kind === "text" && /\.(bib|tex|sty|cls)$/i.test(f.path)), cur = current(), bib = [], labels = [], macros = [], envs = [];
    const texts = await Promise.all(list.map(async f => [f.path, f.path === cur.path ? cur.text : await fetchText(f.path)]));
    for (const [p, t] of texts) { if (typeof t !== "string") continue; if (/\.bib$/i.test(p)) bib.push(...parseBib(t, p)); else { labels.push(...parseLabels(t, p)); const r = parseMacros(t, p); macros.push(...r.macros); envs.push(...r.envs); } }
    cache = {bib, labels, macros, envs}; stamp = Date.now(); ready = true;
  }
  const data = async () => {
    if (!ready) { loading ??= refresh().finally(() => loading = null); await loading; }
    else if (Date.now() - stamp > 6000 && !loading) loading = refresh().catch(() => {}).finally(() => loading = null);
    return cache;
  };
  const liveHere = state => {                // lo que hay en este archivo ahora mismo, sin esperar al servidor
    const t = state.doc.toString(), p = current().path || "";
    return /\.bib$/i.test(p) ? {bib: parseBib(t, p), labels: []} : {bib: [], labels: parseLabels(t, p)};
  };
  const userDefs = async state => {          // macros y entornos del proyecto + los de este archivo ahora mismo
    const d = await data(), p = current().path || "", live = /\.bib$/i.test(p) ? {macros: [], envs: []} : parseMacros(state.doc.toString().slice(0, 400000), p);
    const mk = (a, b, k) => { const seen = new Set(b.map(x => x[k])); return [...b, ...a.filter(x => !seen.has(x[k]) && x.file !== p)]; };
    return {macros: mk(d.macros || [], live.macros, "name"), envs: mk(d.envs || [], live.envs, "name")};
  };
  const merge = (a, b, k) => { const seen = new Set(b.map(x => x[k])); return [...b, ...a.filter(x => !seen.has(x[k]))]; };
  const list = (from, options, extra) => ({from, options, validFor: /^[^{},\\]*$/, ...extra});

  async function source(ctx) {
    const {state, pos} = ctx, line = state.doc.lineAt(pos), before = line.text.slice(0, pos - line.from);
    // 1) Argumentos entre llaves
    const arg = /\\([a-zA-Z]+)\*?(?:\[[^\]]*\])*\{([^{}]*)$/.exec(before);
    if (arg) {
      const name = arg[1], typed = arg[2], base = pos - typed.length;
      const afterComma = typed.lastIndexOf(","), from = afterComma >= 0 ? base + afterComma + 1 + (/^\s*/.exec(typed.slice(afterComma + 1))[0].length) : base;
      if (name === "begin" || name === "end") {
        const open = openEnvs(state.doc.sliceString(0, line.from + before.lastIndexOf("\\" + name))), inner = open[open.length - 1];
        const ud = await userDefs(state), known = new Set(ENVS.map(([e]) => e));
        const opts = [...ud.envs.filter(e => !known.has(e.name)).map(e => [e.name, e.detail + " (tuyo)"]), ...ENVS].map(([e, d], i) => ({label: e, detail: d, type: "namespace", boost: name === "end" && e === inner ? 99 : (d.endsWith("(tuyo)") ? 50 : 0),
          apply: name === "begin" ? beginApply(e) : closeApply(e)}));
        if (name === "end" && inner && !ENVS.some(([e]) => e === inner)) opts.unshift({label: inner, detail: "abierto", type: "namespace", boost: 99, apply: closeApply(inner)});
        return list(base, opts);
      }
      if (/^(cite[a-zA-Z]*|nocite|parencite|textcite|autocite|footcite|citeauthor|citeyear)$/.test(name)) {
        const d = await data(), live = liveHere(state), all = merge(d.bib, live.bib, "key");
        return all.length ? list(from, all) : null;
      }
      if (/^(ref|eqref|autoref|cref|Cref|pageref|nameref|vref)$/.test(name)) {
        const d = await data(), live = liveHere(state), all = merge(d.labels, live.labels, "label");
        return all.length ? list(from, all) : null;
      }
      if (/^(input|include|subfile)$/.test(name))
        return list(base, files().filter(f => f.kind === "text" && /\.tex$/i.test(f.path)).map(f => ({label: name === "include" || name === "input" ? f.path.replace(/\.tex$/i, "") : f.path, detail: ".tex", type: "variable"})));
      if (name === "includegraphics")
        return list(base, files().filter(f => IMG.test(f.path)).map(f => ({label: f.path, detail: "imagen", type: "variable"})));
      if (name === "bibliography" || name === "addbibresource")
        return list(from, files().filter(f => /\.bib$/i.test(f.path)).map(f => ({label: name === "bibliography" ? f.path.replace(/\.bib$/i, "") : f.path, detail: ".bib", type: "variable"})));
      if (name === "usepackage" || name === "RequirePackage") return list(from, PKGS.map(p => ({label: p, type: "namespace"})));
      if (name === "documentclass") return list(base, CLASSES.map(p => ({label: p, type: "namespace"})));
      if (name === "bibliographystyle") return list(base, BSTYLES.map(p => ({label: p, type: "namespace"})));
      return null;                                            // otro argumento: sin sugerencias
    }
    // 2) Comandos: \algo
    const w = ctx.matchBefore(/\\[a-zA-Z]*(?:\{[a-zA-Z*]*)?/);
    const wc = ctx.matchBefore(/\\[a-zA-Z]*/);
    const mtch = w && /\\(begin|end)?\{[a-zA-Z*]*$/.test(w.text) ? w : wc;
    if (!mtch || (mtch.from === mtch.to && !ctx.explicit)) return null;
    const math = inMath(state.doc.sliceString(Math.max(0, mtch.from - 30000), mtch.from));
    const ud = await userDefs(state), mine = new Set(ud.macros.map(x => x.name));
    const opts = ALL.filter(({c}) => !mine.has(c[0])).map(({c, math: m}) => {
      const boost = m ? (math ? 40 : -40) : (math ? -20 : 0);
      return cmd(c[0], c[1], c[2], c[3], boost);
    });
    opts.push(...ud.macros.map(macroOption));
    for (const e of ud.envs) opts.push(cmd(`begin{${e.name}}`, `begin{${e.name}}\n\t${"${}"}\n\\end{${e.name}}`, e.detail + " (tuyo)", "namespace", 55));
    return {from: mtch.from, options: opts, validFor: /^\\[a-zA-Z]*(\{[a-zA-Z*]*)?$/};
  }

  // Snippets propios: escribe la abreviatura y pulsa Tab
  const expand = view => {
    if (completionStatus(view.state) === "active") return false;
    const sel = view.state.selection.main; if (!sel.empty) return false;
    const line = view.state.doc.lineAt(sel.head), m = /(^|[\s({$])([A-Za-z0-9_:\-]+)$/.exec(line.text.slice(0, sel.head - line.from));
    if (!m) return false;
    const sn = snippets().find(x => x.k === m[2]); if (!sn) return false;
    snippet(sn.t)(view, {label: sn.k}, sel.head - m[2].length, sel.head);
    return true;
  };
  return [
    EditorState.languageData.of(() => [{autocomplete: source}]),
    Prec.high(keymap.of([{key: "Tab", run: v => expand(v) || acceptCompletion(v)}])),
  ];
}
