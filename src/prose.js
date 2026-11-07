// Extrae de un texto LaTeX las palabras que son prosa (lo que tiene sentido revisar):
// quita comentarios, comandos, fórmulas, entornos de código y argumentos que no son texto (rutas, claves, medidas…).

// Comandos cuyos argumentos no son prosa → cuántos grupos {…} se saltan (Infinity = todos los que sigan)
const SKIP = {
  usepackage: Infinity, RequirePackage: Infinity, documentclass: Infinity, LoadClass: Infinity, input: Infinity, include: Infinity, includeonly: Infinity,
  includegraphics: Infinity, includepdf: Infinity, bibliography: Infinity, bibliographystyle: Infinity, addbibresource: Infinity, graphicspath: Infinity,
  label: Infinity, ref: Infinity, eqref: Infinity, pageref: Infinity, autoref: Infinity, cref: Infinity, Cref: Infinity, vref: Infinity, nameref: Infinity, hyperref: 1,
  cite: Infinity, citep: Infinity, citet: Infinity, citealp: Infinity, citealt: Infinity, citeauthor: Infinity, citeyear: Infinity, parencite: Infinity, textcite: Infinity,
  autocite: Infinity, footcite: Infinity, nocite: Infinity, bibitem: Infinity,
  url: Infinity, path: Infinity, href: 1, newcommand: Infinity, renewcommand: Infinity, providecommand: Infinity, newenvironment: Infinity, renewenvironment: Infinity,
  DeclareMathOperator: Infinity, def: Infinity, let: Infinity, setlength: Infinity, addtolength: Infinity, setcounter: Infinity, addtocounter: Infinity,
  newcounter: Infinity, newtheorem: Infinity, pagestyle: Infinity, thispagestyle: Infinity, pagenumbering: Infinity, hypersetup: Infinity, geometry: Infinity,
  color: Infinity, textcolor: 1, colorbox: 1, definecolor: Infinity, colorlet: Infinity, usetikzlibrary: Infinity, usepgfplotslibrary: Infinity,
  begin: Infinity, end: Infinity, hspace: Infinity, vspace: Infinity, hskip: Infinity, vskip: Infinity, rule: Infinity, lstinputlisting: Infinity,
  index: Infinity, glossary: Infinity, newglossaryentry: Infinity, captionsetup: Infinity, titleformat: Infinity, titlespacing: Infinity, fontsize: Infinity,
  setmainfont: Infinity, setsansfont: Infinity, setmonofont: Infinity, selectlanguage: Infinity, foreignlanguage: 1, lstset: Infinity, tikzset: Infinity,
  pgfplotsset: Infinity, DeclareGraphicsExtensions: Infinity, newcolumntype: Infinity, multicolumn: 2, cline: Infinity, cellcolor: Infinity, columncolor: Infinity,
  rowcolor: Infinity, setstretch: Infinity, linespread: Infinity, bibliographystyle_: 0, siunitx: Infinity, SI: Infinity, num: Infinity, qty: Infinity, ang: Infinity,
  setlist: Infinity, newlist: Infinity, theoremstyle: Infinity, numberwithin: Infinity, counterwithin: Infinity, DeclareOption: Infinity, ProcessOptions: Infinity,
  graphicspath_: 0, subfile: Infinity, import: Infinity, externaldocument: Infinity, includesvg: Infinity, embedfile: Infinity, attachfile: Infinity,
};
// Después de \begin{entorno}{…} algunos entornos llevan un argumento obligatorio que no es texto
const BEGIN_ARG = new Set(["tabular", "tabularx", "tabular*", "array", "minipage", "multicols", "multicols*", "longtable", "tabu", "tblr", "subfigure", "wrapfigure", "wraptable", "adjustbox", "tcolorbox", "algorithmic_", "framed_", "lstlisting_"]);
// Entornos cuyo contenido no se revisa
const SKIP_ENV = new Set(["equation", "align", "alignat", "flalign", "gather", "multline", "eqnarray", "displaymath", "math", "split", "aligned", "gathered", "cases", "array", "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "Bmatrix", "smallmatrix",
  "verbatim", "Verbatim", "lstlisting", "minted", "comment", "filecontents", "tikzpicture", "tikzcd", "axis", "pgfpicture", "forest", "circuitikz", "thebibliography_", "BVerbatim", "alltt", "luacode", "pycode", "pythontexcode"].flatMap(n => [n, n + "*"]));
const ACCENT_SYM = "'\"^`~=.";
const ACCENT_LET = "cvuHkrbdt";
const SPECIAL_LET = new Set(["ss", "o", "O", "ae", "AE", "oe", "OE", "aa", "AA", "l", "L", "i", "j", "dh", "DH", "th", "TH", "ng", "NG"]);
const PH = "\u0001";   // marca «aquí hay un carácter acentuado con comandos»: la palabra no se revisa

const isLetter = c => c !== undefined && /[A-Za-z@]/.test(c);

function skipGroup(t, i) {                      // t[i] === "{": devuelve la posición tras el grupo equilibrado
  let d = 0;
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === "\\") { i++; continue; }
    if (c === "{") d++; else if (c === "}" && --d === 0) return i + 1;
  }
  return t.length;
}
function skipBracket(t, i) {                    // t[i] === "[": hasta el «]»
  for (i++; i < t.length; i++) { if (t[i] === "\\") { i++; continue; } if (t[i] === "]") return i + 1; if (t[i] === "\n" && t[i + 1] === "\n") return i; }
  return t.length;
}
function skipArgs(t, i, n, allowBracket = true) {
  while (n > 0 || n === Infinity) {
    let j = i; while (t[j] === " " || t[j] === "\t") j++;
    if (t[j] === "[" && allowBracket) { i = skipBracket(t, j); continue; }
    if (t[j] === "{") { i = skipGroup(t, j); n--; continue; }
    break;
  }
  return i;
}

/** Devuelve un texto de la misma longitud con solo la prosa (lo demás, en espacios). */
export function mask(text) {
  const t = String(text), n = t.length, out = new Array(n).fill(" ");
  let i = 0, end = n;
  const doc = t.indexOf("\\begin{document}");
  if (doc >= 0) i = doc + 16;                                      // el preámbulo no es prosa
  const ed = t.indexOf("\\end{document}", i); if (ed >= 0) end = ed;
  const ph = (a, b) => { for (let k = a; k < b; k++) out[k] = PH; };
  const keep = (a, b) => { for (let k = a; k < b; k++) out[k] = t[k]; };
  while (i < end) {
    const c = t[i];
    if (c === "%") { while (i < end && t[i] !== "\n") i++; continue; }
    if (c === "$") {                                                // fórmula $…$ o $$…$$
      const dbl = t[i + 1] === "$"; i += dbl ? 2 : 1;
      while (i < end) { if (t[i] === "\\") { i += 2; continue; } if (t[i] === "$") { i += dbl && t[i + 1] === "$" ? 2 : 1; break; } if (!dbl && t[i] === "\n" && t[i + 1] === "\n") break; i++; }
      continue;
    }
    if (c === "\\") {
      const d = t[i + 1];
      if (d === "(" || d === "[") { const close = d === "(" ? "\\)" : "\\]", k = t.indexOf(close, i + 2); i = k < 0 ? end : k + 2; continue; }
      if (d === "\\") { i += 2; if (t[i] === "*") i++; if (t[i] === "[") i = skipBracket(t, i); continue; }
      if (d !== undefined && ACCENT_SYM.includes(d)) {              // \'a  \'{a}  \"{\i}
        let j = i + 2; if (t[j] === "{") { j++; if (t[j] === "\\") j++; while (isLetter(t[j])) j++; if (t[j] === "}") j++; }
        else { if (t[j] === "\\") j++; if (isLetter(t[j])) j++; }
        ph(i, j); i = j; continue;
      }
      if (isLetter(d)) {
        let j = i + 1; while (isLetter(t[j])) j++;
        const name = t.slice(i + 1, j);
        if (name.length === 1 && ACCENT_LET.includes(name) && (t[j] === "{" || t[j] === " " && isLetter(t[j + 1]))) {   // \c{c}  \v{s}
          let k = j; while (t[k] === " ") k++; if (t[k] === "{") { k++; if (t[k] === "\\") k++; while (isLetter(t[k])) k++; if (t[k] === "}") k++; } else k++;
          ph(i, k); i = k; continue;
        }
        if (SPECIAL_LET.has(name)) { if (t[j] === "{" && t[j + 1] === "}") j += 2; ph(i, j); i = j; continue; }   // \ss  \o  \ae
        if (name === "verb" || name === "lstinline" || name === "mintinline") {
          if (t[j] === "*") j++;
          const del = t[j]; if (del && del !== "{" && del !== "[") { const k = t.indexOf(del, j + 1); i = k < 0 ? end : k + 1; continue; }
        }
        if (name === "begin") {
          let k = j; while (t[k] === " ") k++;
          if (t[k] === "{") {
            const e = t.indexOf("}", k), env = t.slice(k + 1, e);
            if (e > 0 && SKIP_ENV.has(env)) { const close = t.indexOf("\\end{" + env + "}", e); i = close < 0 ? end : close + 6 + env.length; continue; }
            i = e > 0 ? e + 1 : k + 1;
            while (t[i] === " ") i++;
            if (t[i] === "[") i = skipBracket(t, i);
            if (BEGIN_ARG.has(env)) i = skipArgs(t, i, 1, true);
            continue;
          }
        }
        if (name === "end") { i = skipArgs(t, j, 1, false); continue; }
        if (Object.prototype.hasOwnProperty.call(SKIP, name)) { if (t[j] === "*") j++; i = skipArgs(t, j, SKIP[name]); continue; }
        i = j; if (t[i] === "*") i++;
        continue;                                                   // otro comando: se omite el nombre y su contenido se revisa
      }
      i += 2; continue;                                             // \%  \&  \_  \,  …
    }
    if (c === "~" || c === "{" || c === "}" || c === "&" || c === "^" || c === "_" || c === "#") { i++; continue; }
    keep(i, i + 1); i++;
  }
  return out.join("");
}

const WORD = /[\p{L}\p{M}\p{N}\u0001_]+(?:['’][\p{L}\p{M}]+)*/gu;

/** Palabras revisables con su posición: [{from, to, word}] */
export function proseWords(text) {
  const t = String(text), m = mask(t), res = [];
  for (const x of m.matchAll(WORD)) {
    let w = x[0];
    if (w.length < 2 || /[\p{N}_\u0001]/u.test(w)) continue;        // números, claves, acentos hechos con comandos
    if (w === w.toUpperCase() && /\p{Lu}/u.test(w)) continue;      // siglas
    if (/\p{Ll}\p{Lu}/u.test(w)) continue;                          // LaTeX, iPhone…
    const a = x.index, b = a + w.length, before = t[a - 1], after = t[b], after2 = t[b + 1];
    if (before === "@" || before === "/" || before === "\\" || after === "/" || after === "@") continue;   // correos, rutas
    if (after === "." && /\p{L}/u.test(after2 || "") && !/\s/.test(after2)) continue;                      // dominio.com, archivo.tex
    if (before === "." && /\p{L}/u.test(t[a - 2] || "")) continue;
    if (/^(https?|www|ftp)$/i.test(w)) continue;
    res.push({from: a, to: b, word: w.replace(/’/g, "'")});
  }
  return res;
}
