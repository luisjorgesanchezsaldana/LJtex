// Control de cambios: escribir en modo «sugerir», aceptar y rechazar, y el bloque del preámbulo.
import {test} from "node:test";
import assert from "node:assert/strict";
import {parseChanges, decide, decideAll, suggest, ensurePreamble, changeAuthors, authorId, BLOCK_START} from "../src/changes-core.js";

// Simula el editor: aplica lo que devuelve suggest() tecla por tecla, recordando la zona activa como lo hace LJtex
function editor(text, cur, me = "lj") {
  const s = {t: text, cur, region: null, blocked: []};
  const map = (p, from, to, len) => p <= from ? p : p >= to ? p - (to - from) + len : from + len;
  const apply = (from, to, ins, cursor, kind) => {
    const r = suggest(s.t, {from, to, ins, cursor, kind}, me, s.region);
    if (r?.block) { s.blocked.push(r.block); return; }
    if (r?.move != null) { s.cur = r.move; return; }
    if (!r || r.pass) {
      s.t = s.t.slice(0, from) + ins + s.t.slice(to); s.cur = from + cursor;
      s.region = r?.pass ? r.region : s.region && [map(s.region[0], from, to, ins.length), map(s.region[1], from, to, ins.length)];
      return;
    }
    s.t = s.t.slice(0, r.from) + r.insert + s.t.slice(r.to); s.cur = r.cursor;
    s.region = r.region === undefined ? null : r.region;
  };
  return Object.assign(s, {
    type(str) { for (const ch of str) apply(s.cur, s.cur, ch, 1, "input"); return s; },
    back(n = 1) { for (let i = 0; i < n; i++) if (s.cur > 0) apply(s.cur - 1, s.cur, "", 0, "backward"); return s; },   // al inicio, el editor no hace nada
    del(n = 1) { for (let i = 0; i < n; i++) if (s.cur < s.t.length) apply(s.cur, s.cur + 1, "", 0, "forward"); return s; },
    move(p) { s.cur = p; s.region = null; return s; },
    replace(a, b, ins) { s.region = null; apply(a, b, ins, ins.length, "input"); return s; },
  });
}

test("escribir texto nuevo: resultado exacto y cursor dentro de la marca", () => {
  const e = editor("Sea G un grupo.", 5).type(" finito");
  assert.equal(e.t, "Sea G\\added[id=lj]{ finito} un grupo.");
  assert.equal(e.t.slice(e.cur, e.cur + 1), "}");
});

test("escribir un comando con \\ y llaves queda dentro de una sola marca", () => {
  const e = editor("Ver .", 4).type("\\cite{Hatcher}");
  assert.equal(e.t, "Ver \\added[id=lj]{\\cite{Hatcher}}.");
  assert.equal(parseChanges(e.t).length, 1);
});

test("con autocierre de llaves (el editor inserta «{}»), teclear «}» salta la llave y lo que sigue queda fuera", () => {
  const e = editor("Ver .", 4).type("\\emph");
  // el editor, al teclear «{», inserta «{}» con el cursor en medio
  const r0 = e.region; e.t = e.t.slice(0, e.cur) + "{}" + e.t.slice(e.cur); e.cur += 1; e.region = [r0[0], r0[1] + 2];
  e.type("x}").type(" y");
  assert.equal(e.t, "Ver \\added[id=lj]{\\emph{x} y}.");
});

test("reemplazar un carácter por el mismo (así salta el editor una llave) solo mueve el cursor", () => {
  const t = "Ver \\added[id=lj]{\\emph{x}}.";
  const i = t.indexOf("}}");
  assert.deepEqual(suggest(t, {from: i, to: i + 1, ins: "}", cursor: 1}, "lj"), {move: i + 1});
});

test("escribir \\% dentro de lo agregado está permitido; un % suelto no", () => {
  const e = editor("El  de los casos", 3).type("50\\%");
  assert.equal(e.t, "El \\added[id=lj]{50\\%} de los casos");
  const f = editor("Hola", 4).type(" % nota");
  assert.ok(f.blocked.length > 0);
});

test("borrar con la tecla de borrar marca el texto como quitado y se junta en una sola marca", () => {
  const e = editor("un grupo muy finito", 12).back(4);
  assert.equal(e.t, "un grupo\\deleted[id=lj]{ muy} finito");
  assert.equal(parseChanges(e.t).length, 1);
  assert.equal(e.cur, 8);
});

test("seguir borrando hacia atrás salta la marca y la amplía", () => {
  const e = editor("ab cd", 5).back(2);          // quita «cd»
  assert.equal(e.t, "ab \\deleted[id=lj]{cd}");
  e.back(1);                                      // borra el espacio: se junta
  assert.equal(e.t, "ab\\deleted[id=lj]{ cd}");
});

test("borrar hacia adelante también se junta", () => {
  const e = editor("hola mundo cruel", 5).del(6);
  assert.equal(e.t, "hola \\deleted[id=lj]{mundo }cruel");
  assert.equal(parseChanges(e.t).length, 1);
});

test("escribir sobre una selección la marca como reemplazo", () => {
  const e = editor("un grupo viejo", 0).replace(9, 14, "n").type("uevo");
  assert.equal(e.t, "un grupo \\replaced[id=lj]{nuevo}{viejo}");
});

test("borrar dentro de lo que yo mismo agregué lo quita de verdad", () => {
  const e = editor("Hola.", 4).type(" mundoo").back(1);
  assert.equal(e.t, "Hola\\added[id=lj]{ mundo}.");
  e.back(6);
  assert.equal(e.t, "Hola\\added[id=lj]{}.");
});

test("no se puede escribir dentro del cambio de otra persona", () => {
  const e = editor("Sea \\added[id=ana]{un grupo} finito", 22).type("x");
  assert.equal(e.t, "Sea \\added[id=ana]{un grupo} finito");
  assert.equal(e.blocked.length, 1);
});

test("Enter al final de lo agregado sale de la marca (no mete párrafos dentro)", () => {
  const e = editor("Fin", 3).type(" del capítulo").type("\n\n").type("Nuevo");
  assert.equal(e.t, "Fin\\added[id=lj]{ del capítulo}\n\n\\added[id=lj]{Nuevo}");
});

test("no se sugiere quitar un fragmento con llaves incompletas ni varios párrafos", () => {
  const t = "\\textbf{hola} mundo\n\notro";
  assert.ok(suggest(t, {from: 0, to: 10, ins: "", kind: "backward"}, "lj").block);
  assert.ok(suggest(t, {from: 14, to: 25, ins: "", kind: "backward"}, "lj").block);
  assert.equal(suggest(t, {from: 0, to: 13, ins: "", kind: "backward"}, "lj").insert, "\\deleted[id=lj]{\\textbf{hola}}");
});

test("leer cambios: tipos, autores y comentarios; ignora los comentados", () => {
  const t = "a \\added[id=ana]{x} b \\deleted[id=lj,comment={ojo}]{y} c \\replaced[id=ana]{n}{v} % \\added[id=z]{no}";
  const cs = parseChanges(t);
  assert.deepEqual(cs.map(c => [c.type, c.id]), [["added", "ana"], ["deleted", "lj"], ["replaced", "ana"]]);
  assert.equal(cs[1].comment, "ojo");
});

test("aceptar y rechazar cada tipo de cambio", () => {
  const t = "a \\added[id=ana]{x} b \\deleted[id=lj]{y} c \\replaced[id=ana]{n}{v}";
  const [ad, de, re] = parseChanges(t);
  const ap = (c, ok) => { const d = decide(t, c, ok); return t.slice(0, d.from) + d.insert + t.slice(d.to); };
  assert.equal(ap(ad, true), "a x b \\deleted[id=lj]{y} c \\replaced[id=ana]{n}{v}");
  assert.equal(ap(ad, false), "a  b \\deleted[id=lj]{y} c \\replaced[id=ana]{n}{v}");
  assert.equal(ap(de, true), "a \\added[id=ana]{x} b  c \\replaced[id=ana]{n}{v}");
  assert.equal(ap(de, false), "a \\added[id=ana]{x} b y c \\replaced[id=ana]{n}{v}");
  assert.equal(ap(re, true), "a \\added[id=ana]{x} b \\deleted[id=lj]{y} c n");
  assert.equal(ap(re, false), "a \\added[id=ana]{x} b \\deleted[id=lj]{y} c v");
  assert.equal(decideAll(t, parseChanges(t), true), "a x b  c n");
  assert.equal(decideAll(t, parseChanges(t), false), "a  b y c v");
  assert.equal(decideAll(t, parseChanges(t).filter(c => c.id === "ana"), true), "a x b \\deleted[id=lj]{y} c n");
});

test("el bloque del preámbulo se agrega una vez, con un color por autor", () => {
  const doc = "\\documentclass{amsart}\n\\usepackage{amsmath}\n\\begin{document}\nHola\n\\end{document}\n";
  const a = ensurePreamble(doc, {id: "luisjorge", name: "Luis Jorge"});
  assert.ok(a.indexOf(BLOCK_START) < a.indexOf("\\begin{document}"));
  assert.equal(ensurePreamble(a, {id: "luisjorge", name: "Luis Jorge"}), a);
  const b = ensurePreamble(a, {id: "ana", name: "Ana"});
  const au = changeAuthors(b);
  assert.deepEqual([...au.keys()], ["luisjorge", "ana"]);
  assert.notEqual(au.get("luisjorge").color, au.get("ana").color);
  assert.equal(b.split(BLOCK_START).length, 2);
  assert.equal(ensurePreamble("\\section{Cap}\nsin preámbulo", {id: "x", name: "X"}), "\\section{Cap}\nsin preámbulo");
});

test("authorId produce identificadores válidos para LaTeX", () => {
  assert.equal(authorId("Luis Jorge Sánchez"), "luisjorgesanchez");
  assert.equal(authorId("María José"), "mariajose");
  assert.equal(authorId(""), "autor");
});

test("al azar: 1500 sesiones de edición en modo sugerencia; rechazar todo devuelve el original y aceptar todo da texto limpio", () => {
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const words = ["grupo", "toro", "acción", "finito", "sea", "el", "de", "un", "$G$", "\\cite{H}", "\\emph{libre}"];
  for (let n = 0; n < 1500; n++) {
    const orig = Array.from({length: 6 + rnd(10)}, () => words[rnd(words.length)]).join(" ") + ". Fin \\added[id=ana]{de otra} aquí.";
    const e = editor(orig, rnd(orig.length + 1));
    for (let k = 0; k < 8; k++) {
      const op = rnd(5);
      if (op === 0) e.move(rnd(e.t.length + 1));
      else if (op === 1) e.type(" " + words[rnd(words.length)]);
      else if (op === 2) e.back(1 + rnd(4));
      else if (op === 3) e.del(1 + rnd(4));
      else { const a = rnd(e.t.length), b = Math.min(e.t.length, a + 1 + rnd(8)); e.replace(a, b, words[rnd(words.length)]); }
      if (e.cur < 0 || e.cur > e.t.length) e.cur = Math.max(0, Math.min(e.t.length, e.cur));
    }
    const mine = parseChanges(e.t).filter(c => c.id === "lj");
    assert.equal(decideAll(e.t, mine, false), orig, `sesión ${n}: rechazar todo no devolvió el original\n${orig}\n${e.t}`);
    const clean = decideAll(e.t, mine, true);
    assert.ok(!/\\(added|deleted|replaced)\[id=lj\]/.test(clean), `sesión ${n}: quedaron marcas tras aceptar todo\n${clean}`);
    assert.ok(clean.includes("\\added[id=ana]{de otra}"), `sesión ${n}: se tocó el cambio de otra persona`);
  }
});
