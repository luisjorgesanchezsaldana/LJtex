// Lee el registro (.log) de LaTeX y extrae lo importante: errores (con archivo, línea, contexto y una pista
// en español) y avisos. El registro completo se conserva aparte, plegado.

const STOP = /Emergency stop|Fatal error occurred|^Type X to quit|^Enter file name|^No pages of output/;
const HEAD_FLE = /^(?:\.\/)?([^\s:][^:]*\.(?:tex|sty|cls|bib|def|cfg|ltx|bbl)):(\d+): (.*)$/;   // con -file-line-error
const HEAD_PLAIN = /^! (.*)$/;                                                                    // formato clásico

function hint(msg, ctx) {
  let m;
  if ((m = /File `([^']+?)\.(sty|cls)' not found/.exec(msg)))
    return {text: `Falta ${m[2] === "sty" ? "el paquete" : "la clase"} de LaTeX «${m[1]}» en tu instalación. Instálalo en la Terminal (te pedirá la contraseña de tu Mac):`, cmd: `sudo tlmgr install ${m[1]}`};
  if ((m = /File `([^']+)' not found/.exec(msg)))
    return {text: `No se encuentra el archivo «${m[1]}». Revisa que exista en el árbol de archivos y que la ruta y el nombre coincidan (también las mayúsculas).`};
  if (/Undefined control sequence/.test(msg))
    return {text: "Comando que LaTeX no conoce: puede ser una errata, o falta un \\usepackage que lo defina. El comando está justo antes del corte en la línea de abajo."};
  if (/Missing \$ inserted/.test(msg))
    return {text: "Hay símbolos de matemáticas (como ^, _ o \\alpha) fuera de una fórmula, o falta cerrar un $. Escríbelos entre $…$, o usa \\_ para un guion bajo literal."};
  if (/Environment (\S+) undefined/.test(msg))
    return {text: `El entorno «${/Environment (\S+) undefined/.exec(msg)[1]}» no existe: revisa cómo está escrito en \\begin{…} o carga el paquete que lo define.`};
  if (/\\begin\{[^}]*\} on input line \d+ ended by \\end/.test(msg) || /ended by \\end/.test(msg))
    return {text: "Un \\begin{…} no coincide con su \\end{…}: falta cerrar un entorno o sobra uno."};
  if (/Extra \}|Too many \}'s/.test(msg)) return {text: "Sobra una llave de cierre }. Revisa que cada { tenga su }."};
  if (/Missing \} inserted|Runaway argument|File ended while scanning|Paragraph ended before/.test(msg))
    return {text: "Falta cerrar una llave }. Busca un { sin su pareja cerca de esta línea (o en la anterior)."};
  if (/Misplaced alignment tab character &/.test(msg)) return {text: "Un & fuera de una tabla o de un entorno align. Si es texto normal, escribe \\&."};
  if (/Missing number, treated as zero|Illegal unit of measure/.test(msg)) return {text: "Falta un número o una unidad (por ejemplo 2cm o 0.5\\linewidth)."};
  if (/Option clash for package (\S+)/.test(msg)) return {text: "El paquete se cargó dos veces con opciones distintas. Deja un solo \\usepackage con todas las opciones."};
  if (/Unicode character|inputenc Error/.test(msg)) return {text: "Hay un carácter que LaTeX no puede escribir con esta configuración. Con pdflatex usa \\usepackage[utf8]{inputenc}, o cambia ese carácter por su comando."};
  if (/Citation .* undefined/.test(msg)) return {text: "La clave no está en tu .bib. Revisa cómo está escrita (el menú de sugerencias de \\cite{ lista las que existen) y vuelve a compilar."};
  if (/Reference .* undefined/.test(msg)) return {text: "La etiqueta no existe, o es la primera compilación tras añadirla: compila otra vez. Si sigue igual, revisa el \\label."};
  return null;
}

export function analyze(log) {
  const L = String(log || "").split(/\r?\n/);
  const errors = [], warnings = [], seen = new Set();
  let layout = 0, fatal = /Emergency stop|Fatal error occurred/.test(log || "");

  const context = from => {                       // las líneas «l.12 …» que acompañan a un error
    const out = [];
    for (let j = from + 1; j < Math.min(L.length, from + 14); j++) {
      if (HEAD_FLE.test(L[j]) && j > from + 1 && !/Emergency stop/.test(L[j])) break;
      const m = /^l\.(\d+) ?(.*)$/.exec(L[j]);
      if (m) { out.push(m[2] + " ⟸ aquí " + (L[j + 1] || "").trim().slice(0, 100)); return {line: +m[1], text: out.join(" ").trim().slice(0, 200)}; }
      if (/^<(recently read|to be read again|argument|inserted text|template)>/.test(L[j])) out.push(L[j].replace(/^<[^>]*>\s*/, "").trim());
    }
    return {line: null, text: out.join(" ").trim().slice(0, 200)};
  };
  const add = (msg, file, line, ctx) => {
    msg = msg.replace(/\s+/g, " ").trim();
    if (!msg || STOP.test(msg)) return;
    const key = `${msg}|${file}|${line}`; if (seen.has(key)) return; seen.add(key);
    errors.push({msg, file: file || null, line: line ?? null, context: ctx || "", hint: hint(msg, ctx), find: (/File `([^']+?)\.(?:sty|cls)' not found/.exec(msg) || [])[1] || null});
  };

  for (let i = 0; i < L.length; i++) {
    const s = L[i]; let m;
    if ((m = HEAD_FLE.exec(s))) { const c = context(i); add(m[3], m[1], +m[2], c.text); continue; }
    if ((m = HEAD_PLAIN.exec(s))) { const c = context(i); add(m[1], null, c.line, c.text); continue; }
    if ((m = /^(LaTeX|Package [\w-]+|Class [\w-]+)( Warning|Warning): (.*)$/.exec(s))) {
      let msg = m[3], j = i + 1;
      while (j < L.length && /^(\(\S+\)|\s{2,})\s*\S/.test(L[j]) && j < i + 6) msg += " " + L[j++].replace(/^\(\S+\)\s*/, "").trim();
      const ln = /on input line (\d+)/.exec(msg), w = {msg: msg.replace(/\s+/g, " ").replace(/ on input line \d+\.?/, "").trim(), line: ln ? +ln[1] : null, src: m[1]};
      if (!/Rerun to get|There were undefined|Label\(s\) may have changed/.test(w.msg) && !seen.has("w" + w.msg)) { seen.add("w" + w.msg); w.hint = hint(w.msg); warnings.push(w); }
      continue;
    }
    if (/^(Over|Under)full \\[hv]box/.test(s)) layout++;
  }
  if (!errors.length && fatal) errors.push({msg: "La compilación se detuvo antes de terminar.", file: null, line: null, context: "", hint: {text: "Mira el registro completo, más abajo, para ver dónde se detuvo."}});
  return {errors, warnings, layout, fatal};
}
