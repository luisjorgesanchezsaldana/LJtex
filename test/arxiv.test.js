// Pruebas de la preparación para arXiv: quitar comentarios sin romper el documento y juntar \input.
import {test} from "node:test";
import assert from "node:assert/strict";
import {stripComments, flatten} from "../arxiv.js";

const L = (...xs) => xs.join("\n");

test("borra líneas que son solo comentario", () => {
  assert.equal(stripComments(L("a", "% nota privada", "  % otra", "b")), L("a", "b"));
});

test("deja el % final para no meter espacios", () => {
  assert.equal(stripComments("\\newcommand{\\R}{\\mathbb{R}}% reales"), "\\newcommand{\\R}{\\mathbb{R}}%");
  assert.equal(stripComments("texto% pegado"), "texto%");
});

test("respeta \\% escapado y \\\\% (salto de línea seguido de comentario)", () => {
  assert.equal(stripComments("El 50\\% de los casos"), "El 50\\% de los casos");
  assert.equal(stripComments("50\\% y luego % comentario"), "50\\% y luego %");
  assert.equal(stripComments("fila \\\\% comentario"), "fila \\\\%");
});

test("no toca verbatim ni lstlisting", () => {
  const v = L("\\begin{verbatim}", "  x = 5 % no es comentario", "\\end{verbatim}");
  assert.equal(stripComments(v), v);
  const l = L("\\begin{lstlisting}", "% tampoco", "\\end{lstlisting}");
  assert.equal(stripComments(l), l);
});

test("no toca líneas con \\url o \\href (pueden llevar %)", () => {
  const u = "\\url{https://ejemplo.org/a%20b}";
  assert.equal(stripComments(u), u);
});

test("quita el entorno comment completo", () => {
  assert.equal(stripComments(L("antes", "\\begin{comment}", "borrador viejo", "\\end{comment}", "después")), L("antes", "después"));
});

test("conserva párrafos pero no deja huecos enormes", () => {
  assert.equal(stripComments(L("p1", "", "% a", "% b", "", "p2")), L("p1", "", "p2"));
});

test("un documento real conserva todo lo que no es comentario", () => {
  const doc = L(
    "\\documentclass{amsart}",
    "% \\usepackage{todonotes}",
    "\\usepackage{amsmath}% matemáticas",
    "\\begin{document}",
    "Sea $G$ un grupo finito. % TODO: generalizar",
    "\\begin{theorem}\\label{thm:main}",
    "El 100\\% de las acciones son conjugadas.",
    "\\end{theorem}",
    "\\end{document}");
  assert.equal(stripComments(doc), L(
    "\\documentclass{amsart}",
    "\\usepackage{amsmath}%",
    "\\begin{document}",
    "Sea $G$ un grupo finito. %",
    "\\begin{theorem}\\label{thm:main}",
    "El 100\\% de las acciones son conjugadas.",
    "\\end{theorem}",
    "\\end{document}"));
});

test("flatten: junta \\input e \\include recursivamente", () => {
  const files = new Map([
    ["main.tex", L("\\begin{document}", "\\input{caps/intro}", "\\include{caps/dos}", "\\end{document}")],
    ["caps/intro.tex", L("Intro", "\\input{caps/detalle.tex}")],
    ["caps/detalle.tex", "Detalle"],
    ["caps/dos.tex", "Capítulo dos"],
  ]);
  assert.equal(flatten("main.tex", files), L("\\begin{document}", "Intro", "Detalle", "", "\\clearpage", "Capítulo dos", "\\clearpage", "\\end{document}"));
});

test("flatten: deja intactos los \\input comentados o que no son del proyecto", () => {
  const files = new Map([["main.tex", L("% \\input{viejo}", "\\input{tikzlibrary}")]]);
  assert.equal(flatten("main.tex", files), L("% \\input{viejo}", "\\input{tikzlibrary}"));
});

test("flatten: no se cuelga con \\input circulares", () => {
  const files = new Map([["a.tex", "A \\input{b}"], ["b.tex", "B \\input{a}"]]);
  assert.ok(flatten("a.tex", files).startsWith("A B"));
});
