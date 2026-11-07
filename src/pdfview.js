// Visor de PDF propio (pdf.js): permite saber en qué punto de la página se hace clic y señalar una posición,
// que es lo que hace falta para saltar entre el código y el PDF (SyncTeX).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function createViewer(root, {onPoint, onZoom, onSearch} = {}) {
  root.classList.add("pdfv");
  const holder = document.createElement("div"); holder.className = "pdfpages"; root.appendChild(holder);
  let doc = null, task = null, pages = [], els = [], texts = [], matches = [], cur = -1, query = "", searchGen = 0, zoom = 1, scale = 1, gen = 0, hlTimer = 0, destroyed = false;
  const GAP = 12, PAD = 12;

  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      const i = +en.target.dataset.i;
      if (en.isIntersecting) draw(i, gen); else undraw(en.target);
    }
  }, {root, rootMargin: "700px 0px"});

  async function draw(i, g) {
    const el = els[i]; if (!el || el.dataset.done === "1" || el.dataset.busy === "1") return;
    el.dataset.busy = "1";
    try {
      const page = pages[i], vp = page.getViewport({scale}), dpr = Math.min(window.devicePixelRatio || 1, 3);
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = vp.width + "px"; canvas.style.height = vp.height + "px";
      const ctx = canvas.getContext("2d");
      await page.render({canvas, canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined}).promise;
      if (g !== gen || destroyed) return;
      const tl = document.createElement("div"); tl.className = "textLayer";
      tl.style.setProperty("--scale-factor", scale); tl.style.setProperty("--total-scale-factor", scale);
      el.querySelectorAll("canvas,.textLayer").forEach(x => x.remove());
      el.prepend(canvas); el.appendChild(tl);
      el.dataset.done = "1";
      new pdfjs.TextLayer({textContentSource: page.streamTextContent(), container: tl, viewport: vp}).render().catch(() => {});
    } catch (e) { if (e?.name !== "RenderingCancelledException") console.warn("pdf", e); }
    finally { el.dataset.busy = ""; }
  }
  function undraw(el) {
    if (el.dataset.done !== "1") return;
    el.querySelectorAll("canvas,.textLayer").forEach(x => x.remove()); el.dataset.done = "";
  }

  function fitScale() {
    const w = pages[0].getViewport({scale: 1}).width;
    return Math.max(0.1, (root.clientWidth - PAD * 2) / w) * zoom;
  }

  function layout() {
    if (!doc) return;
    const my = ++gen;
    scale = fitScale();
    io.disconnect();
    const frag = document.createDocumentFragment(); els = [];
    pages.forEach((pg, i) => {
      const vp = pg.getViewport({scale}), el = document.createElement("div");
      el.className = "pdfpage"; el.dataset.i = i; el.style.width = vp.width + "px"; el.style.height = vp.height + "px";
      el.style.setProperty("--scale-factor", scale);
      frag.appendChild(el); els.push(el);
    });
    holder.replaceChildren(frag);
    els.forEach(e => io.observe(e));
    paintMarks();
    return my;
  }

  async function load(bytes) {
    const nt = pdfjs.getDocument({data: bytes.slice(0)});   // copia: pdf.js se queda con el búfer
    const nd = await nt.promise;
    const np = []; for (let i = 1; i <= nd.numPages; i++) np.push(await nd.getPage(i));
    if (destroyed) { nt.destroy(); return; }
    const top = root.scrollTop, left = root.scrollLeft, old = task;
    doc = nd; task = nt; pages = np; texts = []; links = []; prevCache.clear(); hidePrev(); layout();
    root.scrollTop = top; root.scrollLeft = left;          // seguir en el mismo sitio tras recompilar
    old?.destroy().catch?.(() => {});
    if (query) { const keep = cur; search(query).then(r => { if (keep >= 0 && keep < matches.length) { cur = keep; paintMarks(); } onSearch?.(r); }); }
  }

  function setZoom(z) {
    if (!doc) return;
    z = Math.max(0.4, Math.min(z, 5));
    // mantener el centro de lo que se está viendo
    const mid = (root.scrollTop + root.clientHeight / 2) / Math.max(1, holder.scrollHeight);
    zoom = z; layout(); root.scrollTop = mid * holder.scrollHeight - root.clientHeight / 2;
    onZoom?.(zoom);
  }

  // Punto de una página bajo el cursor, en puntos del PDF (origen arriba a la izquierda)
  function pointAt(e) {
    const el = e.target.closest?.(".pdfpage"); if (!el) return null;
    const r = el.getBoundingClientRect();
    return {page: +el.dataset.i + 1, x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale};
  }
  root.addEventListener("dblclick", e => { const p = pointAt(e); if (p) { e.preventDefault(); getSelection()?.removeAllRanges(); onPoint?.(p); } });
  root.addEventListener("click", e => { if (e.metaKey || e.ctrlKey) { const p = pointAt(e); if (p) { e.preventDefault(); onPoint?.(p); } } });
  // Ctrl/⌘ + rueda para acercar o alejar
  root.addEventListener("wheel", e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, {passive: false});


  // ---------- Vista previa al pasar el cursor sobre una referencia (enlaces internos del PDF) ----------
  // Los enlaces de hyperref/cleveref guardan a qué página y altura apuntan; se dibuja ese trozo de página en un recuadro flotante.
  let links = [], prevCache = new Map(), hoverT = 0, shownKey = "", pop = null, lastMove = 0;
  const PREV_W = 520, PREV_H = 150;                       // tamaño del recorte, en puntos del PDF
  const ap = (x, y, m) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];   // punto del PDF → punto de la página (origen arriba)
  async function linksOf(i) {
    if (links[i]) return links[i];
    const page = pages[i], vp = page.getViewport({scale: 1});
    const anns = await page.getAnnotations().catch(() => []);
    return links[i] = anns.filter(a => a.subtype === "Link" && a.rect && a.dest).map(a => {
      const [x1, y1] = ap(a.rect[0], a.rect[1], vp.transform), [x2, y2] = ap(a.rect[2], a.rect[3], vp.transform);
      return {x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), dest: a.dest};
    });
  }
  async function resolveDest(dest) {
    let d = typeof dest === "string" ? await doc.getDestination(dest).catch(() => null) : dest;
    if (!Array.isArray(d) || !d.length) return null;
    const pi = typeof d[0] === "object" && d[0] !== null ? await doc.getPageIndex(d[0]).catch(() => -1) : +d[0];
    if (!(pi >= 0 && pi < pages.length)) return null;
    const mode = d[1]?.name, vp = pages[pi].getViewport({scale: 1});
    let top = null;
    if (mode === "XYZ") top = d[3]; else if (mode === "FitH" || mode === "FitBH") top = d[2]; else if (mode === "FitR") top = d[5];
    const y = top == null ? 0 : ap(0, top, vp.transform)[1];
    return {page: pi, y: Math.max(0, y), w: vp.width, h: vp.height};
  }
  async function previewFor(dest) {
    const t = await resolveDest(dest); if (!t) return null;
    const y0 = Math.max(0, Math.min(t.y - 4, t.h - PREV_H)), x0 = Math.max(0, (t.w - PREV_W) / 2), key = `${t.page}:${Math.round(y0)}`;
    if (prevCache.has(key)) return prevCache.get(key);
    const S = 1.25, dpr = Math.min(window.devicePixelRatio || 1, 2), page = pages[t.page];
    const w = Math.min(PREV_W, t.w), h = Math.min(PREV_H, t.h - y0);
    const vp = page.getViewport({scale: S, offsetX: -x0 * S, offsetY: -y0 * S});
    const canvas = document.createElement("canvas"); canvas.width = Math.floor(w * S * dpr); canvas.height = Math.floor(h * S * dpr);
    canvas.style.width = w * S + "px"; canvas.style.height = h * S + "px";
    await page.render({canvas, canvasContext: canvas.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined}).promise;
    const res = {url: canvas.toDataURL("image/png"), w: w * S, h: h * S, page: t.page + 1};
    prevCache.set(key, res); if (prevCache.size > 60) prevCache.delete(prevCache.keys().next().value);
    return res;
  }
  function hidePrev() { clearTimeout(hoverT); hoverT = 0; shownKey = ""; if (pop) { pop.remove(); pop = null; } root.classList.remove("onlink"); }
  async function showPrev(link, ev, gen0, key) {
    const r = await previewFor(link.dest).catch(() => null);
    if (!r || destroyed || gen0 !== lastMove) return;
    hidePrev(); shownKey = key; root.classList.add("onlink");
    pop = document.createElement("div"); pop.className = "pdfprev";
    const img = new Image(); img.src = r.url; img.style.width = r.w + "px"; img.style.height = r.h + "px"; img.alt = "";
    const cap = document.createElement("div"); cap.className = "cap"; cap.textContent = `Página ${r.page}`;
    pop.append(img, cap); document.body.appendChild(pop);
    const bw = pop.offsetWidth, bh = pop.offsetHeight;
    let x = Math.min(Math.max(8, ev.clientX - 40), innerWidth - bw - 8), y = ev.clientY + 22;
    if (y + bh > innerHeight - 8) y = Math.max(8, ev.clientY - bh - 14);
    pop.style.left = x + "px"; pop.style.top = y + "px";
  }
  root.addEventListener("mousemove", async e => {
    if (!doc || e.buttons) return hidePrev();
    if (pop && pop.contains(e.target)) return;
    const el = e.target.closest?.(".pdfpage"); if (!el) return hidePrev();
    const i = +el.dataset.i, b = el.getBoundingClientRect(), x = (e.clientX - b.left) / scale, y = (e.clientY - b.top) / scale;
    const ls = links[i]; if (!ls) { linksOf(i); return; }
    const hit = ls.find(l => x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h);
    if (!hit) { root.classList.remove("onlink"); if (pop || hoverT) hidePrev(); return; }
    root.classList.add("onlink");
    const key = `${i}:${Math.round(hit.x)}:${Math.round(hit.y)}`;
    if (key === shownKey) return;
    if (pop) hidePrev();
    clearTimeout(hoverT); shownKey = key; const g = ++lastMove, ev = {clientX: e.clientX, clientY: e.clientY};
    hoverT = setTimeout(() => showPrev(hit, ev, g, key), 280);
  });
  root.addEventListener("mouseleave", hidePrev);
  root.addEventListener("scroll", hidePrev, {passive: true});
  root.addEventListener("mousedown", hidePrev);

  // Reajustar al cambiar el ancho del panel
  let lastW = root.clientWidth, rt = 0;
  const ro = new ResizeObserver(() => {
    if (!doc || Math.abs(root.clientWidth - lastW) < 4 || !root.clientWidth) { lastW = root.clientWidth || lastW; return; }
    lastW = root.clientWidth; clearTimeout(rt);
    rt = setTimeout(() => { const mid = (root.scrollTop + root.clientHeight / 2) / Math.max(1, holder.scrollHeight); layout(); root.scrollTop = mid * holder.scrollHeight - root.clientHeight / 2; }, 120);
  });
  ro.observe(root);


  // ---------- Buscar texto ----------
  // Sin acentos ni mayúsculas. Los PDF sin codificación T1 guardan «á» como un acento suelto (´) + «a»: también se ignoran esos acentos sueltos.
  const fold = c => c.normalize("NFD").replace(/[\p{M}´`¨ˆ˜¸˘˙˚˝ˇ¯]/gu, "").toLowerCase();
  function foldMap(str) {                                  // texto sin acentos ni mayúsculas + a qué carácter original corresponde cada uno
    let out = "", map = [];
    for (let i = 0; i < str.length; i++) { const n = fold(str[i]); for (const ch of n) { out += ch; map.push(i); } }
    return {out, map};
  }
  async function pageText(i) {
    if (texts[i]) return texts[i];
    const page = pages[i], tc = await page.getTextContent(), vp = page.getViewport({scale: 1});
    let str = "", owner = [];
    const items = [];
    for (const it of tc.items) {
      if (typeof it.str !== "string") continue;
      const t = pdfjs.Util.transform(vp.transform, it.transform), fs = Math.hypot(t[2], t[3]) || it.height || 10;
      const idx = items.push({x: t[4], y: t[5], w: it.width || 0, fs, len: it.str.length, str: it.str}) - 1;
      for (let k = 0; k < it.str.length; k++) { str += it.str[k]; owner.push([idx, k]); }
      if (it.hasEOL) { str += " "; owner.push(null); }
    }
    const f = foldMap(str);
    return texts[i] = {str, owner, items, folded: f.out, map: f.map};
  }
  const rectsOf = (pt, a, b) => {                          // rectángulos (en puntos del PDF) de los caracteres [a, b) de la página
    const byItem = new Map();
    for (let k = a; k < b; k++) { const o = pt.owner[k]; if (!o) continue; const r = byItem.get(o[0]); if (r) r[1] = o[1] + 1; else byItem.set(o[0], [o[1], o[1] + 1]); }
    // La posición de cada letra se estima con las proporciones de una tipografía normal (las letras no miden todas lo mismo)
    const mc = rectsOf.ctx || (rectsOf.ctx = document.createElement("canvas").getContext("2d")); mc.font = "100px serif";
    const mw = str => mc.measureText(str).width;
    return [...byItem].map(([i, [c0, c1]]) => { const it = pt.items[i], tot = mw(it.str) || Math.max(1, it.len), x0 = it.w * mw(it.str.slice(0, c0)) / tot, x1 = it.w * mw(it.str.slice(0, c1)) / tot;
      return {x: it.x + x0, y: it.y - it.fs * 0.85, w: Math.max(2, x1 - x0), h: it.fs * 1.1}; });
  };
  async function search(q) {
    const my = ++searchGen; query = q; matches = []; cur = -1;
    const fq = foldMap(q.replace(/\s+/g, " ").trim()).out;
    if (!doc || !fq) { paintMarks(); return {count: 0, index: -1}; }
    for (let i = 0; i < pages.length; i++) {
      const pt = await pageText(i); if (my !== searchGen || destroyed) return {count: matches.length, index: cur};
      let from = 0, at;
      while ((at = pt.folded.indexOf(fq, from)) >= 0) {
        const a = pt.map[at], b = pt.map[at + fq.length - 1] + 1;
        matches.push({page: i, rects: rectsOf(pt, a, b)}); from = at + Math.max(1, fq.length);
      }
    }
    if (matches.length) { const top = root.scrollTop; cur = Math.max(0, matches.findIndex(m => els[m.page] && els[m.page].offsetTop + (m.rects[0]?.y || 0) * scale >= top - 4)); }
    paintMarks(); if (cur >= 0) reveal();
    return {count: matches.length, index: cur};
  }
  function paintMarks() {
    root.querySelectorAll(".pdfmarks").forEach(x => x.remove());
    const by = new Map();
    matches.forEach((m, n) => { if (!by.has(m.page)) by.set(m.page, []); by.get(m.page).push([m, n]); });
    for (const [pg, list] of by) {
      const el = els[pg]; if (!el) continue;
      const layer = document.createElement("div"); layer.className = "pdfmarks";
      for (const [m, n] of list) for (const r of m.rects) {
        const d = document.createElement("div"); d.className = "pdfmark" + (n === cur ? " cur" : "");
        d.style.cssText = `left:${r.x * scale - 1}px;top:${r.y * scale}px;width:${r.w * scale + 2}px;height:${r.h * scale}px`; layer.appendChild(d);
      }
      el.appendChild(layer);
    }
  }
  function reveal() {
    const m = matches[cur], el = m && els[m.page]; if (!el) return;
    const r = m.rects[0] || {y: 0, x: 0, h: 0}, y = el.offsetTop + r.y * scale, x = el.offsetLeft + r.x * scale;
    if (y < root.scrollTop + 40 || y > root.scrollTop + root.clientHeight - 60) root.scrollTo({top: Math.max(0, y - root.clientHeight * 0.35), behavior: "smooth"});
    if (x < root.scrollLeft || x > root.scrollLeft + root.clientWidth - 40) root.scrollTo({left: Math.max(0, x - root.clientWidth * 0.3), behavior: "smooth"});
  }
  function step(d) {
    if (!matches.length) return {count: 0, index: -1};
    cur = (cur + d + matches.length) % matches.length; paintMarks(); reveal(); return {count: matches.length, index: cur};
  }

  // Señalar una posición (del código al PDF)
  function show({page, h, v, W, H}) {
    const el = els[page - 1]; if (!el) return false;
    holder.querySelectorAll(".pdfhl").forEach(x => x.remove()); clearTimeout(hlTimer);
    const hl = document.createElement("div"); hl.className = "pdfhl";
    const top = (v - H) * scale - 2, hh = Math.max(H * 1.35, 9) * scale + 4;
    hl.style.cssText = `left:${Math.max(0, h * scale - 4)}px;top:${Math.max(0, top)}px;width:${Math.max(W * scale + 8, 24)}px;height:${hh}px`;
    el.appendChild(hl);
    const y = el.offsetTop + top - root.clientHeight * 0.3;
    root.scrollTo({top: Math.max(0, y), behavior: "smooth"});
    hlTimer = setTimeout(() => hl.remove(), 2600);
    return true;
  }

  async function thumb(w = 240) {
  if (!pages.length) return null;
  const page = pages[0], v1 = page.getViewport({scale: 1}), sc = w / v1.width, vp = page.getViewport({scale: sc});
  const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  await page.render({canvas: c, canvasContext: x, viewport: vp}).promise;
  return c.toDataURL("image/jpeg", 0.72).split(",")[1];
  }
  return {
    thumb, load, show, setZoom, search, next: () => step(1), prev: () => step(-1), clearSearch() { searchGen++; query = ""; matches = []; cur = -1; paintMarks(); },
    // Dónde está la persona: zoom y posición vertical (proporción del alto total), para volver al mismo sitio
    getState: () => ({zoom, frac: doc ? root.scrollTop / Math.max(1, holder.scrollHeight) : 0}),
    setState(st) { if (!doc || !st) return; if (st.zoom && Math.abs(st.zoom - zoom) > 0.001) { zoom = Math.max(0.4, Math.min(st.zoom, 5)); layout(); onZoom?.(zoom); } root.scrollTop = (st.frac || 0) * holder.scrollHeight; },
    zoomBy: f => setZoom(zoom * f), get zoom() { return zoom; }, get ready() { return !!doc; }, get pages() { return pages.length; },
    destroy() { destroyed = true; hidePrev(); io.disconnect(); ro.disconnect(); clearTimeout(rt); clearTimeout(hlTimer); task?.destroy(); doc = null; holder.remove(); },
  };
}
