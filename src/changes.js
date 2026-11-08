// Control de cambios en el editor: colores por autor, modo «sugerir cambios» (lo que escribes o borras queda marcado)
// y una burbuja para aceptar o rechazar el cambio donde está el cursor. La lógica de las marcas está en changes-core.js.
import {StateField, StateEffect, EditorState, Transaction, RangeSetBuilder} from "@codemirror/state";
import {ViewPlugin, Decoration, EditorView, showTooltip} from "@codemirror/view";
import {parseChanges, decide, suggest, changeAuthors} from "./changes-core.js";

// Color en el editor para cada color de xcolor (el mismo que verá el PDF)
const CSS = {blue: "#2f5fd0", red: "#c62f2f", teal: "#118a7e", violet: "#7a4ee0", orange: "#d9730d", olive: "#7a8a12", magenta: "#c0369a", brown: "#8b5a2b"};
export const authorColor = (authors, id) => CSS[authors.get(id)?.color] || CSS[["blue", "red", "teal", "violet", "orange", "olive", "magenta", "brown"][[...String(id)].reduce((h, c) => h * 31 + c.charCodeAt(0) >>> 0, 7) % 8]];

const setRegion = StateEffect.define();
export const refreshChanges = StateEffect.define();   // volver a pintar (p. ej. al conocer los colores de los autores)
// Zona que estás agregando ahora (se mueve con el texto)
const regionField = StateField.define({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setRegion)) return e.value;
    if (!v || !tr.docChanged) return v;
    return [tr.changes.mapPos(v[0], -1), tr.changes.mapPos(v[1], 1)];
  },
});

// opts: {on(): ¿modo sugerir activo?, me(): id del autor, authors(): Map de autores, block(mensaje), decided()}
export function changesExt(opts) {
  const filter = EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged || !opts.on()) return tr;
    if (!(tr.isUserEvent("input") || tr.isUserEvent("delete"))) return tr;
    const list = []; tr.changes.iterChanges((fa, ta, fb, tb, ins) => list.push({from: fa, to: ta, ins: ins.toString(), fb}));
    if (list.length !== 1) { opts.block("En modo «Sugerir cambios» edita un solo lugar a la vez."); return []; }
    const c = list[0], head = tr.newSelection.main.head;
    const cursor = Math.max(0, Math.min(c.ins.length, head - c.fb));
    const kind = tr.isUserEvent("delete.forward") ? "forward" : tr.isUserEvent("delete") ? "backward" : "input";
    const r = suggest(tr.startState.doc.toString(), {from: c.from, to: c.to, ins: c.ins, cursor, kind}, opts.me(), tr.startState.field(regionField));
    if (!r) return tr;
    if (r.pass) return {changes: tr.changes, selection: tr.selection, scrollIntoView: tr.scrollIntoView,   // se deja igual, recordando la zona
      effects: [...tr.effects, setRegion.of(r.region)], annotations: Transaction.userEvent.of(tr.annotation(Transaction.userEvent) || "input")};
    if (r.block) { opts.block(r.block); return []; }
    if (r.move != null) return {selection: {anchor: r.move}, scrollIntoView: true};
    return {changes: {from: r.from, to: r.to, insert: r.insert}, selection: {anchor: r.cursor}, scrollIntoView: true,
      effects: setRegion.of(r.region ?? null), annotations: Transaction.userEvent.of(tr.annotation(Transaction.userEvent) || "input")};
  });

  // Colores: marcas tenues, agregado subrayado con el color del autor, quitado tachado
  const deco = ViewPlugin.fromClass(class {
    constructor(v) { this.build(v); }
    update(u) { if (u.docChanged || u.viewportChanged || u.transactions.some(tr => tr.effects.some(e => e.is(refreshChanges)))) this.build(u.view); }
    build(v) {
      const t = v.state.doc.toString(), au = opts.authors(), b = new RangeSetBuilder();
      this.list = parseChanges(t);
      for (const c of this.list) {
        const col = authorColor(au, c.id), st = {attributes: {style: `--cc:${col}`}};
        const parts = [];
        for (const m of c.marks) parts.push([m[0], m[1], "chg-mk"]);
        if (c.type === "added") parts.push([c.body[0], c.body[1], "chg-add"]);
        if (c.type === "deleted") parts.push([c.body[0], c.body[1], "chg-del"]);
        if (c.type === "replaced") { parts.push([c.nw[0], c.nw[1], "chg-add"]); parts.push([c.old[0], c.old[1], "chg-del"]); }
        parts.sort((x, y) => x[0] - y[0]);
        for (const [a, z, cls] of parts) if (z > a) b.add(a, z, Decoration.mark({class: cls, ...st}));
      }
      this.decorations = b.finish();
    }
  }, {decorations: p => p.decorations});

  // Burbuja sobre el cambio donde está el cursor
  const tip = StateField.define({
    create: () => null,
    update(v, tr) {
      if (!tr.docChanged && !tr.selection) return v;
      const s = tr.state.selection.main; if (!s.empty) return null;
      const c = parseChanges(tr.state.doc.toString()).find(c => c.from < s.head && s.head < c.to);
      if (!c) return null;
      return {pos: c.from, above: true, strictSide: false, arrow: false, create: view => {
        const au = opts.authors(), a = au.get(c.id), dom = document.createElement("div");
        dom.className = "chg-tip";
        const what = c.type === "added" ? "agregó" : c.type === "deleted" ? "quitó" : "cambió";
        dom.innerHTML = `<i style="background:${authorColor(au, c.id)}"></i><span><b></b> ${what}${c.comment ? ` · <em></em>` : ""}</span><button data-a="1" title="Aceptar este cambio">✓ Aceptar</button><button data-a="0" title="Rechazar este cambio">✕ Rechazar</button>`;
        dom.querySelector("b").textContent = a?.name || c.id || "Alguien";
        if (c.comment) dom.querySelector("em").textContent = c.comment;
        dom.onmousedown = e => {
          const btn = e.target.closest("button"); if (!btn) return;
          e.preventDefault();
          const cur = parseChanges(view.state.doc.toString()).find(x => x.from === c.from && x.type === c.type);
          if (!cur) return;
          const d = decide(view.state.doc.toString(), cur, btn.dataset.a === "1");
          view.dispatch({changes: d, selection: {anchor: d.from + d.insert.length}, userEvent: "changes.decide"});
          opts.decided?.();
          view.focus();
        };
        return {dom};
      }};
    },
    provide: f => showTooltip.from(f),
  });

  return [regionField, filter, deco, tip];
}

// Lista de cambios del texto con su autor y un extracto (para el panel)
export function changeList(text, authors) {
  const t = String(text);
  return parseChanges(t).map(c => {
    const s = r => t.slice(r[0], r[1]).replace(/\s+/g, " ");
    return {...c, name: authors.get(c.id)?.name || c.id || "Alguien", nwText: c.type === "replaced" ? s(c.nw) : c.type === "added" ? s(c.body) : "", oldText: c.type === "replaced" ? s(c.old) : c.type === "deleted" ? s(c.body) : ""};
  });
}
export {changeAuthors};
