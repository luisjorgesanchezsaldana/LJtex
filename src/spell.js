// Corrector ortográfico para el editor: subraya las palabras mal escritas (solo prosa, no comandos ni fórmulas),
// menú con sugerencias al hacer clic derecho, diccionario personal e idiomas a elegir.
import {ViewPlugin, Decoration, EditorView} from "@codemirror/view";
import {StateEffect, StateField, RangeSetBuilder} from "@codemirror/state";
import {proseWords} from "./prose.js";

export const LANGS = {es: "Español", en: "English (US)", "en-gb": "English (UK)", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano", ca: "Català"};

const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---------- Ajustes (se recuerdan en este navegador) ----------
export const spellState = {failed: []};
export const getSpell = () => ({on: lsGet("spellOn", true) !== false, langs: (lsGet("spellLangs", ["es", "en"]) || []).filter(l => LANGS[l])});
export const setSpell = (o) => { const c = {...getSpell(), ...o}; lsSet("spellOn", c.on); lsSet("spellLangs", c.langs); refresh(); };
const personal = new Set((lsGet("spellDict", []) || []).map(w => String(w)));
export const personalWords = () => [...personal].sort((a, b) => a.localeCompare(b));
export const addWord = w => { personal.add(w.toLowerCase()); lsSet("spellDict", [...personal]); refresh(); };
export const removeWord = w => { personal.delete(w); lsSet("spellDict", [...personal]); refresh(); };
const ignored = new Set();                           // «Ignorar» (solo hasta recargar)

// ---------- Hilo de trabajo ----------
let worker = null, token = "", rid = 0;
const waiting = new Map();
export const configureSpell = t => { token = t; worker?.postMessage({op: "init", token}); };
function call(msg) {
  if (!worker) {
    worker = new Worker(new URL("./spellworker.js", import.meta.url), {type: "module"});
    worker.onmessage = ({data}) => { waiting.get(data.id)?.(data); waiting.delete(data.id); };
    worker.onerror = e => { console.warn("corrector", e.message); };
    worker.postMessage({op: "init", token});
  }
  return new Promise(res => { const id = ++rid; waiting.set(id, res); worker.postMessage({...msg, id}); });
}

// ---------- Subrayado ----------
const setDecos = StateEffect.define();
const field = StateField.define({
  create: () => Decoration.none,
  update(d, tr) { d = d.map(tr.changes); for (const e of tr.effects) if (e.is(setDecos)) d = e.value; return d; },
  provide: f => EditorView.decorations.from(f),
});
const mark = Decoration.mark({class: "cm-spell"});
const cache = new Map();                              // "es,en" → Map(palabra → ¿correcta?)
const instances = new Set();
function refresh() { for (const p of instances) p.schedule(0); }

const plugin = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; this.timer = 0; this.seq = 0; instances.add(this); this.schedule(300); }
  update(u) { if (u.docChanged || u.selectionSet) this.schedule(u.docChanged ? 500 : 350); }
  destroy() { clearTimeout(this.timer); instances.delete(this); this.seq++; }
  schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); }
  async run() {
    const view = this.view, my = ++this.seq, {on, langs} = getSpell();
    if (!on || !langs.length) { if (view.state.field(field).size) view.dispatch({effects: setDecos.of(Decoration.none)}); return; }
    const doc = view.state.doc.toString(), toks = proseWords(doc), key = langs.join(",");
    let known = cache.get(key); if (!known) cache.set(key, known = new Map());
    const unknown = [...new Set(toks.map(t => t.word).filter(w => !known.has(w)))];
    if (unknown.length) {
      for (let i = 0; i < unknown.length; i += 3000) {
        const batch = unknown.slice(i, i + 3000), r = await call({op: "check", langs, words: batch});
        if (my !== this.seq) return;                  // llegó algo más reciente
        spellState.failed = r.failed || [];
        if (r.none) return;                           // ningún diccionario cargó: mejor no marcar nada
        const bad = new Set(r.bad); for (const w of batch) known.set(w, !bad.has(w));
      }
    }
    if (my !== this.seq || view.state.doc.toString() !== doc) return;
    const head = view.state.selection.main.head, b = new RangeSetBuilder();
    for (const t of toks) {
      if (known.get(t.word) !== false) continue;
      const lw = t.word.toLowerCase();
      if (personal.has(lw) || ignored.has(lw)) continue;
      if (view.hasFocus && head >= t.from && head <= t.to) continue;      // la palabra que se está escribiendo
      b.add(t.from, t.to, mark);
    }
    view.dispatch({effects: setDecos.of(b.finish())});
  }
});

// ---------- Menú del clic derecho ----------
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; document.removeEventListener("pointerdown", onOutside, true); document.removeEventListener("keydown", onEsc, true); };
const onOutside = e => { if (!menuEl?.contains(e.target)) closeMenu(); };
const onEsc = e => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

function openMenu(view, x, y, from, to) {
  closeMenu();
  const word = view.state.doc.sliceString(from, to);
  menuEl = document.createElement("div"); menuEl.className = "spellmenu"; menuEl.setAttribute("role", "menu");
  menuEl.innerHTML = `<div class="sg"><small>Buscando sugerencias…</small></div><hr><button data-a="add">Añadir «${esc(word)}» al diccionario</button><button data-a="ign">Ignorar</button>`;
  document.body.appendChild(menuEl);
  const place = () => { menuEl.style.left = Math.max(6, Math.min(x, innerWidth - menuEl.offsetWidth - 6)) + "px"; menuEl.style.top = Math.max(6, Math.min(y, innerHeight - menuEl.offsetHeight - 6)) + "px"; };
  place();
  menuEl.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.s != null) view.dispatch({changes: {from, to, insert: b.dataset.s}, selection: {anchor: from + b.dataset.s.length}});
    else if (b.dataset.a === "add") addWord(word); else if (b.dataset.a === "ign") { ignored.add(word.toLowerCase()); refresh(); }
    closeMenu(); view.focus();
  };
  document.addEventListener("pointerdown", onOutside, true); document.addEventListener("keydown", onEsc, true);
  call({op: "suggest", langs: getSpell().langs, word}).then(r => {
    if (!menuEl) return;
    const sg = menuEl.querySelector(".sg"), list = r.suggestions || [];
    sg.innerHTML = list.length ? list.map(s => `<button data-s="${esc(s)}"><b>${esc(s)}</b></button>`).join("") : "<small>Sin sugerencias</small>";
    place();
  });
}

const menuHandler = EditorView.domEventHandlers({
  contextmenu(e, view) {
    const pos = view.posAtCoords({x: e.clientX, y: e.clientY}); if (pos == null) return false;
    let hit = null;
    view.state.field(field).between(Math.max(0, pos - 1), pos + 1, (a, b) => { if (pos >= a && pos <= b) hit = [a, b]; });
    if (!hit) return false;                           // fuera de una palabra marcada: menú normal del navegador
    e.preventDefault(); openMenu(view, e.clientX, e.clientY, hit[0], hit[1]); return true;
  },
});

export const spellcheck = () => [field, plugin, menuHandler, EditorView.theme({".cm-spell": {textDecoration: "underline wavy #d6453d", textDecorationSkipInk: "none", textUnderlineOffset: "2px"}})];
