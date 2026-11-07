// Pruebas de la mezcla de cambios con GitHub (la parte donde un error podría hacer perder texto).
// Se corren con:  npm test
import {test} from "node:test";
import assert from "node:assert/strict";
import {merge3, reconcile, gitSha, hasMarks, classify, MARK} from "../github.js";

const L = (...xs) => xs.join("\n");
// Ninguna línea escrita por alguien puede desaparecer de una mezcla con conflicto
const keepsAll = (txt, ...lines) => { for (const l of lines) assert.ok(txt.split("\n").includes(l), `se perdió la línea «${l}»`); };

// ---------- merge3: mezcla de un archivo de texto ----------
test("sin cambios en ningún lado", () => {
  const b = L("a", "b", "c");
  assert.deepEqual(merge3(b, b, b), {text: b, conflicts: 0});
});

test("solo cambió aquí: gana tu versión", () => {
  const b = L("a", "b", "c"), m = L("a", "B", "c");
  assert.deepEqual(merge3(b, m, b), {text: m, conflicts: 0});
});

test("solo cambió en GitHub: gana la de GitHub", () => {
  const b = L("a", "b", "c"), t = L("a", "b", "C");
  assert.deepEqual(merge3(b, b, t), {text: t, conflicts: 0});
});

test("los dos hicieron exactamente el mismo cambio", () => {
  const b = L("a", "b", "c"), x = L("a", "X", "c");
  assert.deepEqual(merge3(b, x, x), {text: x, conflicts: 0});
});

test("cambios en líneas lejanas: se juntan sin conflicto", () => {
  const b = L("1", "2", "3", "4", "5", "6");
  const m = L("1", "DOS", "3", "4", "5", "6");
  const t = L("1", "2", "3", "4", "CINCO", "6");
  assert.deepEqual(merge3(b, m, t), {text: L("1", "DOS", "3", "4", "CINCO", "6"), conflicts: 0});
});

test("tú agregas al principio y tu coautor al final", () => {
  const b = L("\\section{A}", "texto", "\\section{B}", "más");
  const m = L("% nota mía", ...b.split("\n"));
  const t = L(...b.split("\n"), "\\section{C}");
  assert.deepEqual(merge3(b, m, t), {text: L("% nota mía", "\\section{A}", "texto", "\\section{B}", "más", "\\section{C}"), conflicts: 0});
});

test("tú borras un párrafo y tu coautor edita otro lejano", () => {
  const b = L("p1", "", "p2", "", "p3", "", "p4");
  const m = L("p1", "", "p3", "", "p4");          // borra p2
  const t = L("p1", "", "p2", "", "p3", "", "P4"); // edita p4
  assert.deepEqual(merge3(b, m, t), {text: L("p1", "", "p3", "", "P4"), conflicts: 0});
});

test("los dos cambian la misma línea: conflicto con ambas versiones", () => {
  const b = L("a", "b", "c"), m = L("a", "mío", "c"), t = L("a", "suyo", "c");
  const r = merge3(b, m, t);
  assert.equal(r.conflicts, 1);
  assert.equal(r.text, L("a", MARK.a, "mío", MARK.b, "suyo", MARK.c, "c"));
  assert.ok(hasMarks(r.text));
});

test("conflicto en un lugar y mezcla limpia en otro", () => {
  const b = L("1", "2", "3", "4", "5", "6", "7");
  const m = L("1", "dos-mío", "3", "4", "5", "6", "7");
  const t = L("1", "dos-suyo", "3", "4", "5", "6", "SIETE");
  const r = merge3(b, m, t);
  assert.equal(r.conflicts, 1);
  keepsAll(r.text, "dos-mío", "dos-suyo", "SIETE");
  assert.equal(r.text.split("\n").at(-1), "SIETE");
});

test("tú editas una línea que tu coautor borró: conflicto, no se pierde tu edición", () => {
  const b = L("a", "b", "c"), m = L("a", "b editada", "c"), t = L("a", "c");
  const r = merge3(b, m, t);
  assert.equal(r.conflicts, 1);
  keepsAll(r.text, "b editada", "a", "c");
});

test("los dos insertan en el mismo lugar cosas distintas: conflicto con ambas", () => {
  const b = L("a", "c"), m = L("a", "b-mío", "c"), t = L("a", "b-suyo", "c");
  const r = merge3(b, m, t);
  assert.equal(r.conflicts, 1);
  keepsAll(r.text, "b-mío", "b-suyo");
});

test("varios conflictos se cuentan por separado", () => {
  const b = L("1", "2", "3", "4", "5");
  const m = L("uno", "2", "3", "4", "cinco");
  const t = L("ONE", "2", "3", "4", "FIVE");
  const r = merge3(b, m, t);
  assert.equal(r.conflicts, 2);
  keepsAll(r.text, "uno", "ONE", "cinco", "FIVE", "2", "3", "4");
});

test("archivo nuevo en ambos lados (sin base) con contenido distinto", () => {
  const r = merge3("", L("mi intro"), L("su intro"));
  assert.equal(r.conflicts, 1);
  keepsAll(r.text, "mi intro", "su intro");
});

test("respeta el salto de línea final y las líneas vacías", () => {
  const b = "a\n\nb\n", m = "A\n\nb\n", t = "a\n\nb\nc\n";
  assert.deepEqual(merge3(b, m, t), {text: "A\n\nb\nc\n", conflicts: 0});
});

test("acentos y comandos de LaTeX pasan intactos", () => {
  const b = L("\\begin{teorema}", "Sea $G$ un grupo.", "\\end{teorema}");
  const m = L("\\begin{teorema}", "Sea $G$ un grupo finito.", "\\end{teorema}");
  const t = L("% acción en el toro", ...b.split("\n"));
  assert.deepEqual(merge3(b, m, t), {text: L("% acción en el toro", "\\begin{teorema}", "Sea $G$ un grupo finito.", "\\end{teorema}"), conflicts: 0});
});

test("archivo grande (miles de líneas) con cambios lejanos se mezcla bien y rápido", () => {
  const base = Array.from({length: 5000}, (_, i) => `línea ${i}`);
  const m = [...base]; m[10] = "mío";
  const t = [...base]; t[4990] = "suyo";
  const t0 = Date.now(), r = merge3(base.join("\n"), m.join("\n"), t.join("\n"));
  assert.equal(r.conflicts, 0);
  const out = r.text.split("\n");
  assert.equal(out.length, 5000); assert.equal(out[10], "mío"); assert.equal(out[4990], "suyo");
  assert.ok(Date.now() - t0 < 3000, "la mezcla tardó demasiado");
});

test("muchos cambios dispersos en los dos lados nunca pierden líneas", () => {
  // Prueba con azar fijo: cada lado reemplaza líneas distintas (múltiplos de 7 aquí, de 11 allá)
  const base = Array.from({length: 300}, (_, i) => `l${i}`);
  const m = base.map((x, i) => i % 7 === 0 ? `m${i}` : x);
  const t = base.map((x, i) => i % 11 === 0 ? `t${i}` : x);
  const r = merge3(base.join("\n"), m.join("\n"), t.join("\n"));
  const mine = m.filter(x => x.startsWith("m")), theirs = t.filter(x => x.startsWith("t"));
  keepsAll(r.text, ...mine, ...theirs);
});

// ---------- reconcile: qué pasa con cada archivo del proyecto ----------
const blobs = new Map();
const put = txt => { const buf = Buffer.from(txt, "utf8"), sha = gitSha(buf); blobs.set(sha, buf); return sha; };
const fetchBlob = async sha => { if (!blobs.has(sha)) throw new Error("blob desconocido " + sha); return blobs.get(sha); };
const loc = (entries) => new Map(entries.map(([p, txt, kind = "text"]) => { const buf = Buffer.from(txt, "utf8"); return [p, {kind, buf, sha: gitSha(buf)}]; }));
const shas = entries => new Map(entries.map(([p, txt]) => [p, put(txt)]));
const text = (target, p) => target.get(p).buf.toString("utf8");

test("reconcile: archivo nuevo en GitHub llega; archivo nuevo aquí se queda", async () => {
  const base = shas([["main.tex", "x"]]);
  const local = loc([["main.tex", "x"], ["mio.tex", "nuevo mío"]]);
  const remote = shas([["main.tex", "x"], ["suyo.tex", "nuevo suyo"]]);
  const {target, conflicts, notes} = await reconcile(local, remote, base, fetchBlob);
  assert.deepEqual([...target.keys()].sort(), ["main.tex", "mio.tex", "suyo.tex"]);
  assert.equal(text(target, "suyo.tex"), "nuevo suyo");
  assert.equal(conflicts.length, 0); assert.equal(notes.length, 0);
});

test("reconcile: borrado en un lado sin cambios en el otro se respeta", async () => {
  const base = shas([["a.tex", "a"], ["b.tex", "b"]]);
  const local = loc([["a.tex", "a"]]);                   // tú borraste b
  const remote = shas([["b.tex", "b"]]);                 // tu coautor borró a
  const {target} = await reconcile(local, remote, base, fetchBlob);
  assert.equal(target.size, 0);
});

test("reconcile: lo borraron en GitHub pero tú lo editaste → se conserva y se avisa", async () => {
  const base = shas([["cap1.tex", "viejo"]]);
  const local = loc([["cap1.tex", "editado por mí"]]);
  const {target, notes} = await reconcile(local, new Map(), base, fetchBlob);
  assert.equal(text(target, "cap1.tex"), "editado por mí");
  assert.equal(notes.length, 1);
});

test("reconcile: tú lo borraste pero en GitHub lo editaron → se recupera y se avisa", async () => {
  const base = shas([["cap1.tex", "viejo"]]);
  const remote = shas([["cap1.tex", "editado por mi coautor"]]);
  const {target, notes} = await reconcile(new Map(), remote, base, fetchBlob);
  assert.equal(text(target, "cap1.tex"), "editado por mi coautor");
  assert.equal(notes.length, 1);
});

test("reconcile: los dos editan el mismo .tex en lugares distintos → mezcla limpia", async () => {
  const b = L("intro", "medio", "final");
  const base = shas([["main.tex", b]]);
  const local = loc([["main.tex", L("INTRO", "medio", "final")]]);
  const remote = shas([["main.tex", L("intro", "medio", "FINAL")]]);
  const {target, merged, conflicts} = await reconcile(local, remote, base, fetchBlob);
  assert.equal(text(target, "main.tex"), L("INTRO", "medio", "FINAL"));
  assert.deepEqual(merged, ["main.tex"]); assert.equal(conflicts.length, 0);
  assert.equal(target.get("main.tex").sha, gitSha(Buffer.from(L("INTRO", "medio", "FINAL"))));
});

test("reconcile: los dos editan la misma línea → conflicto reportado con su número", async () => {
  const base = shas([["main.tex", L("a", "b")]]);
  const local = loc([["main.tex", L("a", "mío")]]);
  const remote = shas([["main.tex", L("a", "suyo")]]);
  const {target, conflicts} = await reconcile(local, remote, base, fetchBlob);
  assert.deepEqual(conflicts, [{path: "main.tex", n: 1}]);
  keepsAll(text(target, "main.tex"), "mío", "suyo");
});

test("reconcile: una imagen cambiada en los dos lados → se conserva la tuya y se avisa", async () => {
  const base = shas([["fig.png", "\u0000viejo"]]);
  const local = loc([["fig.png", "\u0000mía", "bin"]]);
  const remote = shas([["fig.png", "\u0000suya"]]);
  const {target, notes, conflicts} = await reconcile(local, remote, base, fetchBlob);
  assert.equal(text(target, "fig.png"), "\u0000mía");
  assert.equal(notes.length, 1); assert.equal(conflicts.length, 0);
});

test("reconcile: el mismo archivo nuevo creado en ambos lados con distinto texto → conflicto", async () => {
  const local = loc([["notas.tex", "mis notas"]]);
  const remote = shas([["notas.tex", "sus notas"]]);
  const {target, conflicts} = await reconcile(local, remote, new Map(), fetchBlob);
  assert.equal(conflicts.length, 1);
  keepsAll(text(target, "notas.tex"), "mis notas", "sus notas");
});

// ---------- classify ----------
test("classify: .tex es texto; con bytes nulos o UTF-8 inválido es binario", () => {
  assert.equal(classify("a.tex", Buffer.from("hola á")), "text");
  assert.equal(classify("a.tex", Buffer.from([0x68, 0, 0x69])), "bin");
  assert.equal(classify("a.tex", Buffer.from([0xff, 0xfe, 0x41])), "bin");
  assert.equal(classify("f.png", Buffer.from("parece texto")), "bin");
  assert.equal(classify("Makefile", Buffer.from("all:")), "text");
});

// ---------- Prueba al azar: miles de pares de ediciones, ninguna línea nueva se pierde ----------
test("al azar: 2000 mezclas de ediciones aleatorias nunca pierden lo que alguien escribió", () => {
  let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let uid = 0;
  const edit = (lines, tag) => {
    const out = [...lines], added = [];
    for (let k = rnd(4) + 1; k > 0; k--) {
      const i = rnd(out.length + 1), op = rnd(3), nl = `${tag}${uid++}`;
      if (op === 0) { out.splice(i, 0, nl); added.push(nl); }                                   // insertar
      else if (op === 1 && i < out.length) { out[i] = nl; added.push(nl); }                     // reemplazar
      else if (i < out.length) out.splice(i, 1);                                                // borrar
    }
    return {lines: out, added};
  };
  for (let n = 0; n < 2000; n++) {
    const base = Array.from({length: rnd(25)}, (_, i) => `b${i}`);
    const m = edit(base, "m"), t = edit(base, "t");
    const r = merge3(base.join("\n"), m.lines.join("\n"), t.lines.join("\n"));
    const out = new Set(r.text.split("\n"));
    for (const l of [...m.added.filter(x => m.lines.includes(x)), ...t.added.filter(x => t.lines.includes(x))])
      assert.ok(out.has(l), `caso ${n}: se perdió «${l}»\nbase=${base}\nmío=${m.lines}\nsuyo=${t.lines}\nresultado=${r.text}`);
    if (!r.conflicts) {   // sin conflicto, una línea que los dos conservaron intacta tampoco puede desaparecer
      for (const l of base) if (m.lines.includes(l) && t.lines.includes(l)) assert.ok(out.has(l), `caso ${n}: se perdió «${l}» de la base`);
    }
  }
});
