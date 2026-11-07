// Respuestas del asistente: Markdown + fórmulas matemáticas (KaTeX), con el HTML saneado.
import {marked} from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";

const OPEN = "", CLOSE = "";           // marcadores que Markdown no toca
const slot = n => OPEN + n + CLOSE;

// Enlaces: siempre en pestaña nueva y sin dar acceso a esta página
DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});

function tex(src, display) {
  try { return katex.renderToString(src, {displayMode: display, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml"}); }
  catch { return `<code>${src.replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]))}</code>`; }
}

export function renderMd(text) {
  const keep = [];                                  // lo que se aparta antes de convertir: código y fórmulas
  const put = (html) => slot(keep.push(html) - 1);
  let s = String(text ?? "");
  // 1) Código (bloques y en línea): nunca se interpreta como fórmula
  s = s.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, m => put({raw: m}));
  s = s.replace(/`[^`\n]+`/g, m => put({raw: m}));
  // 2) Fórmulas: $$…$$, \[…\], \(…\) y $…$ (con la regla de pandoc para no confundir con precios: «$5 y $10»)
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => put({tex: m.trim(), display: true}));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => put({tex: m.trim(), display: true}));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => put({tex: m.trim(), display: false}));
  s = s.replace(/(?<![\\$\w])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![\d$])/g, (_, m) => put({tex: m, display: false}));
  // 3) Devolver el código tal cual para que Markdown lo formatee
  s = s.replace(new RegExp(OPEN + "(\\d+)" + CLOSE, "g"), (all, n) => keep[+n].raw ?? all);
  // 4) Markdown → HTML → saneado
  let html = DOMPurify.sanitize(marked.parse(s, {gfm: true, breaks: true, async: false}), {
    ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "input", "textarea", "iframe", "script", "img", "svg", "object", "embed"], FORBID_ATTR: ["style"]});
  // 5) Fórmulas ya renderizadas por KaTeX (HTML generado por la librería, no por el modelo)
  html = html.replace(new RegExp(OPEN + "(\\d+)" + CLOSE, "g"), (all, n) => keep[+n].tex != null ? tex(keep[+n].tex, keep[+n].display) : all);
  // 6) Botón para copiar en los bloques de código
  return html.replace(/<pre>/g, '<div class="cb"><button class="cp" data-copycode type="button">Copiar</button><pre>').replace(/<\/pre>/g, "</pre></div>");
}
