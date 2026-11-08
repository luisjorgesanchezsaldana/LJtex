// Control de cambios con las marcas del paquete «changes» de LaTeX, escritas en el propio texto
// (así viajan por GitHub y cualquier coautor las ve, use o no LJtex):
//   \added[id=ana]{texto nuevo}   \deleted[id=ana]{texto quitado}   \replaced[id=ana]{nuevo}{viejo}
// Este archivo no depende del editor: lo usan el editor (al escribir) y el servidor (resumen del proyecto).

const CMD = /\\(added|deleted|replaced)(?![A-Za-z@])/g;

// Posición de la llave que cierra la que abre en «open» (respeta \{ y \}); -1 si no cierra
function closeBrace(t, open) {
  let d = 0;
  for (let i = open; i < t.length; i++) {
    const c = t[i];
    if (c === "\\") { i++; continue; }
    if (c === "{") d++;
    else if (c === "}" && --d === 0) return i;
  }
  return -1;
}
// ¿Está «pos» después de un % no escapado en su línea? (es decir, dentro de un comentario)
function inComment(t, pos) {
  let i = t.lastIndexOf("\n", pos - 1) + 1;
  for (; i < pos; i++) { if (t[i] === "\\") { i++; continue; } if (t[i] === "%") return true; }
  return false;
}
const skipWs = (t, i) => { while (i < t.length && (t[i] === " " || t[i] === "\t")) i++; return i; };

// Lista de cambios del texto, en orden. Cada uno: {type, id, comment, from, to, body:[a,b] | nw:[a,b], old:[a,b], marks:[[a,b]…]}
// (las posiciones de body/nw/old son las del contenido, sin las llaves)
export function parseChanges(t) {
  t = String(t); const out = [];
  CMD.lastIndex = 0; let m;
  while ((m = CMD.exec(t))) {
    const from = m.index;
    if (from > 0 && t[from - 1] === "\\" ) continue;
    if (inComment(t, from)) continue;
    let i = skipWs(t, from + m[0].length), opt = "";
    if (t[i] === "[") {
      let d = 0, j = i;
      for (; j < t.length; j++) { if (t[j] === "{") d++; else if (t[j] === "}") d--; else if (t[j] === "]" && d === 0) break; }
      if (j >= t.length) continue;
      opt = t.slice(i + 1, j); i = skipWs(t, j + 1);
    }
    if (t[i] !== "{") continue;
    const c1 = closeBrace(t, i); if (c1 < 0) continue;
    const id = (/(?:^|,)\s*id\s*=\s*([^,\]]+)/.exec(opt)?.[1] || "").trim().replace(/^\{|\}$/g, "");
    const comment = (/(?:^|,)\s*comment\s*=\s*(\{[^}]*\}|[^,]+)/.exec(opt)?.[1] || "").trim().replace(/^\{|\}$/g, "");
    const c = {type: m[1], id, comment, from};
    if (m[1] === "replaced") {
      const k = skipWs(t, c1 + 1);
      if (t[k] !== "{") continue;
      const c2 = closeBrace(t, k); if (c2 < 0) continue;
      Object.assign(c, {nw: [i + 1, c1], old: [k + 1, c2], to: c2 + 1, marks: [[from, i + 1], [c1, k + 1], [c2, c2 + 1]]});
    } else Object.assign(c, {body: [i + 1, c1], to: c1 + 1, marks: [[from, i + 1], [c1, c1 + 1]]});
    out.push(c);
    CMD.lastIndex = c.to;   // los cambios no se anidan: se sigue después del que se cerró
  }
  return out;
}

const slice = (t, r) => t.slice(r[0], r[1]);
// Lo que queda en el texto al aceptar o rechazar un cambio: {from, to, insert}
export function decide(t, c, accept) {
  const ins = c.type === "added" ? (accept ? slice(t, c.body) : "")
    : c.type === "deleted" ? (accept ? "" : slice(t, c.body))
    : accept ? slice(t, c.nw) : slice(t, c.old);
  return {from: c.from, to: c.to, insert: ins};
}
// Aplicar la decisión a muchos cambios a la vez (de atrás hacia adelante, para no mover posiciones)
export function decideAll(t, list, accept) {
  t = String(t);
  for (const c of [...list].sort((a, b) => b.from - a.from)) { const d = decide(t, c, accept); t = t.slice(0, d.from) + d.insert + t.slice(d.to); }
  return t;
}

// Autores definidos en el preámbulo: \definechangesauthor[name={Ana}, color=red]{ana}
export function changeAuthors(t) {
  const m = new Map();
  for (const x of String(t).matchAll(/\\definechangesauthor\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g)) {
    const name = (/name\s*=\s*\{([^}]*)\}/.exec(x[1] || "")?.[1] || /name\s*=\s*([^,]+)/.exec(x[1] || "")?.[1] || "").trim();
    const color = (/color\s*=\s*([A-Za-z]+)/.exec(x[1] || "")?.[1] || "").trim();
    m.set(x[2].trim(), {name: name || x[2].trim(), color});
  }
  return m;
}

// Identificador de autor para LaTeX a partir de un nombre («Luis Jorge» → «luisjorge»)
export const authorId = name => (String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 16)) || "autor";
// Colores que entiende xcolor sin paquetes extra, en el orden en que se asignan
export const COLORS = ["blue", "red", "teal", "violet", "orange", "olive", "magenta", "brown"];

// Bloque del preámbulo. Si «changes» no está instalado, el documento compila igual mostrando solo el resultado.
export const BLOCK_START = "% ---- LJtex: control de cambios (no borres este bloque mientras haya cambios pendientes) ----";
export const BLOCK_END = "% ---- fin del control de cambios ----";
export function preambleBlock(authors, showMarks = true) {
  return [BLOCK_START,
    "\\makeatletter\\def\\ljtex@chg{1}%",
    "\\@for\\ljtex@p:=changes,ulem,xcolor,xstring,xkeyval,etoolbox,truncate\\do{\\IfFileExists{\\ljtex@p.sty}{}{\\def\\ljtex@chg{0}}}%",
    `\\ifnum\\ljtex@chg=1 \\usepackage[${showMarks ? "markup=default,authormarkup=none" : "final"}]{changes}`,
    "\\else % sin el paquete changes (o sus dependencias) el PDF muestra el texto como quedaría al aceptar todo",
    "  \\providecommand{\\definechangesauthor}[2][]{}\\providecommand{\\added}[2][]{#2}",
    "  \\providecommand{\\deleted}[2][]{}\\providecommand{\\replaced}[3][]{#2}",
    "  \\typeout{LJtex: falta el paquete changes o alguna dependencia; el PDF no muestra las marcas de cambios.}",
    "\\fi\\makeatother",
    ...authors.map(a => `\\definechangesauthor[name={${a.name.replace(/[{}\\%#]/g, "")}}, color=${a.color}]{${a.id}}`),
    BLOCK_END].join("\n");
}
// Asegura que el preámbulo tenga el bloque y al autor. Devuelve el texto nuevo (o el mismo si no hacía falta).
export function ensurePreamble(t, me, showMarks) {
  t = String(t);
  const authors = changeAuthors(t);
  const s = t.indexOf(BLOCK_START), e = t.indexOf(BLOCK_END);
  const list = [...authors].map(([id, a]) => ({id, name: a.name, color: a.color || COLORS[0]}));
  if (me && !authors.has(me.id)) list.push({id: me.id, name: me.name, color: COLORS.find(c => !list.some(a => a.color === c)) || COLORS[list.length % COLORS.length]});
  const show = showMarks ?? (s >= 0 ? !/\[final\]\{changes\}/.test(t.slice(s, e)) : true);
  const block = preambleBlock(list, show);
  if (s >= 0 && e > s) return t.slice(0, s) + block + t.slice(e + BLOCK_END.length);
  const b = t.search(/^[^%\n]*\\begin\{document\}/m);
  if (b < 0) return t;   // no es el archivo principal
  return t.slice(0, b) + block + "\n" + t.slice(b);
}

// ---------- Escribir en modo «sugerir cambios» ----------
// Recibe el texto antes del cambio, el cambio del usuario {from, to, ins, cursor (posición del cursor dentro de ins)}
// y «active», la zona [a, b] que estás agregando ahora (la recuerda el editor: mientras escribes un comando como \cite,
// el texto pasa un instante por «\added{…\}», donde la llave queda escapada y la marca no se puede leer).
// Devuelve qué hacer: null (dejarlo pasar), {pass, region}, {block: mensaje}, {move: pos} o {from, to, insert, cursor, region}.
const balanced = s => { let d = 0; for (let i = 0; i < s.length; i++) { if (s[i] === "\\") { i++; continue; } if (s[i] === "{") d++; else if (s[i] === "}" && --d < 0) return false; } return d === 0; };
const hasPct = s => { for (let i = 0; i < s.length; i++) { if (s[i] === "\\") { i++; continue; } if (s[i] === "%") return true; } return false; };
const blankLine = s => /\n[ \t]*\n/.test(s);
// ¿Cae «pos» en medio de un comando (\cite → \ci|te, o justo después de la diagonal)? Ahí no se puede poner una marca.
function splitsCommand(t, pos) {
  if (pos <= 0 || pos >= t.length + 1) return false;
  let i = pos - 1; while (i >= 0 && /[A-Za-z@]/.test(t[i])) i--;
  if (i < 0 || t[i] !== "\\") return false;
  let k = i - 1, bs = 1; while (k >= 0 && t[k] === "\\") { bs++; k--; }
  if (bs % 2 === 0) return false;                       // «\\» es un salto de línea, no un comando
  if (i === pos - 1) return true;                       // justo después de la diagonal
  return /[A-Za-z@]/.test(t[pos] || "");               // en medio de las letras del comando
}
const CLOSE = new Set(["}", ")", "]"]);
const BRACEMSG = "Para quitar llaves dentro de un cambio sugerido, selecciona el par completo { … }.";
const CMDMSG = "Para sugerir un cambio en un comando de LaTeX, selecciona el comando completo (por ejemplo, todo «\\cite{…}»).";

export function suggest(t, {from, to, ins, cursor = ins.length, kind = "input"}, me, active = null) {
  t = String(t);
  if (from < 0 || to > t.length || from > to) return null;
  if (ins && t.slice(from, to) === ins) return {move: from + cursor};   // reemplazar por lo mismo (p. ej. el editor «salta» una llave que cerró): solo mueve el cursor
  if (active && active[0] <= from && to <= active[1]) {
    // Enter al final de lo que estás agregando: se sale de la marca (una marca no puede contener una línea en blanco)
    if (!to || from === to) if (from === active[1] && t[from] === "}" && /^\s+$/.test(ins) && ins.includes("\n")) return {from: from + 1, to: from + 1, insert: ins, cursor: from + 1 + cursor, region: null};
    if (ins && hasPct(ins) && !(ins === "%" && t[from - 1] === "\\")) return {block: "Los comentarios con % no se pueden sugerir. Desactiva «Sugerir cambios» para escribirlos."};
    if (to > from && !balanced(t.slice(from, to)) && balanced(t.slice(active[0], active[1]))) return {block: BRACEMSG};
    if (from === to && CLOSE.has(ins) && t[from] === ins && from < active[1]) return {move: from + 1};   // la llave ya estaba cerrada: se salta, como en modo normal
    return {pass: true, region: [active[0], active[1] - (to - from) + ins.length]};
  }
  const list = parseChanges(t), del = t.slice(from, to);
  const own = list.find(c => c.id === me && ((c.type === "added" && c.body[0] <= from && to <= c.body[1]) || (c.type === "replaced" && c.nw[0] <= from && to <= c.nw[1])));
  const ownEnd = c => c.type === "added" ? c.body[1] : c.nw[1];
  const A = `\\added[id=${me}]{`, D = `\\deleted[id=${me}]{`, R = `\\replaced[id=${me}]{`;

  // Solo saltos de línea o espacios: es acomodo del texto, no se marca (y si estás al final de tu agregado, sale de él)
  if (!del && /^\s+$/.test(ins) && ins.includes("\n")) {
    if (own && from === ownEnd(own)) return {from: own.to, to: own.to, insert: ins, cursor: own.to + cursor, region: null};
    if (!own) { const inside = list.find(c => c.from < from && from < c.to); if (!inside) return null; }
    else return null;
  }
  // Dentro de lo que tú mismo estás agregando: se escribe y se borra normal
  if (own) {
    if (ins && hasPct(ins) && !(ins === "%" && t[from - 1] === "\\")) return {block: "Los comentarios con % no se pueden sugerir. Desactiva «Sugerir cambios» para escribirlos."};
    const b = own.type === "added" ? own.body : own.nw;
    if (to > from && !balanced(del)) return {block: BRACEMSG};
    if (from === to && CLOSE.has(ins) && t[from] === ins && from < ownEnd(own)) return {move: from + 1};
    return {pass: true, region: [b[0], b[1] - (to - from) + ins.length]};
  }
  const hit = list.filter(c => from === to ? c.from < from && from < c.to : c.from < to && c.to > from);

  // Escribir texto nuevo
  if (!del) {
    if (hit.length) return {block: hit[0].id && hit[0].id !== me ? "Ese texto es un cambio pendiente de otra persona: acéptalo o recházalo antes de modificarlo." : "Estás dentro de una marca de cambio: acepta o rechaza ese cambio antes de modificarlo."};
    if (hasPct(ins)) return {block: "Los comentarios con % no se pueden sugerir. Desactiva «Sugerir cambios» para escribirlos."};
    if (splitsCommand(t, from)) return {block: CMDMSG};
    // justo después de un agregado tuyo: se continúa dentro de él
    const prev = list.find(c => c.to === from && c.id === me && (c.type === "added" || c.type === "replaced"));
    if (prev) { const at = ownEnd(prev), b0 = prev.type === "added" ? prev.body[0] : prev.nw[0]; return {from: at, to: at, insert: ins, cursor: at + cursor, region: [b0, at + ins.length]}; }
    return {from, to, insert: A + ins + "}", cursor: from + A.length + cursor, region: [from + A.length, from + A.length + ins.length]};
  }

  // Borrar o reemplazar: hay que poder envolver el texto quitado en una marca
  if (hit.length) {
    if (!ins && del.length === 1) {                       // una tecla de borrar sobre una marca: se salta la marca
      const c = hit[0];
      return {move: kind === "forward" ? c.to : c.from};
    }
    return {block: "La selección toca un cambio pendiente: acéptalo o recházalo antes, o selecciona solo texto sin marcas."};
  }
  if (splitsCommand(t, from) || splitsCommand(t, to) || /(^|[^\\])(\\\\)*\\$/.test(del)) return {block: CMDMSG};
  if (!balanced(del)) return {block: "Para sugerir que se quite, selecciona un fragmento con sus llaves { } completas."};
  if (hasPct(del)) return {block: "El fragmento incluye un comentario (%); quita el comentario aparte con «Sugerir cambios» desactivado."};
  if (blankLine(del)) return {block: "Para sugerir quitar varios párrafos, hazlo párrafo por párrafo (una marca no puede cruzar una línea en blanco)."};

  if (ins) {
    if (hasPct(ins)) return {block: "Los comentarios con % no se pueden sugerir. Desactiva «Sugerir cambios» para escribirlos."};
    return {from, to, insert: R + ins + "}{" + del + "}", cursor: from + R.length + cursor, region: [from + R.length, from + R.length + ins.length]};
  }
  // Borrar: se junta con un borrado tuyo que esté pegado, para no llenar el texto de marcas
  if (kind !== "forward") {
    const next = list.find(c => c.type === "deleted" && c.id === me && c.from === to);
    if (next) return {from, to: next.to, insert: D + del + slice(t, next.body) + "}", cursor: from};
    return {from, to, insert: D + del + "}", cursor: from};
  }
  const prev = list.find(c => c.type === "deleted" && c.id === me && c.to === from);
  if (prev) { const ins2 = D + slice(t, prev.body) + del + "}"; return {from: prev.from, to, insert: ins2, cursor: prev.from + ins2.length}; }
  return {from, to, insert: D + del + "}", cursor: from + D.length + del.length + 1};
}
