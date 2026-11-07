import {EditorView, basicSetup} from "codemirror";
import {EditorSelection, StateEffect, StateField, EditorState, Compartment} from "@codemirror/state";
import {ViewPlugin, Decoration, gutter as cmGutter, GutterMarker} from "@codemirror/view";
import {analyze} from "./loganalysis.js";
import {renderMd} from "./markdown.js";
import {latexComplete} from "./complete.js";
import {StreamLanguage, HighlightStyle, syntaxHighlighting} from "@codemirror/language";
import {tags as T} from "@lezer/highlight";
import {stex} from "@codemirror/legacy-modes/mode/stex";
import {MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView, getChunks, getOriginalDoc, acceptChunk, rejectChunk} from "@codemirror/merge";
import * as Y from "yjs";
import {HocuspocusProvider} from "@hocuspocus/provider";
import {yCollab} from "y-codemirror.next";
import {createViewer} from "./pdfview.js";
import {ico, fileIcon} from "./icons.js";

// ---------- Tema claro / oscuro ----------
let themeHook = null;
const darkHL = syntaxHighlighting(HighlightStyle.define([
  {tag: [T.keyword, T.operatorKeyword, T.modifier, T.controlKeyword], color: "#8bc9a0"},
  {tag: [T.comment, T.lineComment, T.blockComment], color: "#6f7b8c", fontStyle: "italic"},
  {tag: [T.string, T.special(T.string), T.regexp], color: "#e5b97a"},
  {tag: [T.number, T.atom, T.bool, T.literal], color: "#e0a070"},
  {tag: [T.meta, T.processingInstruction, T.annotation], color: "#c3a0ec"},
  {tag: [T.tagName, T.heading, T.typeName, T.className, T.labelName, T.macroName], color: "#8db4f0"},
  {tag: [T.strong], fontWeight: "bold"}, {tag: [T.emphasis], fontStyle: "italic"},
  {tag: [T.bracket, T.punctuation, T.separator], color: "#93a0b4"},
  {tag: [T.variableName, T.name, T.propertyName, T.attributeName], color: "#d5dbe6"},
  {tag: [T.link, T.url], color: "#7cc4e8"}, {tag: T.invalid, color: "#ff7b8a"},
]));
const hlComp = new Compartment();
const sysDark = () => matchMedia?.("(prefers-color-scheme: dark)").matches;
const themeNow = () => { try { return localStorage.tema || (sysDark() ? "dark" : "light"); } catch { return "light"; } };
const applyTheme = () => { document.documentElement.dataset.theme = themeNow(); themeHook?.(); document.querySelectorAll(".dk").forEach(b => { b.innerHTML = ico(themeNow() === "dark" ? "sun" : "moon", 16); b.title = themeNow() === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"; }); };
const toggleTheme = () => { try { localStorage.tema = themeNow() === "dark" ? "light" : "dark"; } catch {} applyTheme(); };
applyTheme();
import {latexFold} from "./fold.js";
import {mathHover} from "./mathpreview.js";
import {buildOutline, layout} from "./outline.js";
import {logoSvg} from "./logo.js";
import {spellcheck, configureSpell, getSpell, setSpell, LANGS, personalWords, addWord, removeWord, spellState} from "./spell.js";

const ls = (k, ask) => localStorage[k] || (localStorage[k] = prompt(ask) || "");
const name = ls("nombre", "Tu nombre"), pass = ls("clave", "Clave del grupo");
configureSpell(pass);
const H = {"x-token": pass, "x-user": encodeURIComponent(name), "Content-Type": "application/json"};
// Si el servidor rechaza la clave guardada (401), la pide de nuevo en vez de quedarse con una lista vacía
let askingKey = false;
const badKey = () => {
  if (askingKey) return; askingKey = true;
  const p = prompt("La clave no coincide con la del servidor. Escríbela de nuevo (la que pusiste en TOKEN= al arrancar LJtex):");
  if (p) { localStorage.clave = p; location.reload(); } else askingKey = false;
};
const api = (u, o = {}) => fetch("/api" + u, {...o, headers: H, body: o.body && JSON.stringify(o.body)}).then(r => { if (r.status === 401) { badKey(); return {}; } return r.json().catch(() => ({})); });
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const $ = id => document.getElementById(id);
const when = t => new Date(t).toLocaleString("es", {dateStyle: "medium", timeStyle: "short"});
const hm = t => new Date(t).toLocaleTimeString("es", {hour: "2-digit", minute: "2-digit"});
const dayLabel = t => {
  const d = new Date(t), n = new Date(), same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, n)) return "Hoy";
  if (same(d, new Date(n - 864e5))) return "Ayer";
  const s = d.toLocaleDateString("es", {weekday: "long", day: "numeric", month: "long", year: "numeric"});
  return s[0].toUpperCase() + s.slice(1);
};
// Cada persona tiene siempre el mismo color: en su cursor y en el historial
const colorOf = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 62% 42%)`; };
const color = colorOf(name), colorLight = color.replace(")", " / 0.2)");
const chips = a => (a || "").split(", ").filter(Boolean).map(n => `<span class="who"><i style="background:${colorOf(n)}"></i>${esc(n)}</span>`).join("");
const statsHtml = s => {
  if (!s) return "";
  if (s.i) return `<span class="m">Primera versión · ${s.n} líneas</span>`;
  const p = [];
  p.push(s.a || s.r ? `<span class="ad">+${s.a}</span> <span class="rm">−${s.r}</span> líneas` : '<span class="m">sin cambios de líneas</span>');
  if (s.w) p.push(`${s.w > 0 ? "+" : "−"}${Math.abs(s.w)} palabras`);
  return p.join(" · ");
};
const EV = {project: "creó el proyecto", create: "creó", upload: "subió", replace: "reemplazó", delete: "eliminó", move: "movió", "restore-project": "restauró el proyecto", github: "sincronizó con GitHub"};
let cleanup = () => {};

function route() {
  cleanup(); cleanup = () => {};
  const m = location.hash.match(/^#\/p\/(\w+)/);
  m ? project(m[1]) : home();
}
// (la primera pantalla se dibuja al final del archivo, cuando ya está definido todo lo que usa)

// ---------- Lista de proyectos (los modificados más recientemente, primero) ----------
const norm = t => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tagColor = t => { let h = 0; for (const c of norm(t)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const tagChip = (t, extra = "") => `<span class="tg" style="--h:${tagColor(t)}" ${extra}>${esc(t)}</span>`;
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const NONE = "\u0000sin";

function modal(html, onMount) {
  const md = document.createElement("div"); md.className = "modal"; md.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(md);
  const close = () => { md.remove(); document.removeEventListener("keydown", esc2, true); };
  const esc2 = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", esc2, true);
  md.onclick = e => { if (e.target === md) close(); };
  onMount(md, close); return md;
}

// ---------- GitHub: conectar la cuenta (una sola vez en cada computadora) ----------
const ghStatus = () => api("/github/status").catch(() => ({connected: false}));
const ghRemote = () => alert("GitHub solo se puede usar desde la computadora donde corre LJtex.");
async function ghConnect(then) {
  const st = await ghStatus();
  if (st.reason === "remote") return ghRemote();
  modal(`<h3>Conectar LJtex con GitHub</h3>
    ${st.connected ? `<p>Ahora está conectado como <b>${esc(st.login)}</b>. Para cambiar de cuenta o de clave, pega una clave nueva.</p>` : ""}
    <p>LJtex necesita una <b>clave personal</b> (un «token») de tu cuenta de GitHub. Se hace una sola vez en cada computadora:</p>
    <ol class="ghsteps">
      <li><a href="${esc(st.newTokenUrl || "https://github.com/settings/tokens/new?scopes=repo&description=LJtex")}" target="_blank" rel="noopener">Abre esta página de GitHub</a> (si te lo pide, inicia sesión).</li>
      <li>En <b>Expiration</b> elige <b>No expiration</b>.</li>
      <li>Deja marcada la casilla <b>repo</b> (ya viene marcada), baja hasta el final y pulsa el botón verde <b>Generate token</b>.</li>
      <li>Copia la clave que aparece (empieza con <code>ghp_</code>) y pégala aquí:</li>
    </ol>
    <input id="ght" type="password" class="ghin" placeholder="ghp_…" autocomplete="off" spellcheck="false" aria-label="Clave de GitHub">
    <div id="ghm" class="rfm"></div>
    <p class="rfn">La clave se guarda solo en esta computadora y LJtex la usa únicamente para hablar con GitHub. Trátala como una contraseña: no la compartas con nadie.</p>
    <div class="acts">${st.connected ? '<button id="ghq">Desconectar</button><span class="sp"></span>' : ""}<button id="ghc">Cancelar</button><button id="gho" class="pr">Conectar</button></div>`, (md, close) => {
    const q = s => md.querySelector(s);
    q("#ght").focus();
    q("#ghc").onclick = close;
    if (q("#ghq")) q("#ghq").onclick = async () => {
      if (!confirm("¿Desconectar LJtex de GitHub en esta computadora?\nNo se borra nada: tus proyectos siguen aquí y tus repositorios siguen en GitHub.")) return;
      await api("/github/token", {method: "DELETE"}); close();
    };
    const go = async () => {
      q("#gho").disabled = true; q("#ghm").className = "rfm"; q("#ghm").textContent = "Comprobando la clave con GitHub…";
      const r = await api("/github/token", {method: "POST", body: {token: q("#ght").value}}).catch(() => ({error: "No se pudo contactar con el servidor."}));
      q("#gho").disabled = false;
      if (r.error) { q("#ghm").className = "rfm bad"; q("#ghm").textContent = r.error; return; }
      close(); then?.(r);
    };
    q("#gho").onclick = go; q("#ght").onkeydown = e => { if (e.key === "Enter") go(); };
  });
}
// Abrir en LJtex un proyecto que está en GitHub (el tuyo desde otra Mac, o el de un coautor que te invitó)
async function ghOpen() {
  const st = await ghStatus();
  if (st.reason === "remote") return ghRemote();
  if (!st.connected) return ghConnect(() => ghOpen());
  modal(`<h3>Abrir un proyecto desde GitHub</h3>
    <p class="rfn">Conectado como <b>${esc(st.login)}</b> · <a href="#" id="ghk">cambiar de cuenta</a></p>
    <div id="ghl" class="ghl">Buscando tus repositorios…</div><div id="ghm" class="rfm"></div>
    <div class="acts"><button id="ghc">Cerrar</button></div>`, (md, close) => {
    const q = s => md.querySelector(s);
    q("#ghc").onclick = close;
    q("#ghk").onclick = e => { e.preventDefault(); close(); ghConnect(() => ghOpen()); };
    async function paint() {
      const r = await api("/github/repos").catch(() => ({error: "No se pudo contactar con el servidor."}));
      if (!q("#ghl")) return;
      if (r.error) { q("#ghl").innerHTML = `<p class="rfm bad">${esc(r.error)}</p>`; return; }
      const inv = (r.invitations || []).map(i => `<li><span><b>${esc(i.full || "")}</b><small>Te invitó ${esc(i.from || "")}</small></span><button data-acc="${esc(i.id)}" class="pr">Aceptar invitación</button></li>`).join("");
      const rep = (r.repos || []).map(x => `<li><span><b>${esc(x.full)}</b><small>${x.private ? "Privado" : "Público"}${x.updated ? " · actualizado el " + when(x.updated) : ""}</small></span>${x.project ? `<button data-go="${esc(x.project.id)}" title="Ya lo tienes en LJtex como «${esc(x.project.name)}»">Ya está aquí: abrir</button>` : `<button data-cl="${esc(x.full)}" class="pr">Abrir en LJtex</button>`}</li>`).join("");
      q("#ghl").innerHTML = (inv ? `<h4>Invitaciones pendientes</h4><ul>${inv}</ul>` : "")
        + (rep ? `<h4>Repositorios</h4><ul>${rep}</ul>` : "<p>Todavía no hay repositorios en tu cuenta. Si un coautor te invitó, su invitación aparecerá aquí (puede tardar un minuto).</p>");
    }
    paint();
    q("#ghl").onclick = async e => {
      const a = e.target.closest("[data-acc]"), c = e.target.closest("[data-cl]"), g = e.target.closest("[data-go]");
      if (g) { close(); location.hash = "#/p/" + g.dataset.go; return; }
      if (a) {
        a.disabled = true;
        const r = await api(`/github/invitations/${encodeURIComponent(a.dataset.acc)}/accept`, {method: "POST"}).catch(() => ({error: "No se pudo contactar con el servidor."}));
        if (r.error) { a.disabled = false; q("#ghm").className = "rfm bad"; q("#ghm").textContent = r.error; return; }
        paint();
      }
      if (c) {
        md.querySelectorAll("#ghl button").forEach(b => b.disabled = true);
        q("#ghm").className = "rfm"; q("#ghm").textContent = `Descargando ${c.dataset.cl}…`;
        const r = await api("/github/clone", {method: "POST", body: {repo: c.dataset.cl}}).catch(() => ({error: "No se pudo contactar con el servidor."}));
        if (r.error) { md.querySelectorAll("#ghl button").forEach(b => b.disabled = false); q("#ghm").className = "rfm bad"; q("#ghm").textContent = r.error; return; }
        close(); location.hash = "#/p/" + r.id;
      }
    };
  });
}

// Al abrir un proyecto recién creado se pregunta si se quiere respaldar en GitHub
const OFFER = "ljtexOfrecerGitHub";
const offerGh = id => { try { if (id) sessionStorage.setItem(OFFER, id); } catch {} };
const takeOffer = id => { try { if (sessionStorage.getItem(OFFER) !== id) return false; sessionStorage.removeItem(OFFER); return true; } catch { return false; } };

// ---------- Avisos en la pantalla principal: proyectos que te compartieron por GitHub ----------
const HIDDEN = "ghAvisosOcultos";
async function ghNotices() {
  const box = $("ghav"); if (!box) return;
  const r = await api("/github/shared").catch(() => null);
  if (!$("ghav") || !r?.connected) return;
  const hidden = new Set(lsGet(HIDDEN, []));
  const items = [
    ...(r.invitations || []).map(i => ({key: "inv:" + i.id, inv: i.id, full: i.full, from: i.from, name: i.name})),
    ...(r.unopened || []).map(u => ({key: "repo:" + u.full.toLowerCase(), full: u.full, from: u.from, name: u.name})),
  ].filter(x => x.full && !hidden.has(x.key));
  box.innerHTML = items.map(x => `<div class="ghav" data-k="${esc(x.key)}">${ico("sync")}
    <span><b>${esc(x.from || "Alguien")}</b> te compartió ${x.name ? `el proyecto <b>«${esc(x.name)}»</b>` : `el repositorio <b>${esc(x.full)}</b>`} por GitHub${x.inv ? "" : " · ya aceptaste la invitación, pero aún no lo abres aquí"}.<small class="ghavm"></small></span>
    <button class="pr" data-op="${esc(x.full)}"${x.inv ? ` data-inv="${esc(x.inv)}"` : ""}>${x.inv ? "Aceptar y abrir" : "Abrir en LJtex"}</button>
    <button class="ghavx" data-hide title="Ocultar este aviso (lo sigues encontrando en «Abrir desde GitHub»)" aria-label="Ocultar aviso">×</button></div>`).join("");
}
function ghNoticeClicks() {
  $("ghav").onclick = async e => {
    const row = e.target.closest(".ghav"); if (!row) return;
    if (e.target.closest("[data-hide]")) { lsSet(HIDDEN, [...new Set([...lsGet(HIDDEN, []), row.dataset.k])].slice(-200)); row.remove(); return; }
    const b = e.target.closest("[data-op]"); if (!b) return;
    const msg = row.querySelector(".ghavm"), btns = row.querySelectorAll("button");
    const bad = t => { btns.forEach(x => x.disabled = false); msg.classList.add("bad"); msg.textContent = t; };
    btns.forEach(x => x.disabled = true); msg.classList.remove("bad");
    if (b.dataset.inv) {
      msg.textContent = "Aceptando la invitación…";
      const a = await api(`/github/invitations/${encodeURIComponent(b.dataset.inv)}/accept`, {method: "POST"}).catch(() => ({error: "No se pudo contactar con el servidor."}));
      if (a.error) return bad(a.error);
    }
    msg.textContent = `Descargando ${b.dataset.op}…`;
    const r = await api("/github/clone", {method: "POST", body: {repo: b.dataset.op}}).catch(() => ({error: "No se pudo contactar con el servidor."}));
    if (r.error) return bad(r.error);
    location.hash = "#/p/" + r.id;
  };
}

// ---------- Actualizaciones de la app de escritorio ----------
// Los .dmg los publica GitHub (acción «Construir LJtex») en cada cambio; aquí se buscan, se descargan y se instalan.
const UPD = window.ljtexUpdate || null;
const fechaVer = t => new Date(t * 1000).toLocaleString("es", {day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"});
function updInstall(st) {
  modal(`<h3>Hay una versión nueva de LJtex</h3>
    <p>Tu versión: <b>${st.current ? esc(fechaVer(st.current.time)) : "sin fecha"}</b> · nueva: <b>${esc(fechaVer(st.latest.time))}</b></p>
    ${st.latest.notes ? `<h4>Qué cambió</h4><pre class="updn">${esc(st.latest.notes)}</pre>` : ""}
    <p class="rfn">LJtex descarga la versión nueva, se cierra y se vuelve a abrir solo. Tus proyectos no se tocan: viven fuera de la app.</p>
    <div id="upm" class="rfm"></div><div class="updbar" hidden><i></i></div>
    <div class="acts"><button id="upc">Ahora no</button><button id="upo" class="pr">Actualizar y reiniciar</button></div>`, (md, close) => {
    const q = s => md.querySelector(s);
    q("#upc").onclick = close; q("#upo").focus();
    q("#upo").onclick = async () => {
      q("#upo").disabled = q("#upc").disabled = true;
      const bar = q(".updbar"); bar.hidden = false;
      const off = UPD.onProgress((phase, f) => {
        if (!q("#upm")) return;
        q("#upm").textContent = phase === "Descargando" ? `Descargando… ${Math.round(f * 100)} %` : "Preparando la versión nueva…";
        bar.firstChild.style.width = Math.round(f * 100) + "%";
      });
      q("#upm").className = "rfm"; q("#upm").textContent = "Conectando con GitHub…";
      const r = await UPD.install().catch(e => ({error: String(e?.message || e)}));
      off();
      if (!q("#upm")) return;
      if (r.restarting) { q("#upm").textContent = "Listo: LJtex se cierra y se abre con la versión nueva…"; return; }
      q("#upo").disabled = q("#upc").disabled = false; bar.hidden = true;
      if (r.cancelled) { q("#upm").textContent = "No se cerró LJtex. Puedes actualizar cuando quieras."; return; }
      if (r.manual) { q("#upm").textContent = "Se abrió el instalador: arrastra LJtex a la carpeta Aplicaciones para reemplazar la versión anterior."; return; }
      q("#upm").className = "rfm bad"; q("#upm").textContent = r.error || "No se pudo actualizar.";
    };
  });
}
// manual = el usuario lo pidió (botón o menú): siempre responde algo. Automático: solo avisa si hay versión nueva.
window.ljtexCheckUpdates = async manual => {
  if (!UPD) { if (manual) alert("Las actualizaciones automáticas solo funcionan en la app de escritorio de LJtex."); return; }
  const st = await UPD.check().catch(e => ({error: String(e?.message || e)}));
  if (!manual) {
    try { localStorage.setItem("ultimaBusquedaAct", String(Date.now())); } catch {}
    if (st.available && st.packaged) updBanner(st);
    return;
  }
  if (st.error) {
    return modal(`<h3>Buscar actualizaciones</h3><p class="rfm bad">${esc(st.error)}</p>
      <div class="acts">${st.needToken ? '<button id="upg">Conectar con GitHub</button><span class="sp"></span>' : ""}<button id="upc" class="pr">Cerrar</button></div>`, (md, close) => {
      md.querySelector("#upc").onclick = close;
      if (md.querySelector("#upg")) md.querySelector("#upg").onclick = () => { close(); ghConnect(() => window.ljtexCheckUpdates(true)); };
    });
  }
  if (!st.packaged) return alert("Esta copia de LJtex se abrió desde la terminal, no es la app instalada. Ahí se actualiza con git (bajar-de-github.sh).");
  if (st.available) return updInstall(st);
  modal(`<h3>Ya tienes la versión más reciente</h3>
    <p>${st.current ? `Tu LJtex es la versión del <b>${esc(fechaVer(st.current.time))}</b>.` : "No se sabe de qué fecha es tu LJtex."}${!st.latest ? " Todavía no hay versiones publicadas en GitHub." : ""}</p>
    <div class="acts"><button id="upc" class="pr">Cerrar</button></div>`, (md, close) => { md.querySelector("#upc").onclick = close; md.querySelector("#upc").focus(); });
};
function updBanner(st) {
  const box = $("upd"); if (!box) return;
  if (lsGet("actualizacionOculta", "") === st.latest.tag) return;
  box.innerHTML = `<div class="ghav">${ico("download")}<span><b>Hay una versión nueva de LJtex</b> (del ${esc(fechaVer(st.latest.time))}).</span>
    <button class="pr" id="upgo">Ver y actualizar</button><button class="ghavx" id="upx" title="Ocultar este aviso hasta la siguiente versión" aria-label="Ocultar aviso">×</button></div>`;
  $("upgo").onclick = () => updInstall(st);
  $("upx").onclick = () => { lsSet("actualizacionOculta", st.latest.tag); box.innerHTML = ""; };
}

// ---------- .zip: descargar / importar ----------
const slug = n => String(n || "proyecto").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "proyecto";
function saveBlob(blob, fileName) {
  const u = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = u; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
async function exportZip(id, pname) {
  try {
    const r = await fetch(`/api/projects/${id}/export`, {headers: H});
    if (!r.ok) throw new Error();
    saveBlob(await r.blob(), slug(pname) + ".zip");
  } catch { alert("No se pudo descargar el proyecto."); }
}
async function importZip(file) {
  if (!file) return;
  if (!/\.zip$/i.test(file.name)) return alert("Elige un archivo .zip (en Overleaf: Menú → Descargar → Fuente).");
  if (file.size > 150e6) return alert("El .zip pesa más de 150 MB, es demasiado grande para importarlo.");
  const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = `Importando «${file.name}»…`; document.body.appendChild(toast);
  let j;
  try {
    const r = await fetch("/api/projects/import", {method: "POST", body: file, headers: {"x-token": pass, "x-user": encodeURIComponent(name), "x-name": encodeURIComponent(file.name), "Content-Type": "application/zip"}});
    j = await r.json().catch(() => ({error: "Respuesta inesperada del servidor."}));
  } catch { j = {error: "No se pudo contactar con el servidor."}; }
  toast.remove();
  if (j.error) return alert(j.error);
  offerGh(j.id);
  const extra = (j.skipped?.length || j.renamed?.length || j.notes?.length);
  if (!extra) { location.hash = "#/p/" + j.id; return; }
  modal(`<h3>Proyecto importado: «${esc(j.name)}»</h3><p>${j.files} ${j.files === 1 ? "archivo" : "archivos"} (${j.text} de texto editable).</p>
    ${j.notes?.length ? `<h4>Avisos</h4><ul>${j.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${j.renamed?.length ? `<h4>Nombres cambiados</h4><ul>${j.renamed.map(x => `<li>${esc(x[0])} → ${esc(x[1])}</li>`).join("")}</ul><small>Si tu .tex usa el nombre anterior en \\includegraphics o \\input, actualízalo.</small>` : ""}
    ${j.skippedCount ? `<h4>No se importaron (${j.skippedCount})</h4><ul>${j.skipped.map(x => `<li>${esc(x[0])}: ${esc(x[1])}</li>`).join("")}</ul>` : ""}
    <div class="acts"><button id="io" class="pr">Abrir proyecto</button></div>`, (md, close) => {
    md.querySelector("#io").onclick = () => { close(); location.hash = "#/p/" + j.id; };
    md.querySelector("#io").focus();
  });
}

async function home() {
  const ver = UPD?.info();
  const ghMark = '<svg class="ic" width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
  $("app").innerHTML = `<div class="home">
    <header class="hhead">
      <div class="brand">${logoSvg(64)}<div><div class="wm">LJ<i>tex</i></div><small>Tu editor de LaTeX, en tu propia computadora</small></div></div>
      <div class="hutil">${UPD ? `<button class="gh" id="upb" title="Buscar una versión nueva de LJtex en GitHub">${ico("sync", 14)}<span>Buscar actualizaciones</span></button>` : ""}<button class="dk gh" id="dkh"></button></div>
    </header>
    <div id="upd"></div><div id="ghav"></div>
    <div class="hrow"><h1>Mis proyectos<span class="hcount" id="hcount"></span></h1>
      <div class="hact">
        <button id="ip" title="Importar un proyecto en .zip (por ejemplo, descargado de Overleaf)">${ico("upload", 15)}Importar .zip</button>
        <button id="gop" title="Abrir un proyecto guardado en GitHub (tuyo o de un coautor que te invitó)">${ghMark}Abrir desde GitHub</button>
        <button id="np" class="pr">${ico("plus", 15)}Nuevo proyecto</button>
      </div></div><input id="if" type="file" accept=".zip,application/zip" hidden>
    <div class="hb"><label class="hsearch">${ico("search", 15)}<input id="hq" type="search" placeholder="Buscar por nombre o etiqueta…" aria-label="Buscar proyectos"></label><label class="hgrp"><input type="checkbox" id="hg"> Agrupar por etiqueta</label></div>
    <div id="tf" class="tf"></div><div id="pl"></div>
    ${ver?.time ? `<footer class="hfoot">LJtex · versión del ${esc(fechaVer(ver.time))}</footer>` : ""}</div>`;
  $("np").onclick = async () => {
    const ts = await api("/templates");
    if (!Array.isArray(ts) || !ts.length) { const n = prompt("Nombre del proyecto"); if (n === null) return; const np = await api("/projects", {method: "POST", body: {name: n}}); offerGh(np.id); location.hash = "#/p/" + np.id; return; }
    modal(`<h3>Nuevo proyecto</h3><label>Nombre<br><input id="pn" class="pnin" placeholder="Sin título" maxlength="80"></label>
      <h4>Plantilla</h4><div class="tpls">${ts.map((t, i) => `<label class="tp"><input type="radio" name="tp" value="${esc(t.id)}"${i ? "" : " checked"}><span><b>${esc(t.name)}</b><small>${t.files.length} ${t.files.length === 1 ? "archivo" : "archivos"}</small></span></label>`).join("")}</div>
      <div class="acts"><button id="pc">Cancelar</button><button id="pk" class="pr">Crear</button></div>`, (md, close) => {
      const go = async () => {
        const tp = md.querySelector("input[name=tp]:checked")?.value, n = md.querySelector("#pn").value.trim() || "Sin título";
        close(); const np = await api("/projects", {method: "POST", body: {name: n, template: tp}}); offerGh(np.id); location.hash = "#/p/" + np.id;
      };
      md.querySelector("#pc").onclick = close; md.querySelector("#pk").onclick = go;
      md.querySelector("#pn").onkeydown = e => { if (e.key === "Enter") go(); };
      md.querySelector("#pn").focus();
    });
  };
  $("ip").onclick = () => $("if").click();
  $("gop").onclick = ghOpen;
  ghNoticeClicks(); ghNotices();
  if ($("upb")) $("upb").onclick = () => window.ljtexCheckUpdates(true);
  // Busca actualizaciones solo, como mucho una vez cada 6 horas
  if (UPD && Date.now() - (+(() => { try { return localStorage.getItem("ultimaBusquedaAct"); } catch { return 0; } })() || 0) > 6 * 36e5) window.ljtexCheckUpdates(false);
  { const iv = setInterval(ghNotices, 120000), prev = cleanup; cleanup = () => { prev(); clearInterval(iv); }; }
  $("dkh").onclick = toggleTheme; applyTheme();
  $("if").onchange = e => { const f = e.target.files[0]; e.target.value = ""; importZip(f); };
  // Arrastrar un .zip a la página
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
  const dOver = e => { if (hasFiles(e)) { e.preventDefault(); document.body.classList.add("dropzip"); } };
  const dLeave = e => { if (!e.relatedTarget) document.body.classList.remove("dropzip"); };
  const dDrop = e => { if (!hasFiles(e)) return; e.preventDefault(); document.body.classList.remove("dropzip"); importZip(e.dataTransfer.files[0]); };
  addEventListener("dragover", dOver); addEventListener("dragleave", dLeave); addEventListener("drop", dDrop);
  { const prev = cleanup; cleanup = () => { prev(); removeEventListener("dragover", dOver); removeEventListener("dragleave", dLeave); removeEventListener("drop", dDrop); document.body.classList.remove("dropzip"); }; }
  let ps = await api("/projects");
  if (!Array.isArray(ps)) { $("pl").innerHTML = "<small>No se pudo cargar la lista. Revisa que la clave sea la del servidor (borra los datos del sitio para volver a escribirla).</small>"; return; }
  let thumbs = {}; api("/thumbs").then(t => { if (t && !Array.isArray(t)) { thumbs = t; draw(); } });
  let tag = lsGet("filtroEtiqueta", ""), grouped = !!lsGet("agruparEtiquetas", false), q = "";
  $("hg").checked = grouped;
  const alive = () => !!$("pl");
  const allTags = () => { const m = new Map(); for (const p of ps) for (const t of p.tags || []) m.set(norm(t), {t, n: (m.get(norm(t))?.n || 0) + 1}); return [...m.values()].sort((a, b) => a.t.localeCompare(b.t, "es")); };
  const hueOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const card = p => `<a class="card" href="#/p/${p.id}" data-id="${p.id}" title="${esc(p.name)}" style="--h:${hueOf(p.id)}">${thumbs[p.id] ? `<div class="cth"><img src="${thumbs[p.id]}" alt=""></div>` : ""}<b>${esc(p.name)}</b><small>Modificado el ${when(p.modified || p.t)}</small>
    <div class="ctg">${(p.tags || []).map(t => tagChip(t, `data-tag="${esc(t)}" title="Mostrar solo «${esc(t)}»"`)).join("")}</div>
    <button class="mb" data-m="${p.id}" title="Más acciones" aria-label="Más acciones">⋯</button></a>`;
  function draw() {
    if (!alive()) return;
    const tags = allTags();
    if (tag && tag !== NONE && !tags.some(t => norm(t.t) === norm(tag))) tag = "";          // la etiqueta ya no existe
    const noTag = ps.filter(p => !(p.tags || []).length).length;
    if ($("hcount")) $("hcount").textContent = ps.length || "";
    $("tf").innerHTML = tags.length ? `<button class="tf1${tag === "" ? " on" : ""}" data-f="">Todos <small>${ps.length}</small></button>`
      + tags.map(t => `<button class="tf1${norm(tag) === norm(t.t) ? " on" : ""}" style="--h:${tagColor(t.t)}" data-f="${esc(t.t)}">${esc(t.t)} <small>${t.n}</small></button>`).join("")
      + (noTag && noTag < ps.length ? `<button class="tf1${tag === NONE ? " on" : ""}" data-f="${NONE}">Sin etiqueta <small>${noTag}</small></button>` : "") : "";
    const nq = norm(q.trim());
    let list = ps.filter(p => (!nq || norm(p.name).includes(nq) || (p.tags || []).some(t => norm(t).includes(nq)))
      && (!tag || (tag === NONE ? !(p.tags || []).length : (p.tags || []).some(t => norm(t) === norm(tag)))));
    list.sort((a, b) => (b.modified || b.t) - (a.modified || a.t));
    if (!ps.length) return void ($("pl").innerHTML = `<div class="empty">${logoSvg(120)}<p><b>Aún no tienes proyectos</b></p><p>Crea uno nuevo o importa el .zip de un proyecto de Overleaf (también puedes arrastrarlo aquí).</p></div>`);
    if (!list.length) return void ($("pl").innerHTML = '<small>Ningún proyecto coincide con la búsqueda o el filtro.</small>');
    if (!grouped) return void ($("pl").innerHTML = `<div class="grid">${list.map(card).join("")}</div>`);
    const groups = new Map();                                                                // un proyecto con varias etiquetas aparece en cada grupo
    for (const p of list) for (const t of (p.tags || []).length ? p.tags : [NONE]) { const k = norm(t); if (!groups.has(k)) groups.set(k, {t, items: []}); groups.get(k).items.push(p); }
    const order = [...groups.values()].sort((a, b) => (a.t === NONE) - (b.t === NONE) || (a.t === NONE ? 0 : a.t.localeCompare(b.t, "es")));
    $("pl").innerHTML = order.map(g => `<section class="grp"><h2>${g.t === NONE ? "Sin etiqueta" : tagChip(g.t)} <small>${g.items.length}</small></h2><div class="grid">${g.items.map(card).join("")}</div></section>`).join("");
  }
  async function reload() { const n = await api("/projects"); if (Array.isArray(n)) ps = n; draw(); }
  draw();

  $("hq").oninput = e => { q = e.target.value; draw(); };
  $("hg").onchange = e => { grouped = e.target.checked; lsSet("agruparEtiquetas", grouped); draw(); };
  $("tf").onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; tag = b.dataset.f; lsSet("filtroEtiqueta", tag); draw(); };

  // Menú de acciones de cada proyecto
  const closePop = () => document.querySelectorAll(".pop").forEach(x => x.remove());
  function menu(btn, p) {
    closePop();
    const pop = document.createElement("div"); pop.className = "pop";
    pop.innerHTML = `<button data-a="open">Abrir</button><button data-a="dup">Duplicar…</button><button data-a="ren">Cambiar nombre…</button><button data-a="tag">Etiquetas…</button><button data-a="exp">Exportar .zip</button><button data-a="del" class="dn">Eliminar…</button>`;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 4, innerHeight - pop.offsetHeight - 8) + "px";
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + "px";
    pop.onclick = async e => {
      const a = e.target.dataset.a; if (!a) return; closePop();
      if (a === "open") location.hash = "#/p/" + p.id;
      if (a === "dup") {
        const n = prompt("Nombre de la copia (se copian los archivos; el historial empieza de cero)", `${p.name} (copia)`); if (n === null) return;
        const r = await api(`/projects/${p.id}/duplicate`, {method: "POST", body: {name: n}});
        if (r.error) return alert(r.error);
        await reload(); document.querySelector(`.card[data-id="${r.id}"]`)?.scrollIntoView({block: "nearest"});
      }
      if (a === "ren") {
        const n = prompt("Nuevo nombre del proyecto", p.name); if (n === null || !n.trim() || n.trim() === p.name) return;
        const r = await api(`/projects/${p.id}`, {method: "PATCH", body: {name: n}}); if (r.error) return alert(r.error); reload();
      }
      if (a === "tag") editTags(p);
      if (a === "exp") exportZip(p.id, p.name);
      if (a === "del") {
        if (!confirm(`¿Eliminar «${p.name}» con todos sus archivos e historial?\nEsta acción no se puede deshacer. Si solo quieres otra versión, usa «Duplicar».`)) return;
        await api("/projects/" + p.id, {method: "DELETE"}); reload();
      }
    };
  }
  function editTags(p) {
    let cur = [...(p.tags || [])];
    modal(`<h3>Etiquetas de «${esc(p.name)}»</h3><div id="tgs" class="tgs"></div>
      <input id="ti" placeholder="Escribe una etiqueta y pulsa Enter" maxlength="30" aria-label="Nueva etiqueta" autocomplete="off">
      <div id="tsg" class="tsg"></div>
      <div class="acts"><button id="tc">Cancelar</button><button id="ts" class="pr">Guardar</button></div>`, (md, close) => {
      const add = t => { t = t.replace(/[\s,]+/g, " ").trim().slice(0, 30); if (t && cur.length < 12 && !cur.some(x => norm(x) === norm(t))) cur.push(t); paint(); };
      const paint = () => {
        md.querySelector("#tgs").innerHTML = cur.length ? cur.map((t, i) => `<span class="tg" style="--h:${tagColor(t)}">${esc(t)}<button data-x="${i}" aria-label="Quitar ${esc(t)}">×</button></span>`).join("") : '<small>Sin etiquetas todavía.</small>';
        const rest = allTags().filter(t => !cur.some(x => norm(x) === norm(t.t)));
        md.querySelector("#tsg").innerHTML = rest.length ? `<small>Usar una existente:</small> ${rest.map(t => `<button class="tg add" style="--h:${tagColor(t.t)}" data-add="${esc(t.t)}">＋ ${esc(t.t)}</button>`).join("")}` : "";
      };
      paint(); const ti = md.querySelector("#ti"); ti.focus();
      ti.onkeydown = e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(ti.value); ti.value = ""; } else if (e.key === "Backspace" && !ti.value) { cur.pop(); paint(); } };
      md.onclick = e => {
        if (e.target === md) return close();
        const x = e.target.closest("[data-x]"); if (x) { cur.splice(+x.dataset.x, 1); paint(); }
        const a = e.target.closest("[data-add]"); if (a) add(a.dataset.add);
      };
      md.querySelector("#tc").onclick = close;
      md.querySelector("#ts").onclick = async () => {
        if (ti.value.trim()) add(ti.value);
        const r = await api(`/projects/${p.id}`, {method: "PATCH", body: {tags: cur}});
        if (r.error) return alert(r.error); close(); reload();
      };
    });
  }
  $("pl").onclick = e => {
    const m = e.target.closest("[data-m]");
    if (m) { e.preventDefault(); e.stopPropagation(); menu(m, ps.find(p => p.id === m.dataset.m)); return; }
    const t = e.target.closest("[data-tag]");
    if (t) { e.preventDefault(); tag = t.dataset.tag; lsSet("filtroEtiqueta", tag); draw(); scrollTo(0, 0); }
  };
  document.addEventListener("click", function off(e) {
    if (!alive()) return document.removeEventListener("click", off);
    if (!e.target.closest?.(".pop,[data-m]")) closePop();
  });
}

// ---------- Proyecto: árbol, editor, PDF e historial ----------
async function project(id) {
  const info = (await api("/projects")).find?.(p => p.id === id);
  if (!info) { location.hash = ""; return; }
  $("app").innerHTML = `<div class="proj" id="proj">
    <div class="top"><a href="#" class="tl" title="Volver a tus proyectos">${logoSvg(30)}</a><a href="#"><button class="gh">${ico("back")} Proyectos</button></a><b title="${esc(info.name)}">${esc(info.name)}</b><small>${esc(name)}</small><span class="vt" role="group" aria-label="Paneles visibles"><button id="vtr" title="Mostrar u ocultar el árbol de archivos">Archivos</button><button id="ved" title="Mostrar u ocultar el código">Código</button><button id="vpdf" title="Mostrar u ocultar el PDF">PDF</button></span><span class="sp"></span><button id="ghb" class="gh">${ico("sync")} <span>GitHub</span><i class="ghdot" hidden></i></button><button id="hb" class="gh">${ico("history")} Historial</button><button id="ab" class="gh">${ico("sparkles")} Asistente</button><button class="dk gh" id="dkp"></button><span class="mnw"><button id="mn" class="gh" title="Más opciones" aria-haspopup="true">${ico("more", 18)}</button><div class="mnp" id="mnp" hidden><button id="sp" title="Corrector ortográfico">Ortografía</button><button id="save">Guardar versión con nombre</button><button id="zp" title="Descargar todo el proyecto como .zip (para Overleaf, una revista o un coautor)">Descargar el proyecto (.zip)</button><button id="ghp" title="Repositorio, coautores y cuenta de GitHub">GitHub…</button><button id="snp" title="Abreviaturas que se expanden con Tab">Snippets…</button><button id="kb">Atajos de teclado</button></div></span></div>
    <nav id="tr"><div class="tabs"><button data-v="f" class="on">Archivos</button><button data-v="o">Esquema</button><button data-v="c" id="cmtab">Comentarios</button></div><div class="bar"><button id="nf">${ico("plus")} Nuevo</button><button id="up">${ico("upload")} Subir</button><input type="file" id="fi" hidden></div><div class="bar"><button id="nd" style="flex:1" title="Crear una carpeta nueva">${ico("folder")} Carpeta</button><button id="ud" style="flex:1" title="Subir una carpeta entera con sus subcarpetas">${ico("upload")} Subir carpeta</button><input type="file" id="fd" hidden webkitdirectory multiple></div><div class="bar"><button id="xr" style="flex:1" title="Referencias sin definir, citas que faltan y archivos que no existen">${ico("link")} Referencias</button><button id="fm" style="flex:1" title="Convertir una imagen de una fórmula en LaTeX (⌘⌥V)">${ico("sigma")} Fórmula</button></div><div class="bar"><button id="rf" style="flex:1" title="Agregar una referencia a tu .bib a partir de un DOI o de un identificador de arXiv">${ico("plus")} Referencia</button><button id="zt" title="Sincronizar con Zotero: traer tu bibliografía desde Zotero de escritorio" aria-label="Sincronizar con Zotero">Z</button><button id="sa" title="Buscar y reemplazar en todo el proyecto (⌘⇧F)" aria-label="Buscar en el proyecto">${ico("search")}</button></div><ul id="tl"></ul><div id="olb" hidden><label><input type="checkbox" id="olst"> Mostrar teoremas, lemas, definiciones…</label></div><ul id="ol" hidden></ul><div id="cmp" hidden><div class="cmh"><button id="cmadd" class="pr" title="Comenta el texto seleccionado en el editor">＋ Comentar selección</button><label><input type="checkbox" id="cmres"> Ver resueltos</label></div><div id="cmnew" hidden></div><ul id="cml"></ul></div></nav>
    <div class="gut" id="g1" role="separator" aria-orientation="vertical" aria-label="Ajustar el ancho del árbol de archivos" tabindex="0" title="Arrastra para cambiar el tamaño · doble clic para restablecer"></div>
    <div id="ed"></div>
    <div class="gut" id="g2" role="separator" aria-orientation="vertical" aria-label="Ajustar el reparto entre código y PDF" tabindex="0" title="Arrastra para cambiar el tamaño · doble clic para restablecer"></div>
    <div id="pdf"><div class="bar"><button id="co"><span class="spin" hidden></span><span class="cl">Compilar</span></button><button id="mf" class="gh" title="Archivo que se compila">Principal</button><button id="qk" class="gh" title="Vista rápida: compila solo el capítulo abierto (con \\include usa \\includeonly y conserva numeración)">${ico("zap")} Rápida</button><label><input type="checkbox" id="auto"> Al escribir</label><span class="sp"></span><button id="sq" class="gh" title="Buscar texto en el PDF (clic en el PDF y ⌘F)" aria-label="Buscar en el PDF">${ico("search")}</button><button id="fw" class="gh" title="Mostrar en el PDF la línea donde está el cursor" disabled>${ico("target")} Código → PDF</button><span class="pdfzoom"><button id="zo" class="gh" aria-label="Alejar" title="Alejar (Ctrl/⌘ + rueda)">${ico("minus")}</button><button id="zi" class="gh" aria-label="Acercar" title="Acercar (Ctrl/⌘ + rueda)">${ico("plus")}</button></span><button id="dpdf" class="gh" disabled title="Descargar el PDF compilado" aria-label="Descargar el PDF">${ico("download", 16)}</button></div>
      <div id="pv" tabindex="0" aria-label="Vista previa del PDF (doble clic para ir al código)"></div><div id="lg"></div></div>
    <div id="hv">
      <section id="hmain"><div id="hhead"></div><div id="hbar"></div><div id="dh"></div><div id="df"></div></section>
      <aside id="hside">
        <div id="hfil"><select id="hf" aria-label="Filtrar por archivo"></select><select id="ha" aria-label="Filtrar por autor"></select>
          <label><input type="checkbox" id="hauto" checked> Incluir guardados automáticos</label></div>
        <ul id="hl"></ul>
      </aside>
    </div>
    <div class="gut" id="g3" role="separator" aria-orientation="vertical" aria-label="Ajustar el ancho del asistente" tabindex="0" title="Arrastra para cambiar el tamaño · doble clic para restablecer"></div>
    <aside id="ag"><div class="agh"><b id="agt">✦ Asistente</b><small id="agv"></small><span class="sp"></span><button id="agnw" title="Empezar una conversación nueva">＋ Nueva</button><button id="agls" title="Ver conversaciones anteriores">Conversaciones</button><button id="agx" aria-label="Cerrar el asistente">×</button></div>
      <div id="agn"></div><div id="agl"></div><div id="agsb" hidden></div>
      <div class="agf"><div id="agc"></div><div id="aga"></div><label id="agsl" hidden><input type="checkbox" id="agsel" checked> <span id="agst"></span></label>
        <textarea id="agi" rows="3" placeholder="Pídele algo al asistente… (Enter envía, Shift+Enter hace un salto de línea)"></textarea>
        <div class="agb"><select id="agm" title="Modelo de Claude que usará el asistente"><option value="">Modelo: predeterminado</option><option value="haiku">Haiku (rápido, gasta menos)</option><option value="sonnet">Sonnet (equilibrado)</option><option value="opus">Opus (el más capaz, gasta más)</option></select><button id="agp" class="gh" title="Adjuntar imágenes, PDF o archivos de texto (también puedes pegarlos o soltarlos aquí)" aria-label="Adjuntar archivos">${ico("upload", 15)}</button><input type="file" id="agfi" hidden multiple accept="image/*,.pdf,.txt,.tex,.bib,.csv,.md"><span class="sp"></span><button id="ags" class="pr">Enviar</button></div></div>
    </aside>
    <footer class="sbar" id="sb"><small id="cs"></small><span class="sp"></span><span id="pos" class="si" title="Línea y columna del cursor"></span><select id="eng" class="si" title="Motor de compilación"><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></select><button id="wc" class="wc si" title="Conteo de palabras del proyecto"></button><span id="pgs" class="si"></span></footer></div>`;
  let pdfBytes = null, syncOk = false;
  const viewer = createViewer($("pv"), {onPoint: p => viewer.onPoint?.(p), onSearch: r => paintSearch?.(r)});
  let paintSearch = null;
  viewer.hint = () => {};
  let mainFile = info.main || "main.tex";
  let files = [], cur = null, ydoc, prov, view, merge, compiling = false, again = false, t, dragged = null;
  let histMode = false, hist = [], hsig = "", hsel = null, hdata = null, cmp = "prev", hfile = "", hauthor = "";
  const iv = setInterval(() => histMode && loadHistory(), 10000);
  // El árbol se sincroniza solo: ves los archivos que crean, mueven o borran tus coautores
  const poll = setInterval(async () => {
    if (!$("tl") || dragged !== null) return;
    const nf = await api(`/projects/${id}/files`);
    const nm = (await api("/projects")).find?.(p => p.id === id)?.main;
    if (nm && nm !== mainFile && $("tl")) { mainFile = nm; paintMain(); drawTree(); }          // un coautor cambió el archivo principal
    if (!Array.isArray(nf) || !$("tl") || JSON.stringify(nf) === JSON.stringify(allFiles)) return;
    allFiles = nf; files = nf.filter(f => f.path.split("/").at(-1) !== ".keep"); drawTree();
    if (cur && !files.some(f => f.path === cur)) {
      $("cs").textContent = "El archivo que tenías abierto se movió o se eliminó.";
      open(firstFile());
    }
  }, 5000);
  cleanup = () => { saveView(); clearInterval(posIv); window.removeEventListener("pagehide", saveView); viewer.destroy(); clearInterval(iv); clearInterval(poll); clearTimeout(t); view?.destroy(); prov?.destroy(); ydoc?.destroy(); merge?.destroy(); document.querySelectorAll(".modal").forEach(m => m.remove()); };
  const firstFile = () => (files.find(f => f.path === mainFile) || files.find(f => f.kind === "text"))?.path;
  const inFilter = p => !!hfile && (p === hfile || (hfile.endsWith("/") && p.startsWith(hfile)));

  let allFiles = [];   // incluye los «.keep» que mantienen vivas las carpetas vacías
  async function load() {
    const nf = await api(`/projects/${id}/files`);
    if (Array.isArray(nf)) { allFiles = nf; files = nf.filter(f => f.path.split("/").at(-1) !== ".keep"); }
    const nm = (await api("/projects")).find?.(p => p.id === id)?.main; if (nm) { mainFile = nm; paintMain(); }
    drawTree();
  }

  // ---------- Archivo principal (el que se compila) ----------
  function paintMain() {
    const b = $("mf"); if (!b) return;
    b.innerHTML = `${ico("star", 13)} ${esc(mainFile.split("/").at(-1))}`; b.title = `Archivo que se compila: ${mainFile}. Clic para cambiarlo.`;
  }
  async function setMain(path) {
    if (path === mainFile) return;
    const r = await api(`/projects/${id}`, {method: "PATCH", body: {main: path}});
    if (r.error) return alert(r.error);
    mainFile = r.main; paintMain(); drawTree();
    $("fw").disabled = true; compile();
  }
  const isDocRoot = f => f.kind === "text" && /\.(tex|ltx|latex)$/i.test(f.path);
  $("mf").onclick = async () => {
    const cands = files.filter(isDocRoot);
    if (!cands.length) return alert("No hay ningún archivo .tex en este proyecto.");
    // Cuáles contienen \documentclass (los que de verdad se pueden compilar solos)
    const full = new Set();
    await Promise.all(cands.map(async f => { try { const t = (await api(`/files/text?project=${id}&path=${encodeURIComponent(f.path)}`)).text || ""; if (/^[^%\n]*\\documentclass/m.test(t.replace(/%.*$/gm, ""))) full.add(f.path); } catch {} }));
    const sorted = [...cands].sort((a, b) => (full.has(b.path) - full.has(a.path)) || a.path.localeCompare(b.path));
    modal(`<h3>Archivo principal</h3><p>Es el archivo que se compila para generar el PDF: el que tiene <code>\\documentclass</code> y el que carga a los demás con <code>\\input</code> o <code>\\include</code>.</p>
      <select id="mfs" class="mfs" size="${Math.min(10, sorted.length + 1)}" aria-label="Archivo principal">${sorted.map(f => `<option value="${esc(f.path)}"${f.path === mainFile ? " selected" : ""}>${esc(f.path)}${full.has(f.path) ? "  · documento completo" : ""}</option>`).join("")}</select>
      <div class="acts"><button id="mfc">Cancelar</button><button id="mfo" class="pr">Usar este archivo</button></div>`, (md, close) => {
      const sel = md.querySelector("#mfs"); sel.focus();
      md.querySelector("#mfc").onclick = close;
      const ok = () => { const v = sel.value; close(); if (v) setMain(v); };
      md.querySelector("#mfo").onclick = ok; sel.ondblclick = ok;
    });
  };

  // ---------- Agregar referencia desde un DOI o arXiv ----------
  // ---------- Zotero (solo lectura: de Zotero al proyecto) ----------
  const zotKey = "zot:" + id;
  async function zotSync(cfg, quiet) {
    const r = await api("/zotero/sync", {method: "POST", body: {project: id, collection: cfg.collection || "", file: cfg.file || "zotero.bib"}}).catch(() => ({error: "No se pudo contactar con el servidor."}));
    if (!r.error) await load();
    return r;
  }
  $("zt").onclick = () => {
    const cfg = {file: "zotero.bib", collection: "", auto: false, ...lsGet(zotKey, {})};
    modal(`<h3>Sincronizar con Zotero</h3>
      <div id="zst" class="rfm">Buscando Zotero…</div>
      <div id="zbd" hidden>
        <label class="rfl">Qué traer: <select id="zco"></select></label>
        <label class="rfl">Guardar en: <input id="zfi" value="${esc(cfg.file)}" spellcheck="false" style="width:11em"></label>
        <label class="rfl"><input type="checkbox" id="zau"${cfg.auto ? " checked" : ""}> Sincronizar al abrir este proyecto (si Zotero está abierto)</label>
      </div>
      <div id="zrs" class="rfm"></div>
      <p class="rfn">Todo ocurre en tu computadora: LJtex lee tu biblioteca desde Zotero de escritorio (que debe estar abierto). Es de un solo sentido: el archivo se sobrescribe cada vez, así que tus referencias propias guárdalas en otro .bib. Con el plugin Better BibTeX las claves de cita son estables.</p>
      <div class="acts"><button id="zc">Cerrar</button><button id="zgo" class="pr" hidden>Sincronizar ahora</button></div>`, async (md, close) => {
      const q = sel => md.querySelector(sel);
      q("#zc").onclick = close;
      const st = await api("/zotero/status").catch(() => ({ok: false, reason: "error"}));
      const why = {closed: "No encuentro Zotero. Ábrelo (la aplicación de escritorio) y vuelve a pulsar el botón.",
        disabled: "Zotero está abierto, pero tiene desactivado el acceso local. En Zotero: Ajustes › Avanzado › «Permitir que otras aplicaciones de esta computadora se comuniquen con Zotero». Luego vuelve a abrir esta ventana.",
        old: "Esta versión de Zotero no tiene la API local. Actualiza a Zotero 7 o superior.", remote: "Solo se puede sincronizar con Zotero desde la computadora donde corre LJtex."};
      if (!st.ok) { q("#zst").textContent = why[st.reason] || "No pude hablar con Zotero."; q("#zst").className = "rfm bad"; return; }
      q("#zst").textContent = `Zotero conectado${st.bbt ? " (con Better BibTeX)" : ""}.`;
      q("#zco").innerHTML = `<option value="">Toda la biblioteca</option>` + st.collections.map(c => `<option value="${esc(c.key)}">${esc(c.path.join(" › "))}</option>`).join("");
      if (st.collections.some(c => c.key === cfg.collection)) q("#zco").value = cfg.collection;
      q("#zbd").hidden = false; q("#zgo").hidden = false;
      q("#zgo").onclick = async () => {
        const c = {file: q("#zfi").value.trim() || "zotero.bib", collection: q("#zco").value, auto: q("#zau").checked};
        lsSet(zotKey, c); q("#zgo").disabled = true; q("#zrs").className = "rfm"; q("#zrs").textContent = "Sincronizando…";
        const r = await zotSync(c); q("#zgo").disabled = false;
        if (r.error) { q("#zrs").className = "rfm bad"; q("#zrs").textContent = r.error; return; }
        const bn = c.file.replace(/\.bib$/i, "");
        q("#zrs").innerHTML = (r.unchanged ? `Ya estaba al día: ${r.count} referencias en <code>${esc(c.file)}</code>.` : `${r.created ? "Creado" : "Actualizado"} <code>${esc(c.file)}</code>: ${r.count} referencias` + (r.created ? "" : ` (${r.added} nuevas, ${r.removed} quitadas)`) + ".")
          + (r.dups?.length ? `<br><b>Ojo:</b> estas claves también están en otro .bib y LaTeX se quejará: ${esc(r.dups.join(", "))}.` : "")
          + `<br>Para usarlas: <code>\\bibliography{${esc(bn)}}</code> (o <code>\\addbibresource{${esc(c.file)}}</code> con biblatex).`;
      };
    });
  };
  // ---------- GitHub: escribir a varias manos, cada quien en su Mac ----------
  let ghInfo = null;
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const ghPaint = st => {
    const b = $("ghb"); if (!b) return;
    b.querySelector("span").textContent = ghInfo?.linked ? "Sincronizar" : "GitHub";
    b.title = ghInfo?.linked
      ? `Sincronizar con GitHub (${ghInfo.full}): trae los cambios de tus coautores y sube los tuyos` + (ghInfo.last ? ` · última vez: ${when(ghInfo.last)}` : "") + (st?.remote ? " · HAY CAMBIOS NUEVOS EN GITHUB" : st?.local ? " · tienes cambios sin subir" : "")
      : "Guardar este proyecto en GitHub para escribirlo con coautores";
    b.querySelector(".ghdot").hidden = !st?.remote;
  };
  async function ghRefresh() { ghInfo = await api(`/projects/${id}/github`).catch(() => null); ghPaint(); if (ghInfo?.linked) ghCheck(); }
  async function ghCheck() { const c = await api(`/projects/${id}/github/check`).catch(() => null); if (c?.linked) { ghInfo.last = c.last; ghPaint(c); } }
  ghRefresh().then(() => { if (takeOffer(id) && ghInfo && !ghInfo.linked && ghInfo.reason !== "remote" && $("ghb")) ghOffer(); });
  function ghOffer() {
    modal(`<h3>¿Respaldar este proyecto en GitHub?</h3>
      <p>Así tendrás una copia segura en tu cuenta de GitHub, podrás abrirlo desde otra computadora e invitar a coautores para escribirlo juntos.</p>
      <p class="rfn">Puedes hacerlo más tarde con el botón <b>GitHub</b> de la barra de arriba.</p>
      <div class="acts"><button id="gfn">Ahora no</button><button id="gfy" class="pr">Sí, respaldar en GitHub</button></div>`, (md, close) => {
      md.querySelector("#gfn").onclick = close;
      md.querySelector("#gfy").onclick = () => { close(); ghSetup(); };
      md.querySelector("#gfy").focus();
    });
  }
  const ghIv = setInterval(() => { if (ghInfo?.linked && $("ghb")) ghCheck(); }, 120000);
  { const prev = cleanup; cleanup = () => { prev(); clearInterval(ghIv); }; }
  const MARKS = "%<<<<<<< CONFLICTO (LJtex) · tu versión:\n   … tu texto …\n%======= la versión que llegó de GitHub:\n   … el texto de tu coautor …\n%>>>>>>> fin del conflicto · deja la versión buena y borra las tres líneas de marca";
  function ghReport(r) {
    const pend = r.blocked || [], conf = r.blocked ? [] : r.conflicts || [];
    const files = pend.length + conf.length;
    modal(`<h3>${files ? "Hay que elegir entre dos versiones" : "Sincronizado, con avisos"}</h3>
      ${pend.length ? "<p>Antes de sincronizar hay que resolver los conflictos que siguen pendientes en:</p>" : ""}
      ${conf.length ? `<p>${r.authors?.length ? esc(r.authors.join(", ")) + " y tú" : "Tu coautor y tú"} cambiaron <b>las mismas líneas</b> en:</p>` : ""}
      ${files ? `<ul>${pend.map(p => `<li><a href="#" data-op="${esc(p)}">${esc(p)}</a></li>`).join("")}${conf.map(c => `<li><a href="#" data-op="${esc(c.path)}">${esc(c.path)}</a> (${plural(c.n, "lugar", "lugares")})</li>`).join("")}</ul>
        <p>En cada lugar quedaron <b>las dos versiones</b>, una después de la otra, entre tres líneas de marca (busca <code>CONFLICTO</code> con ⌘F):</p>
        <pre class="ghpre">${esc(MARKS)}</pre>
        <p>Lee las dos, deja la buena (o combínalas), borra las tres líneas de marca y pulsa <b>Sincronizar</b> otra vez. Mientras tanto el documento compila con ambas versiones, y tus cambios de este proyecto no se suben hasta que resuelvas todos.</p>` : ""}
      ${r.notes?.length ? `<h4>Avisos</h4><ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      <div class="acts"><button id="ghok" class="pr">Entendido</button></div>`, (md, close) => {
      md.querySelector("#ghok").onclick = close; md.querySelector("#ghok").focus();
      md.onclick = e => { if (e.target === md) return close(); const a = e.target.closest("[data-op]"); if (a) { e.preventDefault(); close(); open(a.dataset.op); } };
    });
  }
  async function ghSync() {
    const b = $("ghb"); if (!b || b.disabled) return false;
    b.disabled = true; b.querySelector("span").textContent = "Sincronizando…"; $("cs").textContent = "Sincronizando con GitHub…";
    const r = await api(`/projects/${id}/github/sync`, {method: "POST"}).catch(() => ({error: "No se pudo contactar con el servidor."}));
    if (!$("ghb")) return false;
    b.disabled = false;
    if (r.error) { ghPaint(); $("cs").textContent = ""; if (r.needToken) { ghConnect(() => ghSync()); return false; } alert(r.error); return false; }
    ghInfo = {...ghInfo, linked: true, full: r.full || ghInfo?.full, url: r.url || ghInfo?.url, last: r.last}; ghPaint();
    await load();
    const n = r.pulled ? r.pulled.created.length + r.pulled.updated.length + r.pulled.removed.length : 0, parts = [];
    if (n) parts.push(`llegaron cambios en ${plural(n, "archivo", "archivos")}${r.authors?.length ? " (de " + r.authors.join(", ") + ")" : ""}`);
    if (r.pushed?.length) parts.push(`${r.pushed.length === 1 ? "se subió 1 archivo" : `se subieron ${r.pushed.length} archivos`}`);
    $("cs").textContent = r.blocked?.length ? "GitHub: hay conflictos sin resolver; no se sincronizó." : r.conflicts?.length ? "GitHub: llegaron cambios, con conflictos por resolver." : "GitHub: " + (parts.length ? parts.join(" y ") : "todo estaba al día") + ".";
    if (r.blocked?.length || r.conflicts?.length || r.notes?.length) ghReport(r);
    ghCheck();
    return !r.blocked?.length && !r.conflicts?.length;
  }
  // Al salir del proyecto (o cerrar LJtex) con cambios sin subir, recuerda sincronizar
  async function ghPending() {
    if (!ghInfo?.linked) return false;
    const c = await api(`/projects/${id}/github/check?local=1`).catch(() => null);
    return !!c?.local;
  }
  function ghLeaveAsk() {
    return new Promise(resolve => {
      let done = false;
      const md = modal(`<h3>Tienes cambios sin subir a GitHub</h3>
        <p>Tus coautores no los verán hasta que sincronices. ¿Quieres sincronizar antes de salir?</p>
        <div class="acts"><button id="glc">Cancelar</button><span class="sp"></span><button id="gln">Salir sin sincronizar</button><button id="gls" class="pr">Sincronizar y salir</button></div>`, (md, close) => {
        const fin = v => { if (done) return; done = true; close(); resolve(v); };
        md.querySelector("#glc").onclick = () => fin(false);
        md.querySelector("#gln").onclick = () => fin(true);
        md.querySelector("#gls").onclick = async () => { done = true; close(); resolve(await ghSync()); };
        md.querySelector("#gls").focus();
      });
      // Escape o clic fuera de la ventana = Cancelar
      const mo = new MutationObserver(() => { if (!md.isConnected) { mo.disconnect(); if (!done) { done = true; resolve(false); } } });
      mo.observe(document.body, {childList: true});
    });
  }
  const ghCanLeave = async () => !(await ghPending()) || ghLeaveAsk();
  document.querySelector("#proj .top").addEventListener("click", async e => {
    if (!e.target.closest('a[href="#"]')) return;
    e.preventDefault();
    if (await ghCanLeave()) location.hash = "";
  });
  window.ljtexBeforeClose = ghCanLeave;   // la app de escritorio pregunta esto antes de cerrar
  { const prev = cleanup; cleanup = () => { prev(); if (window.ljtexBeforeClose === ghCanLeave) delete window.ljtexBeforeClose; }; }
  const repoSlug = n => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "proyecto-ljtex";
  async function ghSetup() {
    if (!ghInfo?.connected) return ghConnect(async () => { await ghRefresh(); if (ghInfo?.connected) ghSetup(); });
    modal(`<h3>Guardar este proyecto en GitHub</h3>
      <p>Se crea un <b>repositorio</b> (una especie de carpeta) en tu cuenta de GitHub, <b>${esc(ghInfo.login || "")}</b>, con una copia de este proyecto. Desde entonces, el botón <b>Sincronizar</b> sube tus cambios y trae los de tus coautores.</p>
      <label class="rfl">Nombre del repositorio:<input id="ghn" class="ghin" value="${esc(repoSlug(info.name))}" spellcheck="false" autocomplete="off"></label>
      <label class="rfl"><input type="checkbox" id="ghpv" checked> Privado: solo lo ven tú y las personas que invites</label>
      <div id="ghm" class="rfm"></div>
      <div class="acts"><button id="ghc">Cancelar</button><button id="gho" class="pr">Crear y subir</button></div>`, (md, close) => {
      const q = s => md.querySelector(s);
      q("#ghn").focus(); q("#ghn").select();
      q("#ghc").onclick = close;
      const go = async () => {
        q("#gho").disabled = true; q("#ghm").className = "rfm"; q("#ghm").textContent = "Creando el repositorio y subiendo los archivos…";
        const r = await api(`/projects/${id}/github/create`, {method: "POST", body: {name: q("#ghn").value.trim(), private: q("#ghpv").checked}}).catch(() => ({error: "No se pudo contactar con el servidor."}));
        q("#gho").disabled = false;
        if (r.error) { q("#ghm").className = "rfm bad"; q("#ghm").textContent = r.error; return; }
        close(); await load(); await ghRefresh();
        $("cs").textContent = `GitHub: proyecto guardado en ${r.full}.`;
        ghPanel(true);
      };
      q("#gho").onclick = go; q("#ghn").onkeydown = e => { if (e.key === "Enter") go(); };
    });
  }
  async function ghPanel(fresh) {
    await ghRefresh();
    if (ghInfo?.reason === "remote") return ghRemote();
    if (!ghInfo?.linked) return ghSetup();
    modal(`<h3>${fresh ? "Listo: el proyecto ya está en GitHub" : "GitHub"}</h3>
      <p>Este proyecto está vinculado con <a href="${esc(ghInfo.url)}" target="_blank" rel="noopener">${esc(ghInfo.full)}</a>.${ghInfo.last ? ` Última sincronización: ${when(ghInfo.last)}.` : ""}</p>
      <h4>Coautores</h4><div id="ghpp" class="rfm">Consultando…</div>
      <div class="rfrow"><input id="ghu" placeholder="Usuario de GitHub de tu coautor" spellcheck="false" autocomplete="off" aria-label="Usuario de GitHub del coautor"><button id="ghi">Invitar</button></div>
      <p class="rfn">Tu coautor recibe la invitación por correo. Luego, en su LJtex, pulsa <b>Abrir desde GitHub</b> en la pantalla de proyectos: ahí acepta la invitación y abre el proyecto.</p>
      <h4>Cuenta</h4><p class="rfn">Conectado como <b>${esc(ghInfo.login || "")}</b> · <a href="#" id="ghk">cambiar clave o cuenta</a></p>
      <div class="acts"><button id="ghx">Desvincular…</button><span class="sp"></span><button id="ghc">Cerrar</button><button id="ghs" class="pr">Sincronizar ahora</button></div>`, (md, close) => {
      const q = s => md.querySelector(s);
      q("#ghc").onclick = close;
      q("#ghs").onclick = () => { close(); ghSync(); };
      q("#ghk").onclick = e => { e.preventDefault(); close(); ghConnect(() => ghRefresh()); };
      q("#ghx").onclick = async () => {
        if (!confirm(`¿Desvincular este proyecto de ${ghInfo.full}?\n\nNo se borra nada: el proyecto sigue aquí y el repositorio sigue en GitHub, pero dejarán de sincronizarse.`)) return;
        await api(`/projects/${id}/github`, {method: "DELETE"}); close(); ghRefresh();
      };
      const people = async () => {
        const r = await api(`/projects/${id}/github/people`).catch(() => ({error: "No se pudo contactar con el servidor."}));
        if (!q("#ghpp")) return;
        if (r.error) { q("#ghpp").textContent = r.error; return; }
        const others = (r.people || []).filter(p => p !== r.owner);
        q("#ghpp").innerHTML = `Dueño: <b>${esc(r.owner)}</b>` + (others.length ? ` · Con acceso: ${others.map(p => `<b>${esc(p)}</b>`).join(", ")}` : "")
          + (r.invited?.length ? ` · Invitación pendiente: ${r.invited.map(esc).join(", ")}` : "") + (!others.length && !r.invited?.length ? " · Aún no has invitado a nadie." : "");
      };
      people();
      const invite = async () => {
        const u = q("#ghu").value.trim(); if (!u) return;
        q("#ghi").disabled = true;
        const r = await api(`/projects/${id}/github/invite`, {method: "POST", body: {user: u}}).catch(() => ({error: "No se pudo contactar con el servidor."}));
        q("#ghi").disabled = false;
        if (r.error) { q("#ghpp").className = "rfm bad"; q("#ghpp").textContent = r.error; return; }
        q("#ghpp").className = "rfm"; q("#ghu").value = ""; people();
      };
      q("#ghi").onclick = invite; q("#ghu").onkeydown = e => { if (e.key === "Enter") invite(); };
    });
  }
  $("ghb").onclick = async () => {
    if (!ghInfo) await ghRefresh();
    if (ghInfo?.reason === "remote") return ghRemote();
    ghInfo?.linked ? ghSync() : ghSetup();
  };
  $("ghp").onclick = () => ghPanel();

  $("rf").onclick = () => {
    const bibs = files.filter(f => f.kind === "text" && /\.bib$/i.test(f.path)).map(f => f.path);
    const targets = bibs.length ? bibs : ["referencias.bib"];
    modal(`<h3>Agregar referencia</h3>
      <p>Pega un <b>DOI</b> (<code>10.1007/s00222-020-01017-z</code> o el enlace de doi.org) o un identificador de <b>arXiv</b> (<code>2301.01234</code> o el enlace de arxiv.org).</p>
      <div class="rfrow"><input id="rfi" placeholder="DOI o arXiv…" autocomplete="off" spellcheck="false"><button id="rfb" class="pr">Buscar</button></div>
      <div id="rfm" class="rfm"></div>
      <div id="rfr" hidden>
        <textarea id="rft" class="rft" rows="11" spellcheck="false" aria-label="Entrada BibTeX (puedes editarla)"></textarea>
        <label class="rfl">Agregar a: <select id="rfs">${targets.map(t => `<option>${esc(t)}</option>`).join("")}</select>${bibs.length ? "" : " (se creará)"}</label>
      </div>
      <p class="rfn">Se consulta Crossref o arXiv por internet; solo se envía el identificador que pegues, nunca tu texto.</p>
      <div class="acts"><button id="rfc">Cancelar</button><button id="rfo" class="pr" hidden>Agregar al .bib</button></div>`, (md, close) => {
      const q = sel => md.querySelector(sel), inp = q("#rfi"); inp.focus();
      const msg = (t, bad) => { q("#rfm").textContent = t; q("#rfm").className = "rfm" + (bad ? " bad" : ""); };
      let force = false;
      q("#rfc").onclick = close;
      const search = async () => {
        const v = inp.value.trim(); if (!v) return;
        q("#rfb").disabled = true; msg("Buscando…"); q("#rfr").hidden = true; q("#rfo").hidden = true; force = false;
        const r = await api("/bib/lookup", {method: "POST", body: {id: v}}).catch(() => ({error: "No se pudo contactar con el servidor."}));
        q("#rfb").disabled = false;
        if (r.error) return msg(r.error, true);
        msg(`${r.source}: ${r.authors || "sin autores"} (${r.year || "s. f."}) — ${r.title}`);
        q("#rft").value = r.entry; q("#rfr").hidden = false; q("#rfo").hidden = false; q("#rfo").textContent = "Agregar al .bib"; q("#rft").focus();
      };
      q("#rfb").onclick = search;
      inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); search(); } };
      q("#rfo").onclick = async () => {
        q("#rfo").disabled = true;
        const r = await api(`/projects/${id}/bib`, {method: "POST", body: {file: q("#rfs").value, entry: q("#rft").value, force}}).catch(() => ({error: "No se pudo contactar con el servidor."}));
        q("#rfo").disabled = false;
        if (r.dup) { force = true; q("#rfo").textContent = "Agregar de todas formas"; return msg(r.error, true); }
        if (r.error) return msg(r.error, true);
        await load();
        const cite = `\\cite{${r.key}}`;
        md.querySelector(".box").innerHTML = `<h3>Referencia agregada</h3><p>Quedó en <b>${esc(r.file)}</b> con la clave <code>${esc(r.key)}</code>${r.renamed ? " (la clave original ya existía, se le añadió una letra)" : ""}.</p>
          <div class="acts"><button id="rfk">Copiar ${esc(cite)}</button><button id="rfi2" ${view && !histMode ? "" : "disabled"}>Insertar en el cursor</button><button id="rfd" class="pr">Listo</button></div>`;
        md.querySelector("#rfd").onclick = close;
        md.querySelector("#rfk").onclick = e => { navigator.clipboard?.writeText(cite); e.target.textContent = "Copiado"; };
        md.querySelector("#rfi2").onclick = () => { close(); const h = view.state.selection.main.head; view.dispatch({changes: {from: h, insert: cite}, selection: {anchor: h + cite.length}}); view.focus(); };
      };
    });
  };

  // ---------- Esquema del documento ----------
  let olView = false, olTexts = new Map(), olFetched = 0, olFetching = false, olSig = "", olStm = true;
  try { olStm = localStorage.olStm !== "0"; } catch {}
  $("olst").checked = olStm;
  const texList = () => files.filter(f => f.kind === "text" && /\.(tex|ltx|latex)$/i.test(f.path));
  async function olFetch() {
    if (olFetching) return; olFetching = true;
    try {
      const m = new Map();
      await Promise.all(texList().map(async f => { const r = await api(`/files/text?project=${id}&path=${encodeURIComponent(f.path)}`); if (typeof r.text === "string") m.set(f.path, r.text); }));
      olTexts = m; olFetched = Date.now();
    } catch {} finally { olFetching = false; }
  }
  function olCompute() {
    const paths = texList().map(f => f.path), has = p => paths.includes(p);
    const textOf = p => p === cur && view ? view.state.doc.toString() : olTexts.get(p) ?? null;
    const isDoc = t => typeof t === "string" && /^[^%\n]*\\documentclass/m.test(t.replace(/%.*$/gm, ""));
    const root = cur && has(cur) && isDoc(textOf(cur)) ? cur : mainFile;
    const o = buildOutline(root, textOf, has, paths);
    let items = o.items;
    if (cur && has(cur) && !o.reached.has(cur)) {                          // archivo abierto que no cuelga del principal: se añade aparte
      const own = buildOutline(cur, textOf, has, paths).items;
      if (own.length) items = [...items, {file: cur, line: 1, kind: "mark", level: 0, title: `— ${cur} —`}, ...own];
    }
    return layout(items, olStm);
  }
  function olPaint() {
    if (!olView) return;
    const list = olCompute(), curLine = view && cur ? view.state.doc.lineAt(view.state.selection.main.head).number : 0;
    let act = -1; list.forEach((it, i) => { if (it.file === cur && it.line <= curLine) act = i; });
    const sig = JSON.stringify([list.map(i => [i.file, i.line, i.title, i.name, i.opt, i.excerpt, i.depth]), act]);
    if (sig === olSig) return; olSig = sig;
    const ul = $("ol"), keep = ul.scrollTop;
    ul.innerHTML = list.length ? list.map((it, i) => {
      const pad = `style="padding-left:${10 + it.depth * 14}px"`, cls = [it.kind, i === act ? "on" : ""].join(" ");
      const body = it.kind === "stm" ? `<b>${esc(it.name)}${it.star ? "*" : ""}${it.opt ? ` (${esc(it.opt)})` : ""}</b> <small>${esc(it.excerpt || it.label)}</small>`
        : `<span>${esc(it.title)}</span>`;
      return `<li class="${cls}" ${pad} data-f="${esc(it.file)}" data-l="${it.line}" title="${esc(it.file)}, línea ${it.line}">${body}</li>`;
    }).join("") : `<li class="none">No encontré secciones. Usa \\section{…} para que aparezcan aquí.</li>`;
    ul.scrollTop = keep;
  }
  async function setOl(on) {
    olView = on;
    $("tr").classList.toggle("ov", on);
    $("tr").querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === (on ? "o" : "f")));
    $("ol").hidden = $("olb").hidden = !on; $("cmp").hidden = true;
    if (on) { olSig = ""; olPaint(); await olFetch(); olSig = ""; olPaint(); }
  }
  $("tr").querySelector(".tabs").onclick = e => { const b = e.target.closest("button[data-v]"); if (b) b.dataset.v === "c" ? setCm(true) : setOl(b.dataset.v === "o"); };
  $("olst").onchange = () => { olStm = $("olst").checked; try { localStorage.olStm = olStm ? "1" : "0"; } catch {} olSig = ""; olPaint(); };
  $("ol").onclick = e => { const li = e.target.closest("li[data-f]"); if (li) goTo(li.dataset.f, +li.dataset.l); };
  const olTimer = setInterval(() => { if (!olView) return; if (Date.now() - olFetched > 8000) olFetch(); olPaint(); }, 1200);
  { const prev = cleanup; cleanup = () => { prev(); clearInterval(olTimer); }; }
  function drawTree() {
    const seen = new Set();
    let h = `<li class="dir root" data-d="" title="Suelta aquí para sacar un archivo de su carpeta"><span>${ico("folder")} ${esc(info.name)}</span></li>`;
    for (const f of allFiles) {
      const parts = f.path.split("/"), keep = parts.at(-1) === ".keep";
      parts.slice(0, -1).forEach((d, i) => {
        const k = parts.slice(0, i + 1).join("/");
        if (seen.has(k)) return;
        seen.add(k);
        h += `<li class="dir" draggable="true" data-d="${esc(k)}" style="padding-left:${8 + (i + 1) * 14}px"><span>${ico("folder")} ${esc(d)}</span><span class="x"><span data-r="${esc(k)}" title="Renombrar o mover">${ico("pencil", 13)}</span></span></li>`;
      });
      if (keep) continue;
      const on = histMode ? inFilter(f.path) : binCur ? f.path === binCur : f.path === cur;
      const isMain = f.path === mainFile, canMain = isDocRoot(f) && !isMain;
      h += `<li class="f${on ? " on" : ""}${isMain ? " main" : ""}" draggable="true" data-p="${esc(f.path)}" style="padding-left:${8 + parts.length * 14}px"><span>${fileIcon(f.path, f.kind)} ${esc(parts.at(-1))}${isMain ? ` <b class="ms" title="Archivo principal: es el que se compila">${ico("star", 12)}</b>` : ""}</span><span class="x">${canMain ? `<span data-m="${esc(f.path)}" title="Usar como archivo principal (el que se compila)">${ico("star", 13)}</span>` : ""}<span data-r="${esc(f.path)}" title="Renombrar o mover">${ico("pencil", 13)}</span><span data-x="${esc(f.path)}" title="Eliminar">${ico("x", 13)}</span></span></li>`;
    }
    $("tl").innerHTML = h;
  }

  // Mover o renombrar (un archivo o una carpeta con todo lo que contiene)
  async function move(from, to) {
    const r = await api("/files/move", {method: "POST", body: {project: id, from, to}});
    if (r.error) return alert(r.error);
    const hit = r.moved?.find(m => m.from === cur);
    await load();
    if (hit) open(hit.to);
    if (histMode) loadHistory();
  }
  function rename(path) {
    const base = path.split("/").at(-1);
    const n = prompt(`Nuevo nombre o ruta de «${path}»\n(si cambias la carpeta, se mueve; por ejemplo figuras/${base})`, path);
    if (n === null) return;
    const to = n.trim().replace(/^\/+|\/+$/g, "");
    if (to && to !== path) move(path, to);
  }

  $("tl").onclick = async e => {
    const li = e.target.closest("li"); if (!li) return;
    const r = e.target.dataset.r, x = e.target.dataset.x, mk = e.target.dataset.m;
    if (mk !== undefined) return setMain(mk);
    if (r !== undefined) return rename(r);
    if (x !== undefined) {
      if (!confirm(`¿Eliminar ${x}? También se borra su historial de versiones.` + (x === mainFile ? "\n\nEs el archivo principal: no se podrá compilar hasta que marques otro." : ""))) return;
      await api(`/files?project=${id}&path=${encodeURIComponent(x)}`, {method: "DELETE"});
      await load(); if (cur === x) open(firstFile());
      if (histMode) loadHistory();
      return;
    }
    if (histMode) {   // en el historial, el árbol filtra por archivo o por carpeta
      hfile = li.classList.contains("f") ? li.dataset.p : li.dataset.d ? li.dataset.d + "/" : ""; drawTree(); drawHist(); return;
    }
    const path = li.dataset.p, f = files.find(f => f.path === path); if (!f) return;
    f.kind === "bin" ? previewBin(path) : open(path);
  };

  // Vista previa de PDF e imágenes subidos al proyecto
  let binCur = null, binUrl = null, binViewer = null;
  const isImg = p => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(p), isPdf = p => /\.pdf$/i.test(p);
  function closeBin() {
    binViewer?.destroy(); binViewer = null;
    if (binUrl) URL.revokeObjectURL(binUrl); binUrl = null;
    $("ed").querySelector(".binview")?.remove(); binCur = null;
  }
  async function rawBlob(path) {
    const r = await fetch(`/api/files/raw?project=${id}&path=${encodeURIComponent(path)}`, {headers: H});
    if (r.status === 401) { badKey(); return null; }
    return r.ok ? r.blob() : null;
  }
  async function previewBin(path) {
    closeBin(); binCur = path;
    const box = document.createElement("div"); box.className = "binview";
    box.innerHTML = `<div class="bvbar"><b></b><span class="sp"></span><button data-a="dl">${ico("download")} Descargar</button><button data-a="x">${ico("x")} Cerrar</button></div><div class="bvbody">Cargando…</div>`;
    box.querySelector("b").textContent = path;
    $("ed").appendChild(box); drawTree();
    box.querySelector(".bvbar").onclick = async e => {
      const a = e.target.dataset.a;
      if (a === "x") { closeBin(); drawTree(); }
      if (a === "dl") downloadFile(path);
    };
    const blob = await rawBlob(path), body = box.querySelector(".bvbody");
    if (binCur !== path) return;
    if (!blob) { body.textContent = "No se pudo cargar el archivo."; return; }
    if (isPdf(path)) {
      body.textContent = ""; body.classList.add("pdf");
      binViewer = createViewer(body); binViewer.load(new Uint8Array(await blob.arrayBuffer()));
    } else if (isImg(path)) {
      binUrl = URL.createObjectURL(blob); body.textContent = "";
      const im = new Image(); im.src = binUrl; im.alt = path; body.appendChild(im);
    } else body.innerHTML = `<p>No hay vista previa para este tipo de archivo.<br>Para usarlo en LaTeX: <code>\\includegraphics{${esc(path)}}</code></p>`;
  }
  async function downloadFile(path) {
    const f = files.find(f => f.path === path); if (!f) return;
    const name = path.split("/").at(-1);
    if (f.kind === "bin") { const b = await rawBlob(path); if (b) saveBlob(b, name); }
    else {
      const r = await api(`/files/text?project=${id}&path=${encodeURIComponent(path)}`);
      saveBlob(new Blob([cur === path && view ? view.state.doc.toString() : r.text || ""], {type: "text/plain"}), name);
    }
  }
  async function deleteFileAt(x) {
    if (!confirm(`¿Eliminar ${x}? También se borra su historial de versiones.` + (x === mainFile ? "\n\nEs el archivo principal: no se podrá compilar hasta que marques otro." : ""))) return;
    await api(`/files?project=${id}&path=${encodeURIComponent(x)}`, {method: "DELETE"});
    if (binCur === x) closeBin();
    await load(); if (cur === x) open(firstFile());
    if (histMode) loadHistory();
  }

  // Menú contextual (clic derecho)
  const CMI = {"👁": "eye", "📝": "file-text", "✎": "pencil", "⬇": "download", "☆": "star", "📋": "copy", "🗑": "trash", "➕": "plus", "⬆": "upload", "📁": "folder"};
  let cm = null;
  const closeCm = () => { cm?.remove(); cm = null; };
  document.addEventListener("click", e => { if (cm && !cm.contains(e.target)) closeCm(); }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeCm(); });
  window.addEventListener("blur", closeCm);
  $("tl").addEventListener("scroll", closeCm);
  $("tl").oncontextmenu = e => {
    const li = e.target.closest("li"); if (!li) return;
    e.preventDefault(); closeCm();
    const items = [];
    if (li.classList.contains("f")) {
      const path = li.dataset.p, f = files.find(f => f.path === path); if (!f) return;
      const bin = f.kind === "bin";
      items.push([bin && (isImg(path) || isPdf(path)) ? "👁 Vista previa" : bin ? null : "📝 Abrir", () => bin ? previewBin(path) : open(path)]);
      items.push(["✎ Renombrar o mover…", () => rename(path)]);
      items.push(["⬇ Descargar", () => downloadFile(path)]);
      if (isDocRoot(f) && path !== mainFile) items.push(["☆ Usar como archivo principal", () => setMain(path)]);
      if (bin && isImg(path)) items.push(["📋 Copiar \\includegraphics", () => navigator.clipboard?.writeText(`\\includegraphics[width=\\linewidth]{${path}}`)]);
      if (!bin && /\.tex$/i.test(path)) items.push(["📋 Copiar \\input", () => navigator.clipboard?.writeText(`\\input{${path.replace(/\.tex$/i, "")}}`)]);
      items.push(["📋 Copiar ruta", () => navigator.clipboard?.writeText(path)]);
      items.push("-", ["🗑 Eliminar", () => deleteFileAt(path), true]);
    } else {
      const d = li.dataset.d || "";
      items.push(["➕ Nuevo archivo aquí…", async () => {
        const n = prompt("Nombre del archivo", d ? d + "/" : ""); if (!n) return;
        const p = n.trim(), r = await api("/files", {method: "POST", body: {project: id, path: p, kind: "text", text: ""}});
        if (r.error) return alert(r.error);
        await load(); setHist(false); open(p);
      }]);
      items.push(["📁 Nueva carpeta aquí…", () => newFolder(d)]);
      items.push(["⬆ Subir archivo…", () => $("up").click()]);
      items.push(["⬆ Subir carpeta aquí…", () => { upDest = d; $("fd").click(); }]);
      if (d) {
        items.push(["✎ Renombrar o mover…", () => rename(d)]);
        items.push("-", ["🗑 Eliminar carpeta", async () => {
          const inside = allFiles.filter(f => f.path.startsWith(d + "/"));
          if (!confirm(`¿Eliminar la carpeta ${d} con ${inside.filter(f => !f.path.endsWith("/.keep")).length} archivo(s)? También se borra su historial.`)) return;
          for (const f of inside) await api(`/files?project=${id}&path=${encodeURIComponent(f.path)}`, {method: "DELETE"});
          if (binCur && binCur.startsWith(d + "/")) closeBin();
          await load(); if (cur?.startsWith(d + "/")) open(firstFile());
          if (histMode) loadHistory();
        }, true]);
      }
    }
    cm = document.createElement("div"); cm.className = "ctxmenu";
    for (const it of items) {
      if (it === "-") { cm.appendChild(document.createElement("hr")); continue; }
      if (!it[0]) continue;
      const b = document.createElement("button"), em = Object.keys(CMI).find(k => it[0].startsWith(k));
      b.innerHTML = (em ? ico(CMI[em]) : "") + " " + esc(em ? it[0].slice(em.length).trim() : it[0]); if (it[2]) b.className = "danger";
      b.onclick = () => { closeCm(); it[1](); };
      cm.appendChild(b);
    }
    document.body.appendChild(cm);
    const w = cm.offsetWidth, h = cm.offsetHeight;
    cm.style.left = Math.max(4, Math.min(e.clientX, innerWidth - w - 4)) + "px";
    cm.style.top = Math.max(4, Math.min(e.clientY, innerHeight - h - 4)) + "px";
  };

  // Arrastrar y soltar: sobre una carpeta lo mete dentro; sobre el nombre del proyecto lo saca a la raíz
  const clearOver = () => $("tl").querySelectorAll(".over").forEach(x => x.classList.remove("over"));
  const destOf = li => !li ? "" : li.classList.contains("dir") ? li.dataset.d : li.dataset.p.split("/").slice(0, -1).join("/");
  $("tl").ondragstart = e => {
    const li = e.target.closest("li");
    if (!li || li.classList.contains("root")) return e.preventDefault();
    dragged = li.dataset.p ?? li.dataset.d;
    e.dataTransfer.setData("text/plain", dragged); e.dataTransfer.effectAllowed = "move";
  };
  const extFiles = e => dragged === null && [...(e.dataTransfer?.types || [])].includes("Files");
  $("tl").ondragover = e => {
    if (dragged === null && !extFiles(e)) return;
    e.preventDefault(); clearOver();
    const dest = destOf(e.target.closest("li"));
    [...$("tl").querySelectorAll("li.dir")].find(l => l.dataset.d === dest)?.classList.add("over");
  };
  $("tl").ondrop = async e => {
    e.preventDefault(); clearOver();
    if (extFiles(e)) {
      const ents = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
      if (ents.some(x => x.isDirectory)) return uploadTree(await walkEntries(ents), destOf(e.target.closest("li")));
    }
    if (extFiles(e) && e.dataTransfer.files.length) return uploadFiles([...e.dataTransfer.files], destOf(e.target.closest("li")));
    const src = dragged; dragged = null; if (src === null) return;
    const dest = destOf(e.target.closest("li")), base = src.split("/").at(-1);
    const to = dest ? `${dest}/${base}` : base;
    if (to !== src && !to.startsWith(src + "/")) await move(src, to);
  };
  $("tl").ondragend = () => { dragged = null; clearOver(); };

  $("nf").onclick = async () => {
    const p = prompt("Nombre del archivo (por ejemplo capitulos/intro.tex)"); if (!p) return;
    const r = await api("/files", {method: "POST", body: {project: id, path: p.trim(), kind: "text", text: ""}});
    if (r.error) return alert(r.error);
    await load(); setHist(false); open(p.trim());
  };
  $("up").onclick = () => $("fi").click();
  let upDest = "";
  const cleanDir = p => p.split("/").map(x => safeName(x)).join("/");
  function newFolder(parent = "") {
    modal(`<h3>Nueva carpeta</h3><label>Nombre${parent ? ` (dentro de <code>${esc(parent)}</code>)` : ""}<br><input id="fdn" class="pnin" placeholder="figuras  ·  capitulos/anexos" maxlength="120"></label><p class="hint" style="margin:6px 0 0;font-size:12px;opacity:.7">Puedes escribir subcarpetas con /.</p><div class="mbtns"><button class="gh" id="fdc">Cancelar</button><button id="fdo">Crear</button></div>`, (md, close) => {
      const inp = md.querySelector("#fdn"); inp.focus();
      const go = async () => {
        const n = inp.value.trim().replace(/^\/+|\/+$/g, ""); if (!n) return;
        const path = (parent ? parent + "/" : "") + n;
        const r = await api("/files", {method: "POST", body: {project: id, path: path + "/.keep", kind: "text", text: "", how: "folder"}});
        if (r.error) { alert(r.exists ? `Ya existe la carpeta «${path}».` : r.error); return; }
        close(); await load();
      };
      md.querySelector("#fdo").onclick = go; md.querySelector("#fdc").onclick = close;
      inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); go(); } };
    });
  }
  $("nd").onclick = () => {
    newFolder(cur ? cur.split("/").slice(0, -1).join("/") : "");
  };
  $("ud").onclick = () => { upDest = ""; $("fd").click(); };
  $("fd").onchange = async e => {
    const l = [...e.target.files]; e.target.value = ""; if (!l.length) return;
    const dest = upDest; upDest = "";
    uploadTree(l.map(f => ({file: f, rel: f.webkitRelativePath || f.name})), dest);
  };
  // Recorre carpetas soltadas (webkitGetAsEntry): devuelve archivos y carpetas vacías
  async function walkEntries(ents) {
    const out = {items: [], empty: []};
    const kids = d => new Promise(res => { const rd = d.createReader(), all = []; const go = () => rd.readEntries(b => b.length ? (all.push(...b), go()) : res(all), () => res(all)); go(); });
    const walk = async (en, base) => {
      const rel = base + en.name;
      if (en.isFile) { const file = await new Promise(res => en.file(res, () => res(null))); if (file) out.items.push({file, rel}); }
      else { const ks = await kids(en); if (!ks.length) out.empty.push(rel); for (const k of ks) await walk(k, rel + "/"); }
    };
    for (const en of ents) await walk(en, "");
    return out;
  }
  // Sube una carpeta entera conservando su estructura. Se ignoran ocultos (.DS_Store, .git…) y node_modules
  async function uploadTree(src, dest = "") {
    const items = Array.isArray(src) ? src : src.items, empty = Array.isArray(src) ? [] : src.empty;
    const hidden = rel => rel.split("/").some(x => x.startsWith(".") || x === "__MACOSX" || x === "node_modules");
    const todo = items.filter(x => !hidden(x.rel)), skipped = items.length - todo.length;
    if (!todo.length && !empty.length) return alert("No hay archivos que subir en esa carpeta.");
    if (todo.length > 300 && !confirm(`La carpeta tiene ${todo.length} archivos. ¿Subirla completa?`)) return;
    const errs = [], btn = $("ud"), label = btn.innerHTML; btn.disabled = true;
    let done = 0, firstText = null;
    for (const { file, rel } of todo) {
      const parts = rel.split("/"), dir = [dest, cleanDir(parts.slice(0, -1).join("/"))].filter(Boolean).join("/");
      btn.textContent = `Subiendo ${++done}/${todo.length}…`;
      const r = await uploadOne(file, dir, {name: safeName(parts.at(-1)), errs});
      if (r?.isText && !firstText) firstText = r.path;
    }
    for (const rel of empty.filter(x => !hidden(x))) {
      const path = [dest, cleanDir(rel)].filter(Boolean).join("/") + "/.keep";
      await api("/files", {method: "POST", body: {project: id, path, kind: "text", text: "", how: "folder"}});
    }
    btn.disabled = false; btn.innerHTML = label;
    await load();
    const msg = [];
    if (errs.length) msg.push(`No se subieron ${errs.length} archivo(s):\n` + errs.slice(0, 8).join("\n") + (errs.length > 8 ? "\n…" : ""));
    if (skipped) msg.push(`Se omitieron ${skipped} archivo(s) ocultos o de node_modules.`);
    if (msg.length) alert(msg.join("\n\n"));
  }
  const safeName = n => String(n || "").normalize("NFC").replace(/[^\p{L}\p{N}_\-. ]+/gu, "_").replace(/^\.+/, "_").slice(0, 120) || "archivo";
  const toB64 = f => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(f); });
  async function uploadOne(f, dir, {unique = false, name, errs} = {}) {
    const base = name || safeName(f.name), isText = /\.(tex|bib|sty|cls|txt)$/i.test(base);
    const body = {project: id, path: "", kind: isText ? "text" : "bin", how: "upload"};
    if (isText) body.text = await f.text(); else body.data = await toB64(f);
    const stem = base.replace(/\.[^.]*$/, ""), ext = base.slice(stem.length);
    for (let k = 1; k < 60; k++) {
      body.path = (dir ? dir + "/" : "") + (k === 1 ? base : `${stem}-${k}${ext}`);
      let r = await api("/files", {method: "POST", body});
      if (!r.error) return {path: body.path, isText};
      if (r.exists && unique) continue;
      if (errs) { errs.push(`${body.path}: ${r.exists ? "ya existe" : r.error}`); return null; }
      if (r.exists === "bin" && !isText) {
        if (!confirm(`Ya existe «${body.path}». ¿Reemplazarlo por el archivo nuevo?`)) return null;
        r = await api("/files", {method: "POST", body: {...body, replace: true}});
        if (!r.error) return {path: body.path, isText};
      }
      alert(r.exists === "text" ? r.error + " Elimínalo o renómbralo antes de subir otro con el mismo nombre." : r.error); return null;
    }
    return null;
  }
  async function uploadFiles(list, dir = "") {
    let last = null;
    for (const f of list) { const r = await uploadOne(f, dir); if (r) last = r; }
    await load(); if (last?.isText) { setHist(false); open(last.path); }
    return last;
  }
  $("fi").multiple = true;
  $("fi").onchange = async e => { const l = [...e.target.files]; e.target.value = ""; if (l.length) await uploadFiles(l); };

  // Pegar o soltar imágenes (y PDF) en el editor: se guardan en figuras/ y se inserta \includegraphics
  const imgExt = t => ({"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"})[t];
  async function dropIntoEditor(fs, v, pos) {
    const ins = [];
    for (const f of fs) {
      const isImg = f.type.startsWith("image/"), isPdf = /\.pdf$/i.test(f.name);
      const generic = isImg && (!f.name || /^image\.\w+$/i.test(f.name));
      const name = generic ? `imagen-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.${imgExt(f.type) || "png"}` : undefined;
      const r = await uploadOne(f, isImg || isPdf ? "figuras" : "", {unique: true, name});
      if (r && (isImg || isPdf)) ins.push(`\\includegraphics[width=\\linewidth]{${r.path}}`);
    }
    await load();
    if (ins.length && view === v) {
      const s = v.state.selection.main, from = pos ?? s.from, to = pos == null ? s.to : pos, text = ins.join("\n");
      v.dispatch({changes: {from, to, insert: text}, selection: {anchor: from + text.length}, userEvent: "input.paste", scrollIntoView: true});
    }
  }
  const paintPos = v => { const el = $("pos"); if (!el) return; if (!v) { el.textContent = ""; return; } const h = v.state.selection.main.head, l = v.state.doc.lineAt(h); el.textContent = `Línea ${l.number}, col. ${h - l.from + 1}`; };

  // Flechita en el margen de la línea del cursor y «Ir al PDF» en el clic derecho
  class ArrowMark extends GutterMarker { toDOM() { const d = document.createElement("span"); d.className = "pdfarrow"; d.title = "Ir a esta línea en el PDF (⌥Enter)"; d.innerHTML = ico("arrow-right", 14); return d; } eq() { return true; } }
  const arrowMark = new ArrowMark();
  const pdfGutter = cmGutter({class: "cm-pdfgut", lineMarker: (v, line) => v.state.doc.lineAt(v.state.selection.main.head).from === line.from ? arrowMark : null,
    lineMarkerChange: u => u.selectionSet || u.docChanged, initialSpacer: () => arrowMark,
    domEventHandlers: {mousedown: (v, line) => { v.dispatch({selection: {anchor: line.from}}); toPdf(); return true; }}});
  const pdfCtx = EditorView.domEventHandlers({contextmenu(e, v) {
    const pos = v.posAtCoords({x: e.clientX, y: e.clientY}); if (pos == null) return false;
    e.preventDefault(); v.dispatch({selection: {anchor: pos}}); closeCm();
    cm = document.createElement("div"); cm.className = "ctxmenu";
    const b = document.createElement("button"); b.innerHTML = ico("arrow-right") + " Ir al PDF <small style=\"margin-left:auto;opacity:.6\">" + (/Mac/.test(navigator.platform) ? "⌥↩" : "Alt+Enter") + "</small>";
    b.onclick = () => { closeCm(); toPdf(); }; cm.appendChild(b); document.body.appendChild(cm);
    cm.style.left = Math.min(e.clientX, innerWidth - cm.offsetWidth - 4) + "px"; cm.style.top = Math.min(e.clientY, innerHeight - cm.offsetHeight - 4) + "px";
    return true;
  }});
  const posExt = EditorView.updateListener.of(u => { if (u.selectionSet || u.docChanged) paintPos(u.view); });
  themeHook = () => view?.dispatch({effects: hlComp.reconfigure(themeNow() === "dark" ? darkHL : [])});
  { const prev = cleanup; cleanup = () => { prev(); themeHook = null; }; }
  const fileDnD = EditorView.domEventHandlers({
    paste(e, v) {
      const fs = [...(e.clipboardData?.files || [])]; if (!fs.length || e.clipboardData.getData("text/plain")) return false;
      e.preventDefault(); dropIntoEditor(fs, v, null); return true;
    },
    dragover(e) { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); return true; } return false; },
    drop(e, v) {
      const fs = [...(e.dataTransfer?.files || [])]; if (!fs.length) return false;
      e.preventDefault(); dropIntoEditor(fs, v, v.posAtCoords({x: e.clientX, y: e.clientY})); return true;
    },
  });
  const noNav = e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); };   // soltar un archivo fuera de las zonas válidas no debe abrirlo en la ventana
  document.addEventListener("dragover", noNav); document.addEventListener("drop", noNav);
  { const prev = cleanup; cleanup = () => { prev(); document.removeEventListener("dragover", noNav); document.removeEventListener("drop", noNav); }; }

  // Snippets propios (abreviatura + Tab). Se guardan en esta computadora.
  const SNIP0 = [
    {k: "thm", t: "\\begin{theorem}\n\t${}\n\\end{theorem}"}, {k: "lem", t: "\\begin{lemma}\n\t${}\n\\end{lemma}"},
    {k: "defn", t: "\\begin{definition}\n\t${}\n\\end{definition}"}, {k: "prf", t: "\\begin{proof}\n\t${}\n\\end{proof}"},
    {k: "eq", t: "\\begin{equation}\n\t${}\n\\end{equation}"}, {k: "ali", t: "\\begin{align*}\n\t${}\n\\end{align*}"},
    {k: "enu", t: "\\begin{enumerate}\n\t\\item ${}\n\\end{enumerate}"}, {k: "ite", t: "\\begin{itemize}\n\t\\item ${}\n\\end{itemize}"},
    {k: "fig", t: "\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${}}\n\t\\caption{${}}\n\t\\label{fig:${}}\n\\end{figure}"},
    {k: "pmat", t: "\\begin{pmatrix}\n\t${} & ${} \\\\\n\t${} & ${}\n\\end{pmatrix}"},
  ];
  const getSnips = () => { const v = lsGet("snippets", null); return Array.isArray(v) ? v.filter(x => x && typeof x.k === "string" && typeof x.t === "string") : SNIP0; };
  const complete = latexComplete({
    snippets: getSnips,
    files: () => files,
    fetchText: async p => (await api(`/files/text?project=${id}&path=${encodeURIComponent(p)}`)).text,
    current: () => ({path: cur, text: view ? view.state.doc.toString() : ""}),
  });

  // ---------- Recordar dónde te quedaste (por proyecto y archivo): cursor, desplazamiento del código y del PDF ----------
  const posKey = "pos:" + id;
  let pdfWant = lsGet(posKey, {}).pdf || null, restored = null;      // PDF pendiente de colocar cuando salga por primera vez
  function saveView() {
    if (!$("ed") || histMode) return;
    const st = lsGet(posKey, {});
    if (cur && view && restored === cur) {
      const h = view.state.selection.main.head, top = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
      st.file = cur; st.at = {...(st.at || {}), [cur]: {head: h, top: view.state.doc.lineAt(top).number}};
    }
    if (viewer.ready && !pdfWant) st.pdf = viewer.getState();
    lsSet(posKey, st);
  }
  function restoreView(path, yd) {
    if (!view || cur !== path || restored === path) return;
    const a = lsGet(posKey, {}).at?.[path], len = view.state.doc.length;
    restored = path;
    if (!a || !len) return;
    const head = Math.min(a.head || 0, len), ln = Math.min(Math.max(1, a.top || 1), view.state.doc.lines);
    view.dispatch({selection: {anchor: head}, effects: EditorView.scrollIntoView(view.state.doc.line(ln).from, {y: "start"})});
  }
  const posIv = setInterval(saveView, 1000);
  window.addEventListener("pagehide", saveView);
  function open(path) {
    closeBin();
    view?.destroy(); prov?.destroy(); ydoc?.destroy();
    if (!path) { view = null; cur = null; cmArr?.unobserve(cmPaint); cmArr = null; cmPaint(); drawTree(); return; }
    cur = path; restored = null; ydoc = new Y.Doc(); const ytext = ydoc.getText("src");
    prov = new HocuspocusProvider({url: `ws://${location.hostname}:1234`, name: `${id}/${path}`, document: ydoc,
      token: JSON.stringify({t: pass, n: name}), onSynced: () => { restoreView(path, ydoc); if (!viewer.ready) setTimeout(compile, 300); }});
    prov.awareness.setLocalStateField("user", {name, color, colorLight});
    view = new EditorView({parent: $("ed"), doc: ytext.toString(),
      extensions: [basicSetup, hlComp.of(themeNow() === "dark" ? darkHL : []), posExt, pdfGutter, StreamLanguage.define(stex), EditorView.lineWrapping, complete, latexFold(), mathHover(), yCollab(ytext, prov.awareness), fileDnD, linkExt, commentsExt(ytext, ydoc), ...(/\.(tex|md|txt)$/i.test(path) ? [spellcheck()] : []), pdfCtx]});
    ytext.observe(() => { if ($("auto").checked) { clearTimeout(t); t = setTimeout(compile, 4000); } wcSoon(); });
    cmBind(ydoc);
    drawTree();
  }

  // ---------- Historial de cambios ----------
  function setHist(on) {
    if (on === histMode) return;
    histMode = on; $("proj").classList.toggle("hist", on); applyLay(); $("hb").innerHTML = on ? `${ico("back")} Volver al editor` : `${ico("history")} Historial`;
    if (on) {
      drawTree();
      loadHistory().then(() => {
        const f = hist.find(e => e.type === "v" && (!hfile || e.path === hfile)) || hist.find(e => e.type === "v");
        if (hsel === null && f) pick(f.id); else if (hsel === null) drawDiff();
      });
    } else { drawTree(); requestAnimationFrame(() => view?.requestMeasure()); }
  }
  $("hb").onclick = () => setHist(!histMode);

  async function loadHistory() {
    const r = await api(`/projects/${id}/history`);
    if (!Array.isArray(r) || !$("hl")) return;
    const sig = JSON.stringify(r); if (sig === hsig) return;
    hsig = sig; hist = r; drawHist();
  }
  const setOptions = (sel, html, val) => { if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; } sel.value = val; };
  function drawHist() {
    const paths = [...new Set([...hist.filter(e => e.type === "v").map(e => e.path), ...(hfile ? [hfile] : [])])].sort();
    const authors = [...new Set([...hist.flatMap(e => (e.author || "").split(", ")), ...(hauthor ? [hauthor] : [])].filter(Boolean))].sort();
    setOptions($("hf"), `<option value="">Todos los archivos</option>` + paths.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join(""), hfile);
    setOptions($("ha"), `<option value="">Todos los autores</option>` + authors.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join(""), hauthor);
    const auto = $("hauto").checked;
    const inF = p => !hfile || p === hfile || (hfile.endsWith("/") && p.startsWith(hfile));
    const vis = hist.filter(e =>
      (inF(e.path || "") || (e.type === "e" && inF(e.detail || ""))) &&
      (!hauthor || (e.author || "").split(", ").includes(hauthor)) &&
      (auto || e.type === "e" || !e.auto || e.label !== ""));
    const keep = $("hl").scrollTop;
    let day = "", h = "";
    for (const e of vis) {
      const d = dayLabel(e.t);
      if (d !== day) { day = d; h += `<li class="day">${esc(d)}</li>`; }
      h += e.type === "v" ? vItem(e) : eItem(e);
    }
    $("hl").innerHTML = h || `<li class="none">No hay cambios con estos filtros.</li>`;
    $("hl").scrollTop = keep;
  }
  const vItem = e => `<li class="h v${"v" + e.id === hsel ? " on" : ""}${e.auto && !e.label ? " au" : ""}" tabindex="0" data-v="${e.id}">
    <div class="r1"><b>${hm(e.t)}</b><span class="fp" title="${esc(e.path)}">${esc(e.path)}</span></div>
    <div class="r2">${e.author ? chips(e.author) : '<span class="m">Estado guardado</span>'}${e.label ? `<span class="lb">${e.auto ? "" : "★ "}${esc(e.label)}</span>` : e.auto ? '<span class="m">automático</span>' : ""}</div>
    <div class="r3">${statsHtml(e.stats)}</div>
    ${e.stats?.h ? `<div class="wh">${esc(e.stats.h)}</div>` : ""}
    ${e.stats?.p?.length ? `<pre class="pv">${e.stats.p.map(esc).join("\n")}</pre>` : ""}</li>`;
  const eItem = e => `<li class="h e${"e" + e.id === hsel ? " on" : ""}" tabindex="0" data-e="${e.id}"><div class="r1"><b>${hm(e.t)}</b>${chips(e.author)} <span>${EV[e.kind] || esc(e.kind)}</span>
    ${e.kind === "project" ? `<code>${esc(e.detail)}</code>` : e.kind === "restore-project" ? `<span class="m">${esc(e.detail)}</span>` : `<code>${esc(e.path)}</code>`}${e.kind === "move" ? ` → <code>${esc(e.detail)}</code>` : ""}</div></li>`;
  const choose = e => { const li = e.target.closest("li[data-v], li[data-e]"); if (!li) return; li.dataset.v ? pick(+li.dataset.v) : pickEvent(+li.dataset.e); };
  $("hl").onclick = choose;
  $("hl").onkeydown = e => { if (e.key === "Enter") choose(e); };
  $("hf").onchange = e => { hfile = e.target.value; drawTree(); drawHist(); };
  $("ha").onchange = e => { hauthor = e.target.value; drawHist(); };
  $("hauto").onchange = drawHist;

  async function pick(vid) {
    hsel = "v" + vid; hl_mark();
    const d = await api(`/versions/${vid}`);
    if (hsel !== "v" + vid) return;
    hdata = d.id ? d : null;
    drawDiff();
  }
  function pickEvent(eid) {
    hsel = "e" + eid; hl_mark(); hdata = null;
    drawEvent(hist.find(e => e.type === "e" && e.id === eid));
  }
  const hl_mark = () => $("hl").querySelectorAll("li[data-v], li[data-e]").forEach(li => li.classList.toggle("on", (li.dataset.v ? "v" + li.dataset.v : "e" + li.dataset.e) === hsel));

  // Un cambio de archivos (alta, baja, movimiento…): no hay diff, pero se puede volver a antes de él
  const EVT = {
    project: ["Se creó el proyecto", "Este es el principio del historial."],
    create: ["Se creó un archivo", "Antes de este cambio ese archivo no existía."],
    upload: ["Se subió un archivo", "Antes de este cambio ese archivo no existía."],
    replace: ["Se reemplazó un archivo", "Volver a antes de este cambio recupera la versión anterior del archivo."],
    delete: ["Se eliminó un archivo", "Volver a antes de este cambio lo recupera con el último contenido que tenía."],
    move: ["Se movió o renombró", "Volver a antes de este cambio lo deja donde estaba."],
    "restore-project": ["Se restauró el proyecto", "Si fue un error, volver a antes de este cambio deja el proyecto como estaba justo antes de restaurar."],
  };
  function drawEvent(e) {
    merge?.destroy(); merge = null; $("hbar").innerHTML = $("dh").innerHTML = "";
    if (!e) return drawDiff();
    const [title, note] = EVT[e.kind] || [e.kind, ""];
    const what = e.kind === "project" ? e.detail : e.kind === "move" ? `${e.path} → ${e.detail}` : e.path;
    $("hhead").innerHTML = `<div class="t1"><b>${esc(title)}</b><span class="m">${new Date(e.t).toLocaleString("es", {dateStyle: "full", timeStyle: "medium"})}</span></div>
      <div class="t2">${chips(e.author)}${what ? `<code>${esc(what)}</code>` : ""}${e.kind === "restore-project" ? `<span class="m">${esc(e.detail)}</span>` : ""}</div>
      <div class="t3"><button id="rp" class="pr"${e.snap ? "" : " disabled"}>Volver a antes de este cambio</button></div>`;
    $("df").innerHTML = `<div class="empty"><p>${esc(note)}</p><p class="m">${e.snap ? "«Volver a antes de este cambio» restaura todos los archivos del proyecto a como estaban justo antes, y te muestra primero qué cambiaría." : "Este cambio es anterior a las copias del proyecto completo, así que no se puede volver a antes de él."}</p></div>`;
    if (e.snap) $("rp").onclick = () => restoreProject(e.snap);
  }

  // Restaurar todos los archivos a como estaban en una copia, mostrando antes qué cambiaría
  async function restoreProject(snapId) {
    const p = await api(`/snaps/${snapId}/preview`);
    if (!p.update) return alert(p.error || "No se pudo preparar la restauración.");
    const n = p.update.length + p.create.length + p.remove.length + p.rename.length;
    const sec = (title, items) => items.length ? `<h4>${title}</h4><ul>${items.join("")}</ul>` : "";
    const code = s => `<code>${esc(s)}</code>`;
    const body = n
      ? sec("Se restaurará el contenido de", p.update.map(u => `<li>${code(u.path)} ${u.bin ? '<span class="m">archivo</span>' : `<span class="ad">+${u.a}</span> <span class="rm">−${u.r}</span> <span class="m">líneas</span>`}</li>`))
        + sec("Se volverán a crear", p.create.map(f => `<li>${code(f)}</li>`))
        + sec("Se eliminarán", p.remove.map(f => `<li>${code(f)}</li>`))
        + sec("Se renombrarán", p.rename.map(([a, b]) => `<li>${code(a)} → ${code(b)}</li>`))
      : "<p>El proyecto ya está exactamente así. No hay nada que restaurar.</p>";
    const md = document.createElement("div"); md.className = "modal";
    md.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>Restaurar el proyecto al estado del ${esc(when(p.when))}</h3>${body}
      <p class="m">Antes de restaurar se guarda una copia del estado actual: podrás volver a ella desde el Historial. Quien tenga archivos abiertos verá los cambios al instante.</p>
      <div class="acts"><button id="mc">Cancelar</button><button id="mo" class="pr"${n ? "" : " disabled"}>Restaurar el proyecto</button></div></div>`;
    document.body.appendChild(md);
    const close = () => md.remove();
    md.onclick = e => { if (e.target === md) close(); };
    $("mc").onclick = close; $("mc").focus();
    $("mo").onclick = async () => {
      $("mo").disabled = true; $("mo").textContent = "Restaurando…";
      const r = await api(`/snaps/${snapId}/restore`, {method: "POST", body: {}});
      close();
      if (r.error) return alert(r.error);
      await load();
      if (cur && !files.some(f => f.path === cur)) open(firstFile());
      hsig = ""; await loadHistory();
      const ev = hist.find(e => e.type === "e" && e.kind === "restore-project");
      if (ev) pickEvent(ev.id);
      $("cs").textContent = "Proyecto restaurado.";
    };
  }

  async function drawDiff() {
    const d = hdata;
    merge?.destroy(); merge = null; $("df").innerHTML = "";
    if (!d) {
      $("hhead").innerHTML = $("hbar").innerHTML = $("dh").innerHTML = "";
      $("df").innerHTML = '<div class="empty">Elige un cambio de la lista para ver qué se modificó, quién lo hizo y cuándo.</div>';
      return;
    }
    const mode = cmp === "now" && d.exists ? "now" : "prev";
    $("hhead").innerHTML = `<div class="t1"><b>${esc(d.path)}</b><span class="m">${new Date(d.t).toLocaleString("es", {dateStyle: "full", timeStyle: "medium"})}</span></div>
      <div class="t2">${d.author ? chips(d.author) : '<span class="m">Estado guardado automáticamente</span>'}${d.label ? `<span class="lb">${d.auto ? "" : "★ "}${esc(d.label)}</span>` : ""}<span>${statsHtml(d.stats)}</span></div>
      <div class="t3"><button id="rb" class="pr"${d.exists ? "" : " disabled"} title="Solo este archivo">Restaurar este archivo</button>
        <button id="rp"${d.snap ? "" : " disabled"} title="${d.snap ? "Todos los archivos, imágenes y carpetas" : "Esta versión es anterior a las copias del proyecto completo"}">Restaurar todo el proyecto a este momento</button>
        <button id="of"${d.exists ? "" : " disabled"}>Abrir el archivo</button></div>`;
    if (d.snap) $("rp").onclick = () => restoreProject(d.snap);
    $("hbar").innerHTML = `<label><input type="radio" name="cmp" value="prev"${mode === "prev" ? " checked" : ""}> Frente a la versión anterior</label>
      <label><input type="radio" name="cmp" value="now"${mode === "now" ? " checked" : ""}${d.exists ? "" : " disabled"}> Frente al texto actual</label>
      <span class="sp"></span><span id="cc" class="m"></span><button id="pu" title="Cambio anterior">↑</button><button id="nx" title="Cambio siguiente">↓</button>`;
    $("hbar").querySelectorAll("input").forEach(r => r.onchange = () => { cmp = r.value; drawDiff(); });
    $("rb").onclick = async () => {
      if (!confirm(`Se guardará el estado actual de «${d.path}» y luego se restaurará la versión del ${when(d.t)}.\nQuienes tengan el archivo abierto verán el cambio al instante. ¿Continuar?`)) return;
      const r = await api(`/versions/${d.id}/restore`, {method: "POST", body: {}});
      if (r.error) return alert(r.error);
      hsig = ""; await loadHistory(); pick(r.id);
    };
    $("of").onclick = () => { setHist(false); open(d.path); };

    let left, right, ll, rl;
    if (mode === "now") {
      const c = await api(`/files/text?project=${id}&path=${encodeURIComponent(d.path)}`);
      if (hdata !== d) return;
      left = d.text; right = c.text ?? ""; ll = `Esta versión · ${when(d.t)}`; rl = "Texto actual del archivo";
    } else {
      left = d.prev?.text ?? ""; right = d.text;
      ll = d.prev ? `Antes · ${d.prev.author || "estado guardado"} · ${when(d.prev.t)}` : "Antes: archivo vacío";
      rl = `Después · ${d.author || "estado guardado"} · ${when(d.t)}`;
    }
    $("dh").innerHTML = `<span>${esc(ll)}</span><span>${esc(rl)}</span>`;
    const ro = [EditorView.editable.of(false), EditorView.lineWrapping];
    merge = new MergeView({a: {doc: left, extensions: ro}, b: {doc: right, extensions: ro},
      parent: $("df"), collapseUnchanged: {margin: 3, minSize: 5}});
    const n = merge.chunks.length;
    $("cc").textContent = n ? `${n} ${n === 1 ? "cambio" : "cambios"}` : "Sin diferencias";
    $("pu").onclick = () => merge && goToPreviousChunk(merge.b);
    $("nx").onclick = () => merge && goToNextChunk(merge.b);
    if (n) merge.b.dispatch({selection: {anchor: merge.chunks[0].fromB}, scrollIntoView: true});
  }

  $("save").onclick = async () => {
    if (!cur) return;
    const label = prompt("Nombre de la versión (por ejemplo: Envío a revista v1)"); if (label === null) return;
    const r = await api("/versions", {method: "POST", body: {doc: `${id}/${cur}`, label}});
    if (r.error) return alert(r.error);
    $("cs").textContent = "Versión guardada. La ves en Historial.";
    if (histMode) loadHistory();
  };

  // LaTeX informa de un paquete que falta cuando ya ha leído la línea siguiente: se busca el \usepackage real.
  const fixLine = (file, line, find) => {
    if (!find || !line || file !== cur || !view) return line;
    const d = view.state.doc;
    for (let n = Math.min(line, d.lines); n >= Math.max(1, line - 12); n--) if (d.line(n).text.includes(find)) return n;
    return line;
  };
  // Ir a una línea de un archivo (desde el panel de errores)
  function goTo(path, line, to) {
    if (!files.some(f => f.path === path)) return;
    if (histMode) setHist(false);
    if (cur !== path) open(path);
    let tries = 0;
    (function apply() {
      const d = view?.state.doc;
      if (d && (d.lines >= line || tries > 14)) {
        const ln = d.line(Math.max(1, Math.min(line, d.lines)));
        const end = typeof to === "number" && to > line ? d.line(Math.max(1, Math.min(to, d.lines))).to : ln.to;
        view.dispatch({selection: {anchor: ln.from, head: end}, scrollIntoView: true}); view.focus();
      } else { tries++; setTimeout(apply, 150); }
    })();
  }

  // Panel de errores: lo importante arriba, avisos y registro completo plegados
  let errList = [], lgTab = "", lastLog = null, compiledFile = null;
  const cf = () => compiledFile && files.some(x => x.path === compiledFile) ? compiledFile : mainFile;
  function showLog(log, hasPdf) {
    const box = $("lg"), r = analyze(log);
    const where = e => {
      const f = e.file && files.some(x => x.path === e.file) ? e.file : (e.line && files.some(x => x.path === cf()) ? cf() : null);
      const ln = fixLine(f, e.line, e.find);
      return f && ln ? `<a class="go" data-f="${esc(f)}" data-l="${ln}" data-q="${esc(e.find || "")}">${esc(f)}, línea ${ln}</a>` : (f ? esc(f) : "");
    };
    const item = (e, w, k) => `<div class="er${w ? " w" : ""}"><div class="em">${esc(e.msg)}</div>
      ${where(e) ? `<div class="at">${where(e)}</div>` : ""}${!w && k != null ? `<button class="fixai" data-fixai="${k}" title="Pedir al asistente que arregle este error">Resolver con IA</button>` : ""}${e.context && !e.find ? `<div class="cx">${esc(e.context)}</div>` : ""}
      ${e.hint ? `<div class="hn">${esc(e.hint.text)}</div>${e.hint.cmd ? `<div class="cm"><code>${esc(e.hint.cmd)}</code><button data-copy="${esc(e.hint.cmd)}">Copiar</button></div>` : ""}` : ""}</div>`;
    if (!r.errors.length && !hasPdf) r.errors.push({msg: String(log || "").split("\n").find(x => x.trim())?.slice(0, 200) || "No se pudo compilar", file: null, line: null, context: "", hint: null});
    const ne = r.errors.length, nw = r.warnings.length;
    errList = r.errors.slice(0, 8).map(e => `${e.file || cf()}${e.line ? ":" + e.line : ""}: ${e.msg}${e.context ? " (" + e.context + ")" : ""}`);
    lastErrors = r.errors.slice(0, 8).map(e => `${e.file || cf()}${e.line ? ":" + e.line : ""}: ${e.msg}${e.context ? " (" + e.context + ")" : ""}`).join("\n");
    if (typeof drawChips === "function") drawChips();
    const tabs = (nw ? `<button class="lt${lgTab === "w" ? " on" : ""}" data-t="w">${nw} ${nw === 1 ? "aviso" : "avisos"}</button>` : "") + (log ? `<button class="lt${lgTab === "l" ? " on" : ""}" data-t="l" title="${r.layout ? r.layout + " avisos de maquetación (cajas desbordadas)" : ""}">Registro</button>` : "");
    if (lgTab === "w" && !nw || lgTab === "l" && !log) lgTab = "";
    const status = ne ? `${ne} ${ne === 1 ? "error" : "errores"}${hasPdf ? "" : " · no se generó el PDF"}` : (nw ? "Compilación correcta" : "Compilación correcta");
    box.innerHTML = `<div class="lh ${ne ? "bad" : nw ? "warn" : "ok"}"><span>${status}</span><span class="lts">${ne > 1 ? `<button class="fixai" data-fixai="all" title="Pedir al asistente que arregle todos los errores">Resolver todo con IA</button>` : ""}${tabs}</span></div>`
      + (ne && !lgTab ? r.errors.map((e, k) => item(e, false, k < 8 ? k : null)).join("") : "")
      + (lgTab === "w" ? r.warnings.map(w => item({msg: w.msg, line: w.line, file: w.line ? cf() : null, hint: w.hint}, true)).join("") : "")
      + (lgTab === "l" ? `<pre>${esc(log)}</pre>` : "");
    lastLog = {log, hasPdf};
    return ne;
  }
  $("lg").onclick = e => {
    const er = e.target.closest?.(".er"); if (er && !e.target.closest("a.go,button") && er.querySelector(".cx,.hn")) er.classList.toggle("open");
    const fx = e.target.closest?.("button[data-fixai]");
    if (fx) { fixWithAI(fx.dataset.fixai); return; }
    const t = e.target.closest?.("button[data-t]"); if (t) { lgTab = lgTab === t.dataset.t ? "" : t.dataset.t; if (lastLog) showLog(lastLog.log, lastLog.hasPdf); return; }
    const g = e.target.closest?.("a.go"); if (g) { goTo(g.dataset.f, fixLine(g.dataset.f, +g.dataset.l, g.dataset.q), true); return; }
    const c = e.target.closest?.("button[data-copy]");
    if (c) navigator.clipboard?.writeText(c.dataset.copy).then(() => { c.textContent = "Copiado"; setTimeout(() => c.textContent = "Copiar", 1500); });
  };

  // Compilación y vista previa del PDF
  const busy = on => { const c = $("co"); if (!c) return; c.classList.toggle("busy", on); c.querySelector(".spin").hidden = !on; c.querySelector(".cl").textContent = on ? "Compilando" : "Compilar"; };
  let quick = lsGet("rapida:" + id, false), partial = null;
  const paintQk = () => { const b = $("qk"); if (b) { b.classList.toggle("on", quick); b.setAttribute("aria-pressed", quick); } };
  async function compile() {
    if (!$("pv")) return;   // ya saliste del proyecto
    if (compiling) { again = true; return; }
    compiling = true; busy(true); $("cs").textContent = "Compilando…";
    try {
      const r = await fetch("/api/compile", {method: "POST", headers: H, body: JSON.stringify({project: id, path: cur, text: view?.state.doc.toString(), only: quick && cur && /\.tex$/i.test(cur) ? cur : undefined})});
      const j = await r.json();
      partial = j.partial || null;
      if (!$("pv")) { compiling = false; busy(false); return; }   // ya saliste del proyecto
      compiledFile = j.main || null;
      const which = (compiledFile && compiledFile !== mainFile ? ` · ${compiledFile}` : "") + (partial ? ` · vista rápida de ${partial.only}` : "");
      if (j.pdf) {
        const bytes = Uint8Array.from(atob(j.pdf), c => c.charCodeAt(0));
        pdfBytes = bytes; syncOk = !!j.sync;
        try { await viewer.load(bytes); if (pdfWant) { const w = pdfWant; viewer.setState(w); setTimeout(() => { if (pdfWant === w) { viewer.setState(w); pdfWant = null; } }, 500); } $("pgs").textContent = viewer.pages ? `${viewer.pages} ${viewer.pages === 1 ? "página" : "páginas"}` : ""; } catch (e) { console.warn(e); }
        if (!$("pv")) { compiling = false; busy(false); return; }
        if (!partial && compiledFile === mainFile && j.pdf) viewer.thumb(240).then(img => img && fetch(`/api/projects/${id}/thumb`, {method: "POST", headers: H, body: JSON.stringify({img})})).catch(() => {});
        $("dpdf").disabled = false; $("dpdf").title = `Descargar el PDF que se muestra (${compiledFile || mainFile})`; $("fw").disabled = !syncOk;
        const n = showLog(j.log, true); wcNow(); xref(true);
        $("cs").textContent = (n ? `Listo, con ${n} ${n === 1 ? "error" : "errores"} · ` : "Listo · ") + new Date().toLocaleTimeString("es") + which;
      } else { const n = showLog(j.log || "Error al compilar", false); $("cs").textContent = (n ? `Con ${n} ${n === 1 ? "error" : "errores"}` : "Con errores") + which; }
    } catch (e) { console.error("compile", e); showLog("No se pudo contactar con el servidor.", false); $("cs").textContent = ""; }
    compiling = false; busy(false);
    if (again) { again = false; compile(); }
  }
  $("co").onclick = compile;
  $("qk").onclick = () => { quick = !quick; lsSet("rapida:" + id, quick); paintQk(); compile(); };
  paintQk();

  // ---------- Corrector ortográfico: idiomas y diccionario personal ----------
  const paintSp = () => { const c = getSpell(); $("sp").classList.toggle("on", c.on && c.langs.length); $("sp").textContent = c.on && c.langs.length ? "Ortografía · " + c.langs.map(l => l.slice(0, 2).toUpperCase()).join("·") : "Ortografía (apagada)"; };
  paintSp();
  $("sp").onclick = () => modal(`<h3>Corrector ortográfico</h3>
    <label class="spr"><input type="checkbox" id="spon"> <b>Revisar la ortografía mientras escribo</b></label>
    <h4>Idiomas</h4><div id="spl" class="spl">${Object.entries(LANGS).map(([k, v]) => `<label><input type="checkbox" data-l="${k}"> ${esc(v)}</label>`).join("")}</div>
    <small>Una palabra se da por buena si es correcta en cualquiera de los idiomas marcados. Solo se revisa el texto: no los comandos, las fórmulas, los comentarios ni las claves de \\cite o \\ref. Clic derecho sobre una palabra subrayada para ver sugerencias.</small>
    <small id="spf" class="spw"></small>
    <h4>Mi diccionario</h4><div id="spw" class="tgs"></div>
    <div class="acts"><button id="spc" class="pr">Listo</button></div>`, (md, close) => {
    const c = getSpell(); md.querySelector("#spon").checked = c.on;
    md.querySelectorAll("[data-l]").forEach(i => i.checked = c.langs.includes(i.dataset.l));
    const save = () => { setSpell({on: md.querySelector("#spon").checked, langs: [...md.querySelectorAll("[data-l]")].filter(i => i.checked).map(i => i.dataset.l)}); paintSp(); };
    md.querySelector("#spon").onchange = save; md.querySelectorAll("[data-l]").forEach(i => i.onchange = save);
    const words = () => { const w = personalWords(); md.querySelector("#spw").innerHTML = w.length ? w.map(x => `<span class="tg" style="--h:210">${esc(x)}<button data-x="${esc(x)}" aria-label="Quitar ${esc(x)}">×</button></span>`).join("") : "<small>Vacío. Con clic derecho en una palabra subrayada puedes añadirla aquí.</small>"; };
    words(); md.querySelector("#spw").onclick = e => { const x = e.target.dataset?.x; if (x) { removeWord(x); words(); } };
    setTimeout(() => { if (spellState.failed.length) md.querySelector("#spf").textContent = "No se pudo cargar el diccionario de: " + spellState.failed.map(l => LANGS[l]).join(", ") + ". ¿Ejecutaste «npm install»?"; }, 600);
    md.querySelector("#spc").onclick = close; md.querySelector("#spc").focus();
  });
  $("zp").onclick = () => exportZip(id, info.name);
  // El PDF que se descarga es el que muestra el visor (el del archivo compilado); si no es el principal, su nombre lo dice
  const pdfName = () => { const f = (compiledFile && compiledFile !== mainFile ? " - " + compiledFile.replace(/\.tex$/i, "").split("/").pop() : "") + (partial ? " (parcial)" : ""); return slug(info.name + f) + ".pdf"; };
  $("dpdf").onclick = () => { if (pdfBytes) saveBlob(new Blob([pdfBytes], {type: "application/pdf"}), pdfName()); };
  $("zi").onclick = () => viewer.zoomBy(1.2); $("zo").onclick = () => viewer.zoomBy(1 / 1.2);


  // ---------- Buscar en el PDF ----------
  {
    const box = document.createElement("div"); box.className = "pdfsearch"; box.hidden = true;
    box.innerHTML = `<input type="search" id="sqi" placeholder="Buscar en el PDF…" aria-label="Buscar en el PDF" autocomplete="off"><span id="sqc" aria-live="polite"></span><button id="sqp" aria-label="Anterior" title="Anterior (Mayús+Enter)">↑</button><button id="sqn" aria-label="Siguiente" title="Siguiente (Enter)">↓</button><button id="sqx" aria-label="Cerrar la búsqueda" title="Cerrar (Esc)">×</button>`;
    $("pdf").appendChild(box);
    const inp = box.querySelector("#sqi"), cnt = box.querySelector("#sqc");
    paintSearch = r => { cnt.textContent = !inp.value.trim() ? "" : r.count ? `${r.index + 1} de ${r.count}` : "Sin resultados"; };
    let t = 0;
    const run = () => viewer.search(inp.value).then(paintSearch);
    const open = () => { if (lay.hide.pdf) { lay.hide.pdf = false; saveLay(); applyLay(); } box.hidden = false; inp.focus(); inp.select(); if (inp.value && !cnt.textContent) run(); };
    const close = () => { box.hidden = true; viewer.clearSearch(); cnt.textContent = ""; $("pv").focus(); };
    inp.oninput = () => { clearTimeout(t); t = setTimeout(run, 180); };
    inp.onkeydown = e => {
      if (e.key === "Enter") { e.preventDefault(); paintSearch(e.shiftKey ? viewer.prev() : viewer.next()); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    };
    $("pdf").addEventListener("keydown", e => { if (e.key === "Escape" && !box.hidden && !document.querySelector(".modal")) { e.preventDefault(); e.stopPropagation(); close(); } });
    box.querySelector("#sqn").onclick = () => paintSearch(viewer.next()); box.querySelector("#sqp").onclick = () => paintSearch(viewer.prev());
    box.querySelector("#sqx").onclick = close; $("sq").onclick = () => box.hidden ? open() : close();
    // ⌘F / Ctrl+F busca en el PDF si el último clic fue en él; en el editor sigue buscando en el código
    let pdfActive = false;
    addEventListener("pointerdown", e => { pdfActive = !!e.target.closest?.("#pdf"); }, true);
    const onFind = e => { if (pdfActive && !histMode && (mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f" && !document.querySelector(".modal")) { e.preventDefault(); e.stopPropagation(); open(); } };
    document.addEventListener("keydown", onFind, true);
    const prevC = cleanup; cleanup = () => { prevC(); document.removeEventListener("keydown", onFind, true); };
  }
  // ---------- Saltar entre el código y el PDF (SyncTeX) ----------
  let syncMsgT = 0;
  const syncMsg = t => { const c = $("cs"); if (!c) return; const prev = c.dataset.keep ?? c.textContent; c.dataset.keep = prev; c.textContent = t; clearTimeout(syncMsgT); syncMsgT = setTimeout(() => { c.textContent = c.dataset.keep; delete c.dataset.keep; }, 3000); };
  const post = (u, body) => fetch("/api" + u, {method: "POST", headers: H, body: JSON.stringify(body)}).then(r => r.json().catch(() => ({})));
  async function toPdf() {
    if (!viewer.ready || !syncOk) return syncMsg("Compila primero para poder saltar al PDF");
    if (!view) return;
    const pos = view.state.selection.main.head, ln = view.state.doc.lineAt(pos);
    const r = await post("/synctex/forward", {project: id, file: cur, line: ln.number, col: pos - ln.from});
    if (!$("pv")) return;
    if (r.error) return syncMsg(r.error);
    if (r.none) return syncMsg("Esa línea no genera nada visible en el PDF");
    if (histMode) setHist(false);
    if (lay.hide.pdf) { lay.hide.pdf = false; saveLay(); applyLay(); await new Promise(res => setTimeout(res, 80)); }
    viewer.show(r);
  }
  async function toCode(p) {
    if (!syncOk) return syncMsg("Compila primero para poder saltar al código");
    const r = await post("/synctex/inverse", {project: id, ...p});
    if (!$("pv")) return;
    if (r.error) return syncMsg(r.error);
    if (r.none) return syncMsg(r.outside ? "Ese texto no viene de un archivo de tu proyecto" : "No encontré ese punto en el código");
    if (lay.hide.ed) { lay.hide.ed = false; saveLay(); applyLay(); }
    goTo(r.file, r.line);
  }
  viewer.onPoint = toCode;
  $("fw").onclick = toPdf;


  // ---------- Asistente de Claude ----------
  // Lanza tu Claude Code local sobre una copia del proyecto; los cambios llegan como propuesta y tú aceptas o rechazas cada archivo.
  let agOn = false, agBusy = false, agJob = null, agItems = [], agStatus = null, agDead = false, lastErrors = "", agSelSig = "";

  // ---------- Tamaño y visibilidad de los paneles (se recuerdan entre sesiones) ----------
  const LAY0 = {tr: 212, ed: 1, pdf: 1, ag: 360};
  let lay = {...LAY0, hide: {}};
  try { const o = JSON.parse(localStorage.layout || "{}"); for (const k of Object.keys(LAY0)) if (Number.isFinite(o[k]) && o[k] > 0) lay[k] = o[k]; lay.hide = {tr: !!o.hide?.tr, ed: !!o.hide?.ed, pdf: !!o.hide?.pdf}; } catch {}
  const saveLay = () => { try { localStorage.layout = JSON.stringify(lay); } catch {} };
  const GUT = 7, MINP = 140;
  function applyLay() {
    const P = $("proj"), hist = P.classList.contains("hist"), h = lay.hide;
    const tr = !h.tr, ed = hist || !h.ed, pdf = hist || !h.pdf, both = ed && pdf && !hist;
    const c = (on, v) => on ? v : "0px";
    P.style.gridTemplateColumns = [c(tr, lay.tr + "px"), c(tr && (ed || pdf), GUT + "px"), c(ed, `minmax(0,${lay.ed}fr)`), c(both, GUT + "px"), c(pdf, `minmax(0,${lay.pdf}fr)`), c(agOn, GUT + "px"), c(agOn, lay.ag + "px")].join(" ");
    P.classList.toggle("h-tr", !tr); P.classList.toggle("h-ed", !ed); P.classList.toggle("h-pdf", !pdf);
    $("g1").hidden = !(tr && (ed || pdf)); $("g2").hidden = !both; $("g3").hidden = !agOn;
    for (const [b, on] of [["vtr", tr], ["ved", !h.ed], ["vpdf", !h.pdf]]) { $(b).classList.toggle("on", on); $(b).setAttribute("aria-pressed", on); }
    requestAnimationFrame(() => view?.requestMeasure());
  }
  function togglePane(k) {
    const h = lay.hide;
    if (!h[k] && k !== "tr" && h[k === "ed" ? "pdf" : "ed"]) return;   // siempre queda visible el código o el PDF
    h[k] = !h[k]; saveLay(); applyLay();
  }
  $("vtr").onclick = () => togglePane("tr"); $("ved").onclick = () => togglePane("ed"); $("vpdf").onclick = () => togglePane("pdf");
  // Arrastrar (o usar las flechas) en cada divisor
  function gutter(el, get, set, reset) {
    el.addEventListener("pointerdown", e => {
      if (e.button) return; e.preventDefault(); el.setPointerCapture(e.pointerId);
      const x0 = e.clientX, st = get(); $("proj").classList.add("dragging"); el.classList.add("on");
      const mv = ev => { set(st, ev.clientX - x0); applyLay(); };
      const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); $("proj").classList.remove("dragging"); el.classList.remove("on"); saveLay(); };
      el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
    el.addEventListener("dblclick", () => { reset(); saveLay(); applyLay(); });
    el.addEventListener("keydown", e => {
      const d = e.key === "ArrowLeft" ? -24 : e.key === "ArrowRight" ? 24 : 0; if (!d) return;
      e.preventDefault(); const st = get(); set(st, d * (e.shiftKey ? 4 : 1)); saveLay(); applyLay();
    });
  }
  const wpx = id => $(id).getBoundingClientRect().width;
  gutter($("g1"), () => ({tr: lay.tr}), (st, dx) => { lay.tr = Math.round(Math.max(110, Math.min(st.tr + dx, innerWidth * 0.6))); }, () => { lay.tr = LAY0.tr; });
  gutter($("g2"), () => ({e: wpx("ed"), p: wpx("pdf")}), (st, dx) => {
    const tot = st.e + st.p, e = Math.max(MINP, Math.min(st.e + dx, tot - MINP));
    lay.ed = e; lay.pdf = tot - e;   // fr proporcionales a los píxeles
  }, () => { lay.ed = lay.pdf = 1; });
  gutter($("g3"), () => ({a: lay.ag}), (st, dx) => { lay.ag = Math.round(Math.max(260, Math.min(st.a - dx, innerWidth * 0.6))); }, () => { lay.ag = LAY0.ag; });
  applyLay();
  let agChat = null, agTitle = "", agMode = "chat", agList = [], agSig = "", agSaveT = null, agLoaded = false;
  const agSel = new Set(), agQueue = [], agThrOpen = new Set(), agDraft = {}, agPts = new Map(); let agLaunching = false;
  const KIND = {mod: "✎", new: "＋ nuevo", del: "✕ eliminar"};
  const CHIPS = [["Corregir ortografía", "Corrige la ortografía, la gramática y la puntuación, sin cambiar el estilo ni el contenido."],
    ["Mejorar redacción", "Mejora la claridad y la redacción, conservando el significado y el tono."],
    ["Traducir al inglés", "Traduce al inglés, conservando todos los comandos de LaTeX."],
    ["Arreglar errores", "Arregla los errores de compilación."]];
  const selection = () => {
    if (!view) return null;
    const r = view.state.selection.main; if (r.empty) return null;
    const d = view.state.doc;
    return {from: d.lineAt(r.from).number, to: d.lineAt(r.to).number, text: d.sliceString(r.from, r.to)};
  };
  function selInfo() {
    const s = selection(), sig = s ? `${cur}:${s.from}-${s.to}` : "";
    if (sig === agSelSig) return; agSelSig = sig;
    $("agsl").hidden = !s;
    if (s) $("agst").textContent = s.from === s.to ? `Enviar la selección (línea ${s.from})` : `Enviar la selección (líneas ${s.from}–${s.to})`;
  }
  function drawChips() {
    $("agc").innerHTML = CHIPS.filter(c => c[0] !== "Arreglar errores" || lastErrors).map((c, i) => `<button class="chip" data-chip="${i}">${esc(c[0])}</button>`).join("");
  }
  const mdCache = new Map();                       // el panel se redibuja cada segundo mientras trabaja: no se vuelve a convertir lo ya convertido
  const mdOf = t => { let h = mdCache.get(t); if (h == null) { try { h = renderMd(t); } catch { h = esc(t).replace(/\n/g, "<br>"); } if (mdCache.size > 200) mdCache.clear(); mdCache.set(t, h); } return h; };
  // Referencias a archivo y línea en las respuestas del asistente («main.tex:42», «main.tex, línea 42», «líneas 10–15 de cap/uno.tex») → enlaces que llevan allí
  const PATHRE = "[\\w.\\-/]+\\.(?:tex|bib|sty|cls|ltx|txt|md)", RANGE = "(\\d+)(?:\\s*(?:[-–—]|\\ba\\b|\\by\\b)\\s*(\\d+))?";
  const REF_A = new RegExp(`(${PATHRE})\\s*(?:\\(\\s*)?(?::|,?\\s*(?:en\\s+la\\s+)?l[ií]neas?\\s*)${RANGE}`, "giu");
  const REF_B = new RegExp(`l[ií]neas?\\s*${RANGE}\\s*(?:de(?:l)?|en)\\s+(?:el\\s+archivo\\s+)?[\`“"«]?(${PATHRE})`, "giu");
  // «cap. 4, l.389-395 y 432», «(l.950 y l.1183)», «línea 12»: sin nombre de archivo; el archivo sale del «cap. N» (nombre del archivo) o del contexto
  const LW = "(?:l[ií]neas?|l[ií]ns?\\.|ln\\.|l\\.)", NUM = "\\d+(?:\\s*[-–—]\\s*\\d+)?";
  const REF_C = new RegExp(`(?<![\\p{L}\\d_])(?:\\bcap(?:[ií]tulo)?s?\\.?\\s*(\\d+)\\s*[,;:]?\\s*)?(?<![\\p{L}\\d_])${LW}\\s*(\\d+)(?:\\s*[-–—]\\s*(\\d+))?((?:\\s*(?:,|;|\\by\\b|\\be\\b)\\s*(?:${LW}\\s*)?${NUM})*)`, "giud");
  const CAPG = /(?<![\p{L}\d_])cap(?:[ií]tulo)?s?\.?\s*(\d+)/giu;
  const fold = x => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const resolveRef = p => { p = p.replace(/^\.\//, ""); if (files.some(f => f.path === p)) return p; const m = files.filter(f => f.path.endsWith("/" + p)); return m.length === 1 ? m[0].path : null; };
  const chapterFile = n => {                                    // «cap. 4» → capitulo-4-….tex (solo si es único)
    const re = new RegExp(`(^|[^a-z0-9])(cap|capitulo|chapter|ch)[-_ ]*0*${n}([^0-9]|$)`);
    const m = files.filter(f => f.kind === "text" && /\.tex$/i.test(f.path) && re.test(fold(f.path.split("/").at(-1))));
    return m.length === 1 ? m[0].path : null;
  };
  function ctxChapter(root, node, idx) {                        // último «cap. N» mencionado antes, dentro del mismo elemento (o de los que lo contienen)
    for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
      if (!/^(LI|P|TD|TH|BLOCKQUOTE)$/.test(el.tagName)) continue;
      const r = document.createRange(); r.setStart(el, 0); r.setEnd(node, idx);
      const m = [...r.toString().matchAll(CAPG)].at(-1); if (m) return +m[1];
    }
    return null;
  }
  function linkRefs(root) {
    const only = files.filter(f => f.kind === "text" && /\.tex$/i.test(f.path));
    for (const el of root.querySelectorAll(".ab.md")) {
      let prev = el.previousElementSibling; while (prev && !prev.classList.contains("ub")) prev = prev.previousElementSibling;
      const asked = prev?.dataset.file && files.some(f => f.path === prev.dataset.file) ? prev.dataset.file : (only.length === 1 ? only[0].path : null);   // archivo abierto cuando se hizo la petición
      const nodes = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) if (!n.parentElement.closest("a,pre,button,.katex")) nodes.push(n);
      for (const node of nodes) {
        const t = node.data, hits = [];
        for (const m of t.matchAll(REF_A)) hits.push({i: m.index, len: m[0].length, f: resolveRef(m[1]), a: +m[2], b: m[3] ? +m[3] : null});
        for (const m of t.matchAll(REF_B)) hits.push({i: m.index, len: m[0].length, f: resolveRef(m[3]), a: +m[1], b: m[2] ? +m[2] : null});
        for (const m of t.matchAll(REF_C)) {
          const capN = m[1] ? +m[1] : ctxChapter(root, node, m.index);
          const fb = capN != null ? (chapterFile(capN) || (only.length === 1 ? only[0].path : null)) : asked;
          if (!fb) continue;
          const first = m.indices[3] || m.indices[2];
          hits.push({i: m.index, len: first[1] - m.index, f: fb, a: +m[2], b: m[3] ? +m[3] : null});
          if (m[4]) { const base = m.indices[4][0]; for (const c of m[4].matchAll(/(\d+)(?:\s*[-–—]\s*(\d+))?/g)) hits.push({i: base + c.index, len: c[0].length, f: fb, a: +c[1], b: c[2] ? +c[2] : null}); }
        }
        hits.sort((x, y) => x.i - y.i || y.len - x.len);
        const ok = []; let end = 0;
        for (const h of hits) if (h.f && h.i >= end && h.a >= 1) { ok.push(h); end = h.i + h.len; }
        if (!ok.length) continue;
        const frag = document.createDocumentFragment(); let pos = 0;
        for (const h of ok) {
          frag.append(t.slice(pos, h.i));
          const a = document.createElement("a"); a.className = "ref"; a.href = "#"; a.dataset.f = h.f; a.dataset.l = h.a; if (h.b && h.b > h.a) a.dataset.to = h.b;
          a.title = `Ir a ${h.f}, línea ${h.a}${h.b && h.b > h.a ? "–" + h.b : ""}`; a.textContent = t.slice(h.i, h.i + h.len);
          frag.append(a); pos = h.i + h.len;
        }
        frag.append(t.slice(pos)); node.replaceWith(frag);
      }
    }
  }
  // Un elemento de la conversación (también los de los hilos anidados). ref: «3» (principal) o «3/clave/2» (dentro del hilo de un punto)
  function renderItem(it, ref, last) {
    if (it.t === "user") return `<div class="ub"${it.file ? ` data-file="${esc(it.file)}"` : ""}>${esc(it.show ?? it.text)}${it.att?.length ? `<small>Adjuntos: ${it.att.map(esc).join(", ")}</small>` : ""}${it.sel ? `<small>Selección: líneas ${esc(it.sel)}</small>` : ""}</div>`;
    if (it.t === "run") return `<div class="rb"><span class="spin"></span> Trabajando…<ul>${it.activity.slice(-4).map(a => `<li>${esc(a)}</li>`).join("")}</ul></div>`;
    if (it.t === "reply") return `<div class="ab md" data-n="${ref}">${mdOf(it.text)}</div>`;
    if (it.t === "check") {
      const main = esc(it.main || "");
      if (it.state === "ok") return `<div class="ck ok">✓ Comprobé que con estos cambios <b>${main}</b> compila sin errores.</div>`;
      const list = (it.errors || []).map(e => `<li>${esc(e)}</li>`).join("");
      if (it.state === "same") return `<div class="ck">Con estos cambios <b>${main}</b> sigue teniendo los errores que ya tenía (no los causan estos cambios).<ul>${list}</ul></div>`;
      return `<div class="ck bad">⚠ Con estos cambios <b>${main}</b> ${it.nopdf ? "no compila" : "compila con errores"}. Revísalos antes de aceptar:<ul>${list}</ul></div>`;
    }
    if (it.t === "err") return `<div class="eb">${esc(it.text).replace(/\n/g, "<br>")}</div>`;
    if (it.t === "warn") return `<div class="wb">⚠ ${esc(it.text)}${last && !agBusy ? `<div><button data-act="retry" data-n="${ref}">Pedirle que lo haga en el archivo</button></div>` : ""}</div>`;
    const todo = it.changes.some(c => !c.applied && !c.rejected);
    return `<div class="pc"><div class="ph">Cambios propuestos · ${it.changes.length} ${it.changes.length === 1 ? "archivo" : "archivos"}</div>${it.changes.map((c, i) => `
      <div class="pw${c.applied ? " ok" : c.rejected ? " no" : ""}"><div class="pn"><span class="pk">${KIND[c.kind]}</span> <b>${esc(c.path)}</b>
        <span class="m"><span class="ad">+${c.add}</span> <span class="rm">−${c.del}</span></span></div>
        ${c.conflict ? `<div class="cf">Este archivo cambió mientras el asistente trabajaba y sus cambios tocan las mismas líneas que los tuyos. Aplicarlo sobrescribiría esos cambios.</div>` : ""}
        <div class="pa">${c.applied ? "<span class='ad'>Aplicado ✓</span>" : c.rejected ? "<span class='m'>Rechazado</span>"
          : `<button data-act="view" data-n="${ref}" data-i="${i}">Ver cambios</button><button class="pr" data-act="${c.conflict ? "force" : "ok"}" data-n="${ref}" data-i="${i}">${c.conflict ? "Aplicar de todos modos" : "Aceptar"}</button><button data-act="no" data-n="${ref}" data-i="${i}">Rechazar</button>`}</div></div>`).join("")}
      ${todo && it.changes.filter(c => !c.applied && !c.rejected).length > 1 ? `<div class="pf"><button class="pr" data-act="okall" data-n="${ref}">Aceptar todo</button><button data-act="noall" data-n="${ref}">Rechazar todo</button></div>` : ""}</div>`;
  }
  function drawChat() {
    const box = $("agl"), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const ae = document.activeElement, keep = ae && ae.dataset && ae.dataset.thin != null && box.contains(ae) ? {k: ae.dataset.thin, s: ae.selectionStart, e: ae.selectionEnd} : null;
    box.innerHTML = agItems.length ? agItems.map((it, n) => renderItem(it, String(n), n === agItems.length - 1)).join("") : `<div class="agh0"><p>Pídeme cambios en tu documento: corregir, reescribir, traducir, arreglar errores de compilación…</p><p>Si seleccionas texto en el editor, trabajo solo sobre esa selección. Nada se modifica hasta que aceptes los cambios.</p></div>`;
    linkRefs(box); addImpl(box);
    for (const t of box.querySelectorAll("textarea[data-thin]")) t.value = agDraft[t.dataset.thin] || "";
    if (keep) { const t = [...box.querySelectorAll("textarea[data-thin]")].find(x => x.dataset.thin === keep.k); if (t) { t.focus({preventScroll: true}); try { t.setSelectionRange(keep.s, keep.e); } catch {} } }
    if (atEnd) box.scrollTop = box.scrollHeight;
    $("ags").textContent = agBusy ? "Detener" : "Enviar"; $("ags").classList.toggle("pr", !agBusy);
    $("agi").disabled = agStatus ? !agStatus.available : false; if (agStatus && !agStatus.available) $("ags").disabled = true;
    drawSb();
  }
  // Estado de un punto de la revisión según su hilo
  function thState(th) {
    if (!th) return null;
    if (agQueue.some(q => q.th === th)) return {c: "q", t: "En cola"};
    if (th.items.some(i => i.t === "run")) return {c: "run", t: "Trabajando…"};
    const prop = [...th.items].reverse().find(i => i.t === "prop");
    if (prop) {
      const pend = prop.changes.filter(c => !c.applied && !c.rejected), add = pend.reduce((a, c) => a + c.add, 0), del = pend.reduce((a, c) => a + c.del, 0);
      if (pend.length) return {c: "pend", t: `Propuesta lista · +${add} −${del}`};
      return prop.changes.some(c => c.applied) ? {c: "ok", t: "Aplicada ✓"} : {c: "no", t: "Rechazada"};
    }
    const last = th.items.at(-1); if (!last) return null;
    return last.t === "err" ? {c: "err", t: "Error"} : last.t === "warn" ? {c: "warn", t: "Sin cambios"} : last.t === "reply" ? {c: "ok", t: "Respondido"} : null;
  }
  function renderThread(ref, th) {
    const q = agQueue.some(x => x.th === th);
    return `<div class="thh">Hilo de este punto${q ? " · en cola" : ""}</div>${th.items.map((it, i) => renderItem(it, ref + "/" + i, i === th.items.length - 1)).join("")}${q && !th.items.length ? `<div class="rb">En cola: empezará cuando termine el trabajo actual.</div>` : ""}<div class="thc"><textarea rows="2" data-thin="${ref}" placeholder="Seguir conversando sobre este punto…"></textarea><button class="pr" data-thsend="${ref}">Enviar</button></div>`;
  }
  // Botones «Implementar» bajo cada sugerencia (elemento de lista) de las respuestas del asistente, con su hilo anidado
  function addImpl(root) {
    const own = li => { const c = li.cloneNode(true); c.querySelectorAll("ul,ol,.impl,.implbox,.thr").forEach(x => x.remove()); return c.textContent.replace(/\s+/g, " ").trim(); };
    const full = li => { const c = li.cloneNode(true); c.querySelectorAll(".impl,.implbox,.thr").forEach(x => x.remove()); return c.textContent.replace(/\s+/g, " ").trim(); };
    agPts.clear();
    for (const md of [...root.querySelectorAll(".ab.md")].filter(m => !m.closest(".thr"))) {
      const n = md.dataset.n, rep = agItems[+n], lis = [...md.querySelectorAll("li")], taken = new Set(); let count = 0;
      for (const li of lis) {
        if (li.closest("table")) continue;
        const nested = li.querySelector("li");
        if (own(li).length < (nested ? 40 : 30)) continue;
        if ([...taken].some(t => t.contains(li))) continue;
        taken.add(li); count++;
        let head = ""; for (let el = li; el && el !== md; el = el.parentElement) { let p = el.previousElementSibling; while (p) { if (/^H[1-6]$/.test(p.tagName)) { head = p.textContent.trim(); break; } p = p.previousElementSibling; } if (head) break; }
        const txt = full(li), key = hashTxt(txt), pk = n + "|" + key, st = rep?.done?.[key], th = rep?.threads?.[key], sta = thState(th), isOpen = agThrOpen.has(pk);
        agPts.set(pk, {n, key, txt, head});
        const bar = document.createElement("span"); bar.className = "impl" + (sta ? " act" : ""); bar.dataset.head = head; bar.dataset.txt = txt; bar.dataset.key = key; bar.dataset.n = n;
        if (st) li.classList.add("atendida");
        if (agSel.has(pk)) li.classList.add("elegida");
        bar.innerHTML = `<label class="sel" title="Elegir este punto para implementar varios a la vez"><input type="checkbox" data-sel="1"${agSel.has(pk) ? " checked" : ""}> Elegir</label><label class="atd" title="Marca esta sugerencia como atendida"><input type="checkbox" data-atd="1"${st ? " checked" : ""}> ${st ? (st === "impl" ? "✓ Atendida · implementada" : "✓ Atendida") : "Atendida"}</label><button data-impl="1" title="Pedir al asistente que haga este cambio">Implementar</button><button data-impl="2" title="Implementar añadiendo tus indicaciones">Con comentarios…</button>`
          + (th && (th.items.length || sta) ? `<button data-thr="1" class="thb${sta ? " " + sta.c : ""}" title="${isOpen ? "Ocultar" : "Mostrar"} el hilo de este punto">${isOpen ? "▾" : "▸"} Hilo${sta ? " · " + esc(sta.t) : ""}</button>` : "");
        const ul = li.querySelector(":scope > ul, :scope > ol"); ul ? li.insertBefore(bar, ul) : li.appendChild(bar);
        if (th && isOpen) {
          const box = document.createElement("div"); box.className = "thr"; box.dataset.ref = pk.replace("|", "/"); box.innerHTML = renderThread(box.dataset.ref, th);
          bar.after(box); linkRefs(box);
        }
      }
      if (count > 1) { const h = document.createElement("div"); h.className = "selall"; h.innerHTML = `<button data-selall="${n}">Elegir todos los pendientes</button>`; md.prepend(h); }
    }
  }
  const hashTxt = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  function markDone(bar, how) {
    const item = agItems[+bar.closest(".ab.md")?.dataset.n]; if (!item || !bar.dataset.key) return;
    item.done ||= {};
    if (how) item.done[bar.dataset.key] = how; else delete item.done[bar.dataset.key];
    if (!Object.keys(item.done).length) delete item.done;
  }
  // Cola de trabajo: el asistente atiende una petición a la vez; varios puntos elegidos se hacen uno tras otro, cada uno en su hilo
  function agEnqueue(item) {
    if (!agStatus?.available) return flash("El asistente no está disponible.");
    if (agQueue.some(q => q.th === item.th && q.text === item.text)) return;
    agQueue.push(item); drawAg(); agNext();
  }
  function enqueueImpl(pks, extra) {
    for (const pk of pks) {
      const p = agPts.get(pk); if (!p) continue;
      const rep = agItems[+p.n]; if (!rep) continue;
      rep.threads ||= {}; const th = rep.threads[p.key] ||= {txt: p.txt, head: p.head, items: []};
      rep.done ||= {}; rep.done[p.key] = "impl"; agThrOpen.add(pk); agSel.delete(pk);
      const text = `Implementa ahora, editando los archivos, esta sugerencia de tu respuesta anterior${p.head ? ` (sección «${p.head}»)` : ""}:\n\n> ${p.txt}\n\n${extra ? `Indicaciones mías: ${extra}\n\n` : ""}Haz solo este cambio y nada más.`;
      agEnqueue({th, rep, ref: pk.replace("|", "/"), text, show: "Implementar este punto" + (extra ? ` · ${extra}` : "")});
    }
    drawAg();
  }
  function threadMsg(ref, text) {
    const [n, key] = ref.split("/"), rep = agItems[+n], th = rep?.threads?.[key]; text = String(text || "").trim();
    if (!th || !text) return;
    delete agDraft[ref]; agEnqueue({th, rep, ref, text, show: null});
  }
  function agNext() {
    if (agBusy || agLaunching) return;
    const q = agQueue.shift(); if (!q) return drawAg();
    agSend(q.text, false, true, {items: q.th.items, ref: q.ref, show: q.show, history: () => [{role: "assistant", text: q.rep.text}, ...agHistory(q.th.items)]});
  }
  function commentModal(pks) {
    modal(`<h3>Implementar ${pks.length === 1 ? "este punto" : pks.length + " puntos"} con indicaciones</h3><p class="m">Tus indicaciones se añaden a ${pks.length === 1 ? "la petición" : "cada una de las peticiones"} (p. ej. «usa el paquete verbatim», «déjalo más breve»).</p><textarea id="cmx" rows="4" style="width:100%;box-sizing:border-box" placeholder="Indicaciones…"></textarea><div class="acts"><button id="cmc">Cancelar</button><button id="cmg" class="pr">Implementar</button></div>`, (md, close) => {
      const ta = md.querySelector("#cmx"); ta.focus();
      md.querySelector("#cmc").onclick = close;
      md.querySelector("#cmg").onclick = () => { const x = ta.value.trim(); close(); enqueueImpl(pks, x); };
    });
  }
  // Barra de puntos elegidos
  function drawSb() {
    const k = agSel.size, sb = $("agsb"); sb.hidden = !k || agMode === "list"; if (sb.hidden) return;
    sb.innerHTML = `<span><b>${k}</b> ${k === 1 ? "punto elegido" : "puntos elegidos"}</span><button class="pr" data-sb="go">Implementar${k > 1 ? " elegidos" : ""}</button><button data-sb="cm">Con comentarios…</button><button data-sb="clr">Quitar selección</button>`;
  }
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const strip = (items, forSig) => items.map(i => i.t === "run" ? (forSig ? {t: "run", job: i.job} : {t: "run", job: i.job, activity: []})
    : i.threads ? {...i, threads: Object.fromEntries(Object.entries(i.threads).map(([k, th]) => [k, {...th, items: strip(th.items, forSig)}]))} : i);
  const sigOf = () => JSON.stringify([agChat, agTitle, strip(agItems, true)]);
  function drawList() {
    const box = $("agl");
    box.innerHTML = `<button class="pr" data-chatnew="1">＋ Nueva conversación</button>` + (agList.length ? agList.map(c => `
      <div class="cr${c.id === agChat ? " on" : ""}" data-chat="${esc(c.id)}"><div class="ct"><b>${esc(c.title || "Conversación")}</b><small>${esc(when(c.updated))} · ${c.n} ${c.n === 1 ? "mensaje" : "mensajes"}</small></div>
        <button class="x2" data-chatdel="${esc(c.id)}" title="Borrar esta conversación" aria-label="Borrar esta conversación">🗑</button></div>`).join("")
      : `<div class="agh0"><p>Aún no hay conversaciones guardadas en este proyecto.</p></div>`);
    box.scrollTop = 0;
  }
  function drawAg() {
    $("ag").classList.toggle("lv", agMode === "list"); $("agls").textContent = agMode === "list" ? "← Volver" : "Conversaciones";
    $("agt").textContent = agMode === "list" ? "Conversaciones" : "✦ Asistente";
    if (agMode === "list") drawList(); else drawChat();
    drawSb();
    if (agLoaded && sigOf() !== agSig) { agSig = sigOf(); agSaveSoon(); }
  }
  // Guardado de la conversación en el servidor (por proyecto): se conserva al cerrar el panel, recargar o salir del proyecto.
  function agSaveSoon() { clearTimeout(agSaveT); agSaveT = setTimeout(agSaveNow, 500); }
  function agSaveNow(keep) {
    clearTimeout(agSaveT); agSaveT = null;
    if (!agChat || !agItems.some(i => i.t === "user")) return;
    fetch(`/api/chats/${agChat}`, {method: "PUT", headers: H, keepalive: !!keep,
      body: JSON.stringify({project: id, title: agTitle, items: strip(agItems)})})
      .then(() => agList.length && refreshList()).catch(() => {});
  }
  async function refreshList() { const l = await api(`/projects/${id}/chats`); if (Array.isArray(l)) { agList = l; if (agMode === "list") drawList(); } }
  function agNew() {
    if (agBusy) return;
    agSaveNow(); agChat = newId(); agTitle = ""; agItems = []; agMode = "chat"; agSel.clear(); agQueue.length = 0; agThrOpen.clear(); agSig = sigOf(); drawAg(); $("agi").focus();
  }
  const findRun = () => {
    for (const it of agItems) {
      if (it.t === "run") return {run: it, items: agItems};
      for (const [k, th] of Object.entries(it.threads || {})) { const r = th.items.find(x => x.t === "run"); if (r) { const pk = agItems.indexOf(it) + "|" + k; agThrOpen.add(pk); return {run: r, items: th.items}; } }
    }
    return null;
  };
  async function agOpen(chatId) {
    if (agBusy) return;
    agSaveNow();
    const c = await api(`/chats/${chatId}`);
    if (c.error) { alert(c.error); return refreshList(); }
    agChat = c.id; agTitle = c.title; agItems = c.items; agMode = "chat"; agSel.clear(); agQueue.length = 0; agThrOpen.clear(); agSig = sigOf(); drawAg();
    const fr = findRun(); if (fr) agWatch(fr.run, fr.items);
    $("agl").scrollTop = $("agl").scrollHeight;
  }
  let agInitP = null;
  function agInit() {                             // al abrir el panel por primera vez: la conversación más reciente de este proyecto (una sola vez; quien la necesite, la espera)
    return agInitP ||= (async () => {
      const l = await api(`/projects/${id}/chats`); agList = Array.isArray(l) ? l : [];
      agLoaded = true;
      if (agList.length) await agOpen(agList[0].id); else { agChat = newId(); agSig = sigOf(); drawAg(); }
    })();
  }
  async function fixWithAI(which) {
    if (agBusy) return;
    const list = which === "all" ? errList : [errList[+which]].filter(Boolean); if (!list.length) return;
    if (!agOn) setAg(true);
    await agCheck();
    if (list.length === 1) agSend(`Arregla este error de compilación de LaTeX, editando los archivos. Haz solo lo necesario para resolverlo:\n\n${list[0]}`, true, true);
    else agSend(`Arregla estos errores de compilación de LaTeX, editando los archivos. Haz solo lo necesario para resolverlos:\n\n${list.map(x => "- " + x).join("\n")}`, true, true);
  }
  async function agCheck() {
    if (agStatus?.available) return;
    agStatus = await api("/agent/status");
    $("agn").textContent = agStatus.available ? "" : agStatus.text || "El asistente no está disponible."; $("agn").hidden = !!agStatus.available;
    $("agv").textContent = agStatus.available ? agStatus.version || "" : "";
    drawAg();
  }
  function setAg(on) {
    agOn = on; $("proj").classList.toggle("ag", on); $("ab").classList.toggle("on", on); applyLay();
    if (on) { agCheck(); agInit(); agSelSig = "-"; selInfo(); drawChips(); drawAg(); $("agi").focus(); }
    requestAnimationFrame(() => view?.requestMeasure());
  }
  // Lo conversado hasta ahora, para que el asistente (que arranca de cero en cada petición) sepa de qué se habla y qué pasó con sus cambios
  function agHistory(items = agItems) {
    const out = [];
    items.forEach((it, n) => {
      if (it.t === "user") out.push({role: "user", text: it.text + (it.att?.length ? ` [adjuntó: ${it.att.join(", ")}]` : "")});
      else if (it.t === "reply") {
        out.push({role: "assistant", text: it.text});
        if (items[n + 1]?.t !== "prop") out.push({role: "note", text: "Con esa respuesta no se propuso ningún cambio en los archivos."});
        const ths = Object.values(it.threads || {}).filter(t => t.items.length);
        if (ths.length) out.push({role: "note", text: "Puntos de esa respuesta que se trabajaron en hilos aparte: " + ths.map(t => `«${t.txt.slice(0, 90)}» (${thState(t)?.t || "sin cambios"})`).join("; ")});
      } else if (it.t === "prop") out.push({role: "note", text: "Cambios propuestos: " + it.changes.map(c => `${c.path} (${c.applied ? "aceptado y aplicado" : c.rejected ? "rechazado" : "todavía sin aceptar"})`).join(", ")});
      else if (it.t === "warn" || it.t === "err") out.push({role: "note", text: it.text});
    });
    return out.slice(-40);
  }
  // Archivos adjuntos al mensaje (imágenes, PDF, texto): se leen en esta petición y no pasan al proyecto
  const agAtt = [];
  const ATT_OK = /\.(png|jpe?g|gif|webp|pdf|txt|tex|bib|csv|md)$/i;
  function drawAtt() {
    $("aga").innerHTML = agAtt.map((a, i) => `<span class="att">${a.url ? `<img src="${a.url}" alt="">` : ico("file-text", 13)}<span>${esc(a.name)}</span><button data-i="${i}" title="Quitar" aria-label="Quitar ${esc(a.name)}">×</button></span>`).join("");
  }
  async function addAtt(list) {
    for (const f of list) {
      const name = f.name && !/^image\.\w+$/i.test(f.name) ? f.name : `imagen-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.${imgExt(f.type) || "png"}`;
      if (!ATT_OK.test(name)) { alert(`«${name}» no se puede adjuntar. Usa imágenes, PDF o archivos de texto (.tex, .bib, .txt, .csv, .md).`); continue; }
      if (agAtt.length >= 6) { alert("Máximo 6 archivos por mensaje."); break; }
      if (agAtt.reduce((s, a) => s + a.size, 0) + f.size > 15e6) { alert("Los adjuntos no pueden pasar de 15 MB en total."); break; }
      agAtt.push({name, size: f.size, data: await toB64(f), url: f.type.startsWith("image/") && f.type !== "image/svg+xml" ? URL.createObjectURL(f) : ""});
    }
    drawAtt();
  }
  $("aga").onclick = e => { const i = e.target.dataset.i; if (i === undefined) return; const [a] = agAtt.splice(+i, 1); if (a?.url) URL.revokeObjectURL(a.url); drawAtt(); };
  $("agp").onclick = () => $("agfi").click();
  $("agfi").onchange = async e => { const l = [...e.target.files]; e.target.value = ""; if (l.length) await addAtt(l); $("agi").focus(); };
  $("agi").addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addAtt(fs); } });
  $("ag").addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
  $("ag").addEventListener("drop", e => { const fs = [...(e.dataTransfer?.files || [])]; if (!fs.length) return; e.preventDefault(); addAtt(fs); });
  async function agSend(text, withErr, noSel, tgt) {
    const att = text === undefined ? agAtt.map(a => ({name: a.name, data: a.data})) : [];
    text = String(text ?? $("agi").value).trim(); if (!text && att.length) text = "Mira lo que adjunto."; if (!text || agBusy || agLaunching || !agStatus?.available) return;
    agLaunching = true;
    try {
      await agInit();                                   // si el panel acaba de abrirse, primero carga la conversación actual (si no, la pisaría)
      if (agBusy) return;
      if (agMode === "list") { agMode = "chat"; drawAg(); }
      const items = tgt ? tgt.items : agItems;
      const sel = !noSel && $("agsel").checked ? selection() : null;
      const errs = lastErrors && (withErr || /error|compil|falla|arregl/i.test(text)) ? lastErrors : null;
      const history = tgt ? tgt.history() : agHistory();
      if (!agChat) agChat = newId();
      if (!tgt && !agTitle) agTitle = text.replace(/\s+/g, " ").slice(0, 60);
      if (att.length) { for (const a of agAtt.splice(0)) if (a.url) URL.revokeObjectURL(a.url); drawAtt(); }
      items.push({t: "user", text, ...(att.length ? {att: att.map(a => a.name)} : {}), ...(tgt?.show ? {show: tgt.show} : {}), file: cur, sel: sel ? (sel.from === sel.to ? "" + sel.from : `${sel.from}–${sel.to}`) : ""}); if (!tgt) $("agi").value = "";
      const r = await api("/agent/start", {method: "POST", body: {project: id, path: cur, prompt: text, attachments: att, selection: sel, errors: errs, history, model: $("agm").value,
        cursor: view && !histMode ? view.state.doc.lineAt(view.state.selection.main.head).number : null}});
      if (r.error) { items.push({t: "err", text: r.error}); drawAg(); return; }
      const run = {t: "run", job: r.job, activity: []}; items.push(run); agBusy = true; drawAg();
      if (tgt?.ref) requestAnimationFrame(() => document.querySelector(`.thr[data-ref="${tgt.ref}"]`)?.scrollIntoView({block: "nearest"}));
      setTimeout(() => agWatch(run, items), 800);
    } finally { agLaunching = false; if (!agBusy) setTimeout(agNext, 0); }
  }
  // Sigue una petición en marcha hasta que termina (también al volver a abrir una conversación interrumpida por una recarga)
  async function agWatch(run, items = agItems) {
    agBusy = true; agJob = run.job; drawAg();
    const done = () => { agBusy = false; const i = items.indexOf(run); if (i >= 0) items.splice(i, 1); };
    const step = async () => {
      if (agDead || items.indexOf(run) < 0) return;
      const j = await api(`/agent/job/${run.job}`);
      if (j.error && !j.state) { done(); items.push({t: "err", text: "La petición se interrumpió antes de terminar (por ejemplo, porque se reinició el servidor). Puedes volver a enviarla."}); drawAg(); return setTimeout(agNext, 0); }
      if (j.state === "running" || j.state === "stopping") { run.activity = j.activity || []; drawAg(); return setTimeout(step, 1000); }
      done();
      if (j.state === "error") items.push({t: "err", text: j.error});
      else if (j.state === "cancelled") items.push({t: "reply", text: "Detenido."});
      else {
        if (j.text) items.push({t: "reply", text: j.text});
        if (j.check && j.check.state !== "skip" && j.changes.length) items.push({t: "check", ...j.check});
        if (j.changes.length) items.push({t: "prop", job: run.job, changes: j.changes});
        else if (j.warn) items.push({t: "warn", text: j.warn});
      }
      drawAg(); if (items === agItems) $("agi").focus();
      setTimeout(agNext, 0);
    };
    step();
  }
  const getItem = ref => { const p = String(ref).split("/"); const it = agItems[+p[0]]; return p.length === 1 ? it : it?.threads?.[p[1]]?.items[+p[2]]; };
  async function agApply(n, idx, force, texts) {
    const it = getItem(n), list = (idx == null ? it.changes.filter(c => !c.applied && !c.rejected) : [it.changes[idx]]);
    const r = await api("/agent/apply", {method: "POST", body: {job: it.job, paths: list.map(c => c.path), force: !!force, ...(texts ? {texts} : {})}});
    if (r.error) return alert(r.error);
    for (const c of list) { if (r.applied.includes(c.path)) { c.applied = true; c.conflict = false; } else if (r.conflicts.includes(c.path)) c.conflict = true; }
    if (r.errors?.length) alert(r.errors.join("\n"));
    if (r.merged?.length) flash(`Combiné estos cambios con otros que ya habías aplicado en ${r.merged.join(", ")}.`);
    drawAg(); await load();
    if (cur && !files.some(f => f.path === cur)) open(firstFile());
  }
  // Revisión de los cambios del asistente: texto tachado (lo que sale) y subrayado (lo que entra), con ✓ / ✕ en cada cambio
  async function agView(n, i, side) {
    const it = getItem(n), c = it.changes[i];
    const full = (await api(`/agent/job/${it.job}?full=1`)).changes?.find(x => x.path === c.path); if (!full) return;
    const pend = it.changes.map((x, k) => k).filter(k => !it.changes[k].applied && !it.changes[k].rejected), pos = Math.max(0, pend.indexOf(i));
    const unified = !side && c.kind !== "del", nextOf = () => it.changes.findIndex((x, k) => k > i && !x.applied && !x.rejected);
    const md = document.createElement("div"); md.className = "modal";
    md.innerHTML = `<div class="box wide" role="dialog" aria-modal="true"><h3>${esc(c.path)} <small>${KIND[c.kind]} · +${c.add} −${c.del}${pend.length > 1 ? ` · archivo ${pos + 1} de ${pend.length}` : ""}</small></h3>
      <div class="rvbar"><span class="rvmode"><button id="vm1"${unified ? ' class="on"' : ""}${c.kind === "del" ? " disabled" : ""}>Revisión</button><button id="vm2"${unified ? "" : ' class="on"'}>Lado a lado</button></span>
        ${unified ? `<span id="rvn" class="m"></span><span class="sp"></span><button id="rvp" title="Cambio anterior">↑</button><button id="rvx" title="Cambio siguiente">↓</button><button id="rva">Aceptar todo</button><button id="rvr">Rechazar todo</button>`
          : '<span class="sp"></span>'}</div>
      ${unified ? '<p class="m">Lo <u>subrayado</u> es lo que entra y lo <s>tachado</s> lo que sale. Usa «Aceptar» o «Rechazar» en cada cambio. Al aplicar, solo se guardan los que aceptaste.</p>' : '<div class="dh2"><span>Antes</span><span>Propuesta del asistente</span></div>'}
      <div id="agdf"></div>
      <div class="acts"><button id="vc">Cerrar</button><button id="vn">Rechazar el archivo</button>${unified ? '<button id="vp">Aplicar lo aceptado</button><button id="vo" class="pr">Aceptar todo y aplicar</button>' : '<button id="vo" class="pr">Aceptar</button>'}</div></div>`;
    document.body.appendChild(md);
    const ro = [EditorView.editable.of(false), EditorView.lineWrapping, EditorState.phrases.of({"Accept": "Aceptar", "Reject": "Rechazar", "Controls": "Controles", "$ unchanged lines": "$ líneas sin cambios", "Expand": "Expandir"})];
    let mv = null, ev = null;
    if (unified) ev = new EditorView({doc: full.after, parent: $("agdf"), extensions: [...ro, unifiedMergeView({original: full.before, mergeControls: true, highlightChanges: true, gutter: true, collapseUnchanged: {margin: 3, minSize: 5}}),
      EditorView.updateListener.of(u => { const k = getChunks(u.state)?.chunks.length || 0; const el = $("rvn"); if (el) el.textContent = k ? `${k} ${k === 1 ? "cambio" : "cambios"} sin revisar` : "Todo revisado"; })]});
    else { mv = new MergeView({a: {doc: full.before, extensions: ro}, b: {doc: full.after, extensions: ro}, parent: $("agdf"), collapseUnchanged: {margin: 3, minSize: 5}}); }
    const close = () => { mv?.destroy(); ev?.destroy(); md.remove(); };
    const next = () => { close(); const k = nextOf(); if (k >= 0) agView(n, k, side); else drawAg(); };
    const chunks = () => getChunks(ev.state)?.chunks || [];
    const all = fn => { for (let g = 0; g < 500 && chunks().length; g++) if (!fn(ev, chunks()[0].fromB)) break; };
    if (ev) {
      ev.dispatch({});   // fuerza el primer conteo
      const first = chunks()[0]; if (first) ev.dispatch({selection: {anchor: first.fromB}, effects: EditorView.scrollIntoView(first.fromB, {y: "start", yMargin: 40})});
      $("rvx").onclick = () => goToNextChunk({state: ev.state, dispatch: ev.dispatch.bind(ev)}); $("rvp").onclick = () => goToPreviousChunk({state: ev.state, dispatch: ev.dispatch.bind(ev)});
      $("rva").onclick = () => all(acceptChunk); $("rvr").onclick = () => all(rejectChunk);
      $("vp").onclick = async () => {
        const text = getOriginalDoc(ev.state).toString();
        if (text === full.before) { flash("No aceptaste ningún cambio de este archivo."); return; }
        close(); await agApply(n, i, false, {[c.path]: text}); const k = nextOf(); if (k >= 0) agView(n, k, side);
      };
      $("vo").onclick = async () => { all(acceptChunk); const text = ev.state.doc.toString(); close(); await agApply(n, i, false, {[c.path]: text}); const k = nextOf(); if (k >= 0) agView(n, k, side); };
    } else $("vo").onclick = async () => { close(); await agApply(n, i); const k = nextOf(); if (k >= 0) agView(n, k, side); };
    md.onclick = e => { if (e.target === md) close(); };
    $("vc").onclick = () => { close(); drawAg(); };
    $("vn").onclick = () => { c.rejected = true; next(); };
    $("vm1").onclick = () => { if (!unified) { close(); agView(n, i, false); } };
    $("vm2").onclick = () => { if (unified) { close(); agView(n, i, true); } };
    if (mv?.chunks.length) mv.b.dispatch({selection: {anchor: mv.chunks[0].fromB}, scrollIntoView: true});
  }
  $("ab").onclick = () => setAg(!agOn);
  $("agx").onclick = () => setAg(false);
  $("agnw").onclick = agNew;
  $("agls").onclick = async () => { if (agMode === "list") { agMode = "chat"; drawAg(); return; } agSaveNow(); agMode = "list"; await refreshList(); drawAg(); };
  $("agl").addEventListener("click", async e => {
    if (agMode !== "list") return;
    if (e.target.closest("[data-chatnew]")) return agNew();
    const d = e.target.closest("[data-chatdel]");
    if (d) {
      const c = agList.find(x => x.id === d.dataset.chatdel);
      if (!confirm(`¿Borrar la conversación «${c?.title || ""}»? Los cambios que ya aceptaste se quedan en tus archivos y en el Historial.`)) return;
      await api(`/chats/${d.dataset.chatdel}`, {method: "DELETE"});
      if (d.dataset.chatdel === agChat) { agChat = newId(); agTitle = ""; agItems = []; agSig = sigOf(); }
      return refreshList();
    }
    const c = e.target.closest("[data-chat]"); if (c) agOpen(c.dataset.chat);
  });
  try { $("agm").value = localStorage.agModel || ""; } catch {}
  $("agm").onchange = () => { try { localStorage.agModel = $("agm").value; } catch {} };
  $("ags").onclick = () => { if (agBusy) { agQueue.length = 0; api("/agent/cancel", {method: "POST", body: {job: agJob}}); drawAg(); } else agSend(); };
  $("agi").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!agBusy) agSend(); } };
  $("agi").onfocus = selInfo;
  $("agc").onclick = e => { const b = e.target.closest("button[data-chip]"); if (!b) return; const c = CHIPS[+b.dataset.chip]; agSend(c[1], c[0] === "Arreglar errores"); };
  $("agl").addEventListener("change", e => {
    const sl = e.target.closest("input[data-sel]");
    if (sl) { const bar = sl.closest(".impl"), pk = bar.dataset.n + "|" + bar.dataset.key; if (sl.checked) agSel.add(pk); else agSel.delete(pk); bar.closest("li")?.classList.toggle("elegida", sl.checked); drawSb(); return; }
    const c = e.target.closest("input[data-atd]"); if (!c) return;
    markDone(c.closest(".impl"), c.checked ? "manual" : null); drawAg();
  });
  $("agl").onclick = e => {
    const rf = e.target.closest("a.ref"); if (rf) { e.preventDefault(); goTo(rf.dataset.f, +rf.dataset.l, rf.dataset.to ? +rf.dataset.to : undefined); return; }
    const im = e.target.closest("button[data-impl]");
    if (im) { const bar = im.closest(".impl"), pk = bar.dataset.n + "|" + bar.dataset.key; return im.dataset.impl === "1" ? enqueueImpl([pk], "") : commentModal([pk]); }
    const tb = e.target.closest("button[data-thr]");
    if (tb) { const bar = tb.closest(".impl"), pk = bar.dataset.n + "|" + bar.dataset.key; if (agThrOpen.has(pk)) agThrOpen.delete(pk); else agThrOpen.add(pk); return drawAg(); }
    const sa = e.target.closest("button[data-selall]");
    if (sa) { for (const bar of $("agl").querySelectorAll(".ab.md[data-n='" + sa.dataset.selall + "'] .impl")) { const li = bar.closest("li"); if (!li.classList.contains("atendida")) agSel.add(bar.dataset.n + "|" + bar.dataset.key); } return drawAg(); }
    const ts = e.target.closest("button[data-thsend]");
    if (ts) { const ref = ts.dataset.thsend; return threadMsg(ref, agDraft[ref] ?? ts.parentElement.querySelector("textarea")?.value); }
    const cp = e.target.closest("[data-copycode]");
    if (cp) { const code = cp.parentElement.querySelector("pre")?.innerText || ""; navigator.clipboard?.writeText(code.replace(/\n$/, "")).then(() => { cp.textContent = "Copiado"; setTimeout(() => cp.textContent = "Copiar", 1500); }); return; }
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const n = b.dataset.n, i = b.dataset.i == null ? null : +b.dataset.i, a = b.dataset.act, it = getItem(n);
    if (a === "retry") { const rt = "No se aplicó ningún cambio en los archivos. Haz ahora, editando directamente el archivo con Edit o Write, lo que te pedí."; if (n.includes("/")) threadMsg(n.split("/").slice(0, 2).join("/"), rt); else agSend(rt); }
    else if (a === "view") agView(n, i);
    else if (a === "ok" || a === "force") agApply(n, i, a === "force");
    else if (a === "okall") agApply(n, null);
    else if (a === "no") { it.changes[i].rejected = true; drawAg(); }
    else if (a === "noall") { it.changes.forEach(c => { if (!c.applied) c.rejected = true; }); drawAg(); }
  };
  $("agsb").onclick = e => {
    const b = e.target.closest("button[data-sb]"); if (!b) return;
    if (b.dataset.sb === "clr") { agSel.clear(); return drawAg(); }
    const pks = [...agSel]; if (b.dataset.sb === "go") enqueueImpl(pks, ""); else commentModal(pks);
  };
  $("agl").addEventListener("input", e => { const t = e.target.closest("textarea[data-thin]"); if (t) agDraft[t.dataset.thin] = t.value; });
  $("agl").addEventListener("keydown", e => { const t = e.target.closest("textarea[data-thin]"); if (t && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); threadMsg(t.dataset.thin, t.value); } });
  const agTimer = setInterval(() => agOn && selInfo(), 700);

  // Ventanita flotante al seleccionar código: pedirle algo al asistente sobre esa selección (Ctrl/⌘+K para escribir sin usar el ratón)
  const qa = document.createElement("div");
  qa.id = "qa"; qa.hidden = true;
  qa.innerHTML = `<span class="qs">✦</span><input id="qai" placeholder="Pídele algo a Claude sobre esta selección…" autocomplete="off" spellcheck="false"><button id="qab" class="pr">Enviar</button>`;
  document.body.appendChild(qa);
  let qaDismissed = "";
  const qaSig = () => { const s = selection(); return s && view ? `${cur}:${view.state.selection.main.from}-${view.state.selection.main.to}` : ""; };
  function qaHide() { qa.hidden = true; }
  function qaShow() {
    const sig = qaSig(); if (!sig || sig === qaDismissed || agBusy) { if (!sig) qaHide(); return; }
    const r = view.state.selection.main, c = view.coordsAtPos(r.to);
    if (!c) return qaHide();
    const box = $("ed").getBoundingClientRect();
    if (c.bottom < box.top || c.top > box.bottom) return qaHide();
    qa.hidden = false;
    const w = qa.offsetWidth, h = qa.offsetHeight;
    let x = Math.min(Math.max(box.left + 8, c.left), Math.max(box.left + 8, box.right - w - 12));
    let y = c.bottom + 8; if (y + h > innerHeight - 8) y = Math.max(8, c.top - h - 8);
    qa.style.left = x + "px"; qa.style.top = y + "px";
  }
  async function qaSend() {
    const text = $("qai").value.trim(); if (!text) return;
    if (agBusy) { if (!agOn) setAg(true); $("qai").placeholder = "El asistente sigue trabajando; espera a que termine…"; return; }
    if (!agStatus) await agCheck();
    if (!agStatus?.available) { if (!agOn) setAg(true); return; }
    qaDismissed = qaSig(); qaHide();
    if (!agOn) setAg(true);
    agSelSig = "-"; selInfo(); $("agsel").checked = true;
    $("qai").value = ""; agSend(text);
  }
  $("qab").onclick = qaSend;
  $("qai").onkeydown = e => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); qaSend(); }
    else if (e.key === "Escape") { qaDismissed = qaSig(); qaHide(); view?.focus(); }
    e.stopPropagation();
  };
  qa.onmousedown = e => { if (e.target.id !== "qai") e.preventDefault(); };
  $("ed").addEventListener("mouseup", () => setTimeout(qaShow, 30));
  $("ed").addEventListener("keyup", e => { if (e.shiftKey || e.key === "Shift") setTimeout(qaShow, 30); });
  $("ed").addEventListener("scroll", qaHide, true);
  const onQaKey = e => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k" && qaSig()) { e.preventDefault(); qaDismissed = ""; qaShow(); $("qai").focus(); } };
  addEventListener("keydown", onQaKey);
  const qaTimer = setInterval(() => { if (!qaSig()) { qaHide(); qaDismissed = ""; } }, 400);
  { const prev = cleanup; cleanup = () => { prev(); clearInterval(qaTimer); removeEventListener("keydown", onQaKey); qa.remove(); }; }
  const agFlush = () => { if (agSaveT) agSaveNow(true); };
  addEventListener("pagehide", agFlush);
  { const prev = cleanup; cleanup = () => { agFlush(); removeEventListener("pagehide", agFlush); prev(); agDead = true; clearInterval(agTimer); }; }
  drawAg();

  // ---------- Comentarios (anclados al texto; viajan dentro del mismo documento, así que se sincronizan solos) ----------
  const cmRefresh = StateEffect.define();
  let cmArr = null, cmShowRes = false, cmPending = null, cmFocus = null;
  const cmPos = (c, k) => { try { const a = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(c[k]), ydoc); return a && a.type === ydoc.getText("src") ? a.index : null; } catch { return null; } };
  function commentsExt(ytext, yd) {
    const arr = yd.getArray("comments");
    return ViewPlugin.fromClass(class {
      constructor(v) { this.v = v; this.dead = false; this.decorations = this.build(v); this.h = () => setTimeout(() => { if (!this.dead) this.v.dispatch({effects: cmRefresh.of(null)}); }, 0); ytext.observe(this.h); arr.observe(this.h); }
      update(u) { if (u.docChanged || u.transactions.some(t => t.effects.some(e => e.is(cmRefresh)))) this.decorations = this.build(u.view); }
      build(v) {
        const rs = [];
        for (const c of arr.toArray()) {
          if (c.resolved) continue;
          let a = cmPos(c, "from"), b = cmPos(c, "to"); if (a == null || b == null) continue;
          b = Math.min(b, v.state.doc.length); if (b <= a) continue;
          rs.push(Decoration.mark({class: "cmt", attributes: {"data-cid": c.id, title: `${c.author}: ${c.text}`.slice(0, 200)}}).range(a, b));
        }
        return Decoration.set(rs, true);
      }
      destroy() { this.dead = true; ytext.unobserve(this.h); arr.unobserve(this.h); }
    }, {decorations: p => p.decorations, eventHandlers: {click(e) { const el = e.target.closest?.(".cmt"); if (el) { cmFocus = el.dataset.cid; setCm(true); } }}});
  }
  const cmFmt = t => new Date(t).toLocaleString("es", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"});
  function cmList() {
    return (cmArr?.toArray() || []).map(c => ({...c, a: cmPos(c, "from"), b: cmPos(c, "to")}))
      .filter(c => cmShowRes || !c.resolved).sort((x, y) => (x.a ?? 1e9) - (y.a ?? 1e9));
  }
  function cmPaint() {
    const tab = $("cmtab"); if (!tab) return;
    const open_ = (cmArr?.toArray() || []).filter(c => !c.resolved).length;
    tab.textContent = open_ ? `Comentarios (${open_})` : "Comentarios";
    if ($("cmp").hidden) return;
    const list = cmList();
    $("cml").innerHTML = list.length ? list.map(c => `<li class="cmi${c.resolved ? " done" : ""}${c.id === cmFocus ? " on" : ""}" data-id="${esc(c.id)}">
      <div class="cmm"><i style="background:${esc(c.color || "#888")}"></i><b>${esc(c.author)}</b><small>${cmFmt(c.t)}</small></div>
      ${c.quote ? `<blockquote>${esc(c.quote.slice(0, 120))}${c.a == null ? " <em>(el texto ya no está)</em>" : ""}</blockquote>` : ""}
      <p>${esc(c.text)}</p>
      ${(c.replies || []).map(r => `<div class="cmr"><b>${esc(r.author)}</b> <small>${cmFmt(r.t)}</small><p>${esc(r.text)}</p></div>`).join("")}
      <div class="cma"><button data-a="rp">Responder</button><button data-a="rs">${c.resolved ? "Reabrir" : "Resolver"}</button><button data-a="del">Eliminar</button></div></li>`).join("")
      : `<li class="none">No hay comentarios${cmShowRes ? "" : " abiertos"} en este archivo. Selecciona texto en el editor y pulsa «Comentar selección» (${M}⌥M).</li>`;
  }
  function cmBind(yd) {
    cmArr?.unobserve(cmPaint); cmArr = yd.getArray("comments"); cmArr.observe(cmPaint); cmPending = null; $("cmnew").hidden = true; cmPaint();
  }
  function setCm(on) {
    if (on) olView && setOl(false);
    $("tr").classList.toggle("ov", on);
    $("tr").querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === (on ? "c" : "f")));
    $("cmp").hidden = !on; if (on) { $("ol").hidden = $("olb").hidden = true; }
    cmPaint();
    if (on && cmFocus) $("cml").querySelector(".cmi.on")?.scrollIntoView({block: "nearest"});
  }
  function cmCompose(label, onOk, ph = "Escribe tu comentario…") {
    const box = $("cmnew"); box.hidden = false;
    box.innerHTML = `<small>${esc(label)}</small><textarea rows="3" placeholder="${esc(ph)}"></textarea><div class="acts"><button data-a="x">Cancelar</button><button data-a="ok" class="pr">Guardar</button></div>`;
    const ta = box.querySelector("textarea"); ta.focus();
    const done = () => { box.hidden = true; box.innerHTML = ""; };
    box.onclick = e => { const a = e.target.dataset.a; if (a === "x") done(); if (a === "ok") { const t = ta.value.trim(); if (t) { onOk(t); done(); } } };
    ta.onkeydown = e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); box.querySelector("[data-a=ok]").click(); } };
  }
  function addComment() {
    if (!view || !cmArr || histMode) return;
    const s = view.state.selection.main;
    setCm(true);
    if (s.empty) { cmCompose("Selecciona primero en el editor el texto que quieres comentar.", () => {}); $("cmnew").querySelector("textarea").disabled = true; return; }
    const yt = ydoc.getText("src"), quote = view.state.sliceDoc(s.from, Math.min(s.to, s.from + 160));
    const from = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(yt, s.from)), to = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(yt, s.to, -1));
    cmCompose(`Comentario sobre «${quote.replace(/\s+/g, " ").slice(0, 60)}»`, text => {
      const c = {id: Math.random().toString(36).slice(2, 10), author: name, color, t: Date.now(), from, to, quote, text, resolved: false, replies: []};
      cmFocus = c.id; cmArr.push([c]);
    });
  }
  const cmUpd = (cid, fn) => { const i = cmArr.toArray().findIndex(c => c.id === cid); if (i < 0) return; const o = structuredClone(cmArr.get(i)); fn(o); ydoc.transact(() => { cmArr.delete(i, 1); cmArr.insert(i, [o]); }); };
  $("cmadd").onclick = addComment;
  $("cmres").onchange = e => { cmShowRes = e.target.checked; cmPaint(); };
  $("cml").onclick = e => {
    const li = e.target.closest("li.cmi"); if (!li) return;
    const cid = li.dataset.id, a = e.target.dataset.a;
    if (a === "rs") return cmUpd(cid, o => { o.resolved = !o.resolved; });
    if (a === "del") { if (confirm("¿Eliminar este comentario?")) { const i = cmArr.toArray().findIndex(c => c.id === cid); if (i >= 0) cmArr.delete(i, 1); } return; }
    if (a === "rp") return cmCompose("Respuesta", t => cmUpd(cid, o => { (o.replies ||= []).push({author: name, t: Date.now(), text: t}); }), "Escribe tu respuesta…");
    cmFocus = cid; cmPaint();
    const c = cmList().find(c => c.id === cid);
    if (c && c.a != null && view) { const b = Math.min(c.b ?? c.a, view.state.doc.length); view.dispatch({selection: {anchor: c.a, head: Math.max(c.a, b)}, effects: EditorView.scrollIntoView(c.a, {y: "center"})}); view.focus(); }
  };

  // ---------- Conteo de palabras ----------
  let wcT = 0, wcData = null;
  async function wcNow() {
    const s = await api(`/projects/${id}/stats`); if (!$("wc") || typeof s.words !== "number") return;
    wcData = s; $("wc").textContent = `${s.words.toLocaleString("es")} palabras`;
  }
  function wcSoon() { clearTimeout(wcT); wcT = setTimeout(wcNow, 3000); }
  { const prev = cleanup; cleanup = () => { prev(); clearTimeout(wcT); }; }
  $("wc").onclick = async () => {
    await wcNow(); if (!wcData) return;
    const per = Object.entries(wcData.per).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
    modal(`<h3>Conteo de palabras</h3><p><b>${wcData.words.toLocaleString("es")}</b> palabras en el proyecto${viewer.pages ? ` · <b>${viewer.pages}</b> páginas en el PDF` : ""}.</p>
      <table class="ks">${per.map(([p, n]) => `<tr><td>${esc(p)}</td><td>${n.toLocaleString("es")}</td></tr>`).join("") || "<tr><td>Sin texto</td></tr>"}</table>
      <p class="m">Se cuenta el texto del cuerpo; se omiten fórmulas, comandos, comentarios (%) y la bibliografía.</p><div class="acts"><button id="wk" class="pr">Cerrar</button></div>`,
      (md, close) => { md.querySelector("#wk").onclick = close; });
  };

  // ---------- Motor de compilación ----------
  $("eng").value = info.engine || "pdflatex";
  $("eng").onchange = async e => {
    const r = await api(`/projects/${id}`, {method: "PATCH", body: {engine: e.target.value}});
    if (r.error) return alert(r.error);
    compile();
  };

  // ---------- Buscar y reemplazar en todo el proyecto ----------
  let sq = {q: "", rep: "", case: false, word: false, regex: false};
  function searchAll() {
    const mkRe = () => { try { let s = sq.regex ? sq.q : sq.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); if (sq.word) s = `(?<![\\p{L}\\p{N}_])(?:${s})(?![\\p{L}\\p{N}_])`; return new RegExp(s, "gu" + (sq.case ? "" : "i")); } catch { return null; } };
    modal(`<h3>Buscar en el proyecto</h3>
      <div class="sr"><input id="sq1" placeholder="Buscar…" value="${esc(sq.q)}"><input id="sq2" placeholder="Reemplazar con…" value="${esc(sq.rep)}"></div>
      <div class="sro"><label><input type="checkbox" id="sqc"${sq.case ? " checked" : ""}> Mayúsculas</label><label><input type="checkbox" id="sqw"${sq.word ? " checked" : ""}> Palabra completa</label><label><input type="checkbox" id="sqr"${sq.regex ? " checked" : ""}> Expresión regular</label><span class="sp"></span><small id="sqn"></small></div>
      <div id="sqres" class="sres"></div>
      <div class="acts"><button id="sqx">Cerrar</button><button id="sqg" class="pr" disabled>Reemplazar todo</button></div>`, (md, close) => {
      md.querySelector(".box").classList.add("sw");
      const q1 = md.querySelector("#sq1"), res = md.querySelector("#sqres"), go = md.querySelector("#sqg"), nEl = md.querySelector("#sqn");
      let last = null, tm = 0, gen = 0;
      const read = () => { sq = {q: q1.value, rep: md.querySelector("#sq2").value, case: md.querySelector("#sqc").checked, word: md.querySelector("#sqw").checked, regex: md.querySelector("#sqr").checked}; };
      const hl = (txt, re) => { if (!re) return esc(txt); let o = "", i = 0, mm; re.lastIndex = 0; while ((mm = re.exec(txt)) && mm[0]) { o += esc(txt.slice(i, mm.index)) + "<mark>" + esc(mm[0]) + "</mark>"; i = mm.index + mm[0].length; } return o + esc(txt.slice(i)); };
      async function run() {
        read(); const g = ++gen;
        if (!sq.q) { res.innerHTML = ""; nEl.textContent = ""; go.disabled = true; last = null; return; }
        const r = await api(`/projects/${id}/search`, {method: "POST", body: sq});
        if (g !== gen) return;
        if (r.error) { res.innerHTML = `<p class="err">${esc(r.error)}</p>`; go.disabled = true; return; }
        last = r; const re = mkRe();
        nEl.textContent = r.total ? `${r.total} ${r.total === 1 ? "coincidencia" : "coincidencias"} en ${r.files.length} ${r.files.length === 1 ? "archivo" : "archivos"}` : "Sin resultados";
        go.disabled = !r.total;
        res.innerHTML = r.files.map(f => `<div class="sf"><label><input type="checkbox" class="sfc" data-p="${esc(f.path)}" checked> <b>${esc(f.path)}</b> <small>${f.n}</small></label>
          ${f.hits.map(h => `<div class="sh" data-p="${esc(f.path)}" data-l="${h.line}"><span class="ln">${h.line}</span><span>${hl(h.text.trim().slice(0, 200), re)}</span></div>`).join("")}</div>`).join("");
      }
      md.querySelector(".box").oninput = () => { clearTimeout(tm); tm = setTimeout(run, 250); };
      md.querySelector(".box").onchange = e => { if (!e.target.classList.contains("sfc")) run(); };
      res.onclick = e => { const h = e.target.closest(".sh"); if (h) { close(); goTo(h.dataset.p, +h.dataset.l); } };
      md.querySelector("#sqx").onclick = close;
      go.onclick = async () => {
        read(); const paths = [...res.querySelectorAll(".sfc")].filter(c => c.checked).map(c => c.dataset.p);
        if (!paths.length) return;
        if (!confirm(`¿Reemplazar «${sq.q}» por «${sq.rep}» en ${paths.length} ${paths.length === 1 ? "archivo" : "archivos"}?\n\nQueda guardada una versión anterior de cada archivo en el Historial, por si quieres deshacerlo.`)) return;
        go.disabled = true;
        const r = await api(`/projects/${id}/replace`, {method: "POST", body: {...sq, replace: sq.rep, paths}});
        if (r.error) { alert(r.error); return; }
        nEl.textContent = `Reemplazadas ${r.changed} en ${r.files} ${r.files === 1 ? "archivo" : "archivos"}.`; res.innerHTML = ""; go.disabled = true;
        wcSoon();
      };
      q1.focus(); q1.select(); if (sq.q) run();
    });
  }
  $("sa").onclick = searchAll;

  $("dkp").onclick = toggleTheme; applyTheme();
  {
    const mp = $("mnp"), close = () => { mp.hidden = true; $("mn").classList.remove("on"); };
    $("mn").onclick = e => { e.stopPropagation(); mp.hidden = !mp.hidden; $("mn").classList.toggle("on", !mp.hidden); };
    mp.addEventListener("click", close);
    const away = e => { if (!mp.hidden && !e.target.closest(".mnw")) close(); }, esc3 = e => { if (e.key === "Escape" && !mp.hidden) close(); };
    document.addEventListener("click", away); document.addEventListener("keydown", esc3);
    const prev = cleanup; cleanup = () => { prev(); document.removeEventListener("click", away); document.removeEventListener("keydown", esc3); };
  }

  // ---------- Gestor de snippets ----------
  $("snp").onclick = () => {
    const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : "";
    modal(`<h3>Snippets</h3>
      <small>Escribe la abreviatura en el editor y pulsa <b>Tab</b>. Usa <code>\${}</code> para los huecos (Tab salta al siguiente) y <code>\${nombre}</code> para que un hueco se repita donde aparezca igual.</small>
      <div id="snl" class="snl"></div>
      <h4 id="snh">Nuevo snippet</h4>
      <input id="snk" placeholder="Abreviatura (ej. thm)" maxlength="24" autocomplete="off" spellcheck="false">
      <textarea id="snt" rows="5" placeholder="Texto que se inserta" spellcheck="false"></textarea>
      <div class="acts"><button id="snr" title="Vuelve a la lista inicial">Restaurar los de fábrica</button><span style="flex:1"></span><button id="snc">Cerrar</button><button id="sns" class="pr">Guardar</button></div>`, (md, close) => {
      const $$ = q => md.querySelector(q); let list = getSnips().map(x => ({...x})), editing = null;
      if (sel) { $$("#snt").value = sel; $$("#snh").textContent = "Nuevo snippet (con tu selección)"; }
      const draw = () => { $$("#snl").innerHTML = list.length ? list.map((x, i) => `<div class="snr"><code>${esc(x.k)}</code><span>${esc(x.t.replace(/\n\t?/g, " ↵ ").slice(0, 70))}</span><button data-e="${i}" aria-label="Editar">${ico("pencil", 13)}</button><button data-d="${i}" aria-label="Borrar">${ico("trash", 13)}</button></div>`).join("") : "<small>No hay snippets.</small>"; };
      const save = () => lsSet("snippets", list);
      $$("#snl").onclick = e => { const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.d != null) { list.splice(+b.dataset.d, 1); save(); draw(); }
        else if (b.dataset.e != null) { editing = +b.dataset.e; $$("#snk").value = list[editing].k; $$("#snt").value = list[editing].t; $$("#snh").textContent = "Editando"; $$("#snt").focus(); } };
      $$("#sns").onclick = () => {
        const k = $$("#snk").value.trim(), t = $$("#snt").value;
        if (!/^[A-Za-z0-9_:\-]{1,24}$/.test(k)) return flash("La abreviatura solo puede llevar letras, números, - _ :");
        if (!t.trim()) return flash("Escribe el texto que se insertará");
        const dup = list.findIndex((x, i) => x.k === k && i !== editing); if (dup >= 0) return flash("Ya existe un snippet con esa abreviatura");
        if (editing != null) list[editing] = {k, t}; else list.push({k, t});
        editing = null; save(); draw(); $$("#snk").value = ""; $$("#snt").value = ""; $$("#snh").textContent = "Nuevo snippet"; flash("Guardado");
      };
      $$("#snr").onclick = () => { if (!confirm("¿Volver a la lista de fábrica? Se pierden tus snippets.")) return; list = SNIP0.map(x => ({...x})); save(); draw(); };
      $$("#snc").onclick = close; draw(); $$("#snk").focus();
    });
  };

  // ---------- Ir a la definición (⌘+clic) ----------
  let xrData = null, xrAt = 0, xrLoading = null;
  const xref = async (force) => {
    if (!force && xrData && Date.now() - xrAt < 2500) return xrData;
    return xrLoading ||= api(`/projects/${id}/xref`).then(d => { if (!d.error) { xrData = d; xrAt = Date.now(); xrBadge(); } return xrData; }).finally(() => { xrLoading = null; });
  };
  const flash = msg => { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };
  const LINKRE = /\\(ref|eqref|autoref|cref|Cref|vref|pageref|nameref|subref|cite[a-zA-Z]*|nocite|parencite|textcite|autocite|footcite|smartcite|input|include|subfile|includegraphics|bibliography|addbibresource|label)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g;
  function linkAt(v, pos) {
    const line = v.state.doc.lineAt(pos), t = line.text, off = pos - line.from;
    for (const m of t.matchAll(LINKRE)) {
      const cs = m.index + m[0].length - m[2].length - 1;
      if (off < cs || off > cs + m[2].length) continue;
      let at = cs;
      for (const seg of m[2].split(",")) {
        const lead = seg.length - seg.trimStart().length, key = seg.trim(), a = at + lead, b = a + key.length;
        if (key && off >= a && off <= b + 0) return {cmd: m[1], key, from: line.from + a, to: line.from + b, line: line.number};
        at += seg.length + 1;
      }
    }
    return null;
  }
  const linkSet = StateEffect.define();
  const linkField = StateField.define({
    create: () => Decoration.none,
    update(v, tr) { for (const e of tr.effects) if (e.is(linkSet)) return e.value ? Decoration.set([Decoration.mark({class: "cmlink"}).range(e.value.from, e.value.to)]) : Decoration.none; return tr.docChanged ? Decoration.none : v; },
    provide: f => EditorView.decorations.from(f),
  });
  const modKey = e => mac ? e.metaKey : e.ctrlKey;
  let linkLast = null;
  const setLink = (v, l) => { const k = l ? l.from + ":" + l.to : ""; if (k === linkLast) return; linkLast = k; v.dispatch({effects: linkSet.of(l)}); v.dom.classList.toggle("linkable", !!l); };
  async function jumpTo(l) {
    const x = await xref(true); if (!x) return;
    const c = l.cmd;
    if (c === "label") {
      const u = x.refs.find(r => r.key === l.key);
      return u ? goTo(u.file, u.line) : flash(`Nadie hace referencia a «${l.key}» todavía.`);
    }
    if (/^(ref|eqref|autoref|cref|Cref|vref|pageref|nameref|subref)$/.test(c)) {
      const d = x.labels.find(b => b.key === l.key);
      return d ? goTo(d.file, d.line) : flash(`La etiqueta «${l.key}» no está definida en ningún archivo.`);
    }
    if (/^(cite|nocite|parencite|textcite|autocite|footcite|smartcite)/.test(c)) {
      const d = x.bibs.find(b => b.key === l.key);
      return d ? goTo(d.file, d.line) : flash(`La clave «${l.key}» no está en tu bibliografía.`);
    }
    const inc = x.incs.find(i => i.file === cur && i.line === l.line && i.name === l.key.replace(/^\.\//, ""));
    if (!inc?.target) return flash(`No encuentro el archivo «${l.key}» en el proyecto.`);
    if (histMode) setHist(false);
    return files.find(f => f.path === inc.target)?.kind === "bin" ? previewBin(inc.target) : open(inc.target);
  }
  const linkExt = [linkField, EditorView.domEventHandlers({
    mousedown(e, v) {
      if (e.button !== 0 || !modKey(e) || e.shiftKey || e.altKey) return false;
      const pos = v.posAtCoords({x: e.clientX, y: e.clientY}); if (pos == null) return false;
      const l = linkAt(v, pos); if (!l) return false;
      e.preventDefault(); jumpTo(l); return true;
    },
    mousemove(e, v) { if (!modKey(e)) return setLink(v, null); const pos = v.posAtCoords({x: e.clientX, y: e.clientY}); setLink(v, pos == null ? null : linkAt(v, pos)); },
    mouseleave(e, v) { setLink(v, null); },
    keyup(e, v) { if (e.key === "Meta" || e.key === "Control") setLink(v, null); },
  })];

  // ---------- Panel de referencias ----------
  function xrBadge() {
    const n = xrData?.counts?.errors || 0, b = $("xr"); if (!b) return;
    b.innerHTML = `${ico("link")} Referencias${n ? ` <i class="bdg">${n}</i>` : ""}`; b.classList.toggle("warnb", n > 0);
  }
  { const iv = setInterval(() => { if (!document.hidden) xref(true); }, 60000); const prev = cleanup; cleanup = () => { prev(); clearInterval(iv); }; }
  async function xrefPanel() {
    const x = await xref(true); if (!x) return;
    const P = x.problems;
    const sec = (title, list, line, opts = {}) => {
      if (!list.length) return "";
      return `<details class="xs"${opts.open === false ? "" : " open"}><summary><b>${title}</b> <small>${list.length}</small></summary>${list.slice(0, 300).map(it => `<div class="xi" data-f="${esc(it.file)}" data-l="${it.line}"><span class="xk">${esc(line(it))}</span><span class="xw">${esc(it.file)}:${it.line}</span></div>`).join("")}</details>`;
    };
    const err = P.undefinedRefs.length + P.undefinedCites.length + P.missingFiles.length + P.dupLabels.length;
    modal(`<h3>Referencias del proyecto</h3>
      <p class="m">${x.labels.length} etiquetas · ${x.bibs.length} entradas de bibliografía · ${err ? `<b style="color:#b00020">${err} ${err === 1 ? "problema" : "problemas"}</b>` : "<b style=\"color:#1b7a3a\">sin problemas</b>"}. Clic en un elemento para ir a él.</p>
      <div class="xres">
      ${sec("Referencias sin etiqueta definida", P.undefinedRefs, i => i.key)}
      ${sec("Citas que no están en la bibliografía", P.undefinedCites, i => i.key)}
      ${sec("Archivos que no existen", P.missingFiles, i => `\\${i.kind}{${i.name}}`)}
      ${sec("Etiquetas repetidas", P.dupLabels, i => i.key)}
      ${sec("Claves repetidas en el .bib", P.dupBib, i => i.key)}
      ${sec("Etiquetas que nadie referencia", P.unusedLabels, i => i.key, {open: false})}
      ${sec("Entradas del .bib que no se citan", P.unusedBib, i => i.key, {open: false})}
      ${err + P.unusedLabels.length + P.unusedBib.length + P.dupBib.length ? "" : '<p class="m">Todo en orden.</p>'}</div>
      <div class="acts"><button id="xa">Cerrar</button>${err ? '<button id="xf" class="pr">Resolver con IA</button>' : ""}</div>`, (md, close) => {
      md.querySelector(".box").classList.add("sw");
      md.querySelector("#xa").onclick = close;
      md.querySelector(".xres").onclick = e => { const i = e.target.closest(".xi"); if (i) { close(); goTo(i.dataset.f, +i.dataset.l); } };
      const f = md.querySelector("#xf");
      if (f) f.onclick = async () => {
        close(); if (!agOn) setAg(true); await agCheck();
        const L = (t, l, fn) => l.length ? `${t}:\n${l.slice(0, 40).map(i => "- " + fn(i) + ` (${i.file}:${i.line})`).join("\n")}\n` : "";
        agSend("Revisa y arregla estos problemas de referencias cruzadas de mi proyecto, con los cambios mínimos. " +
          "Si una etiqueta o cita parece un error de escritura de otra existente, corrígela; si de verdad falta, dímelo en vez de inventarla (no inventes entradas de bibliografía).\n\n" +
          L("Referencias sin etiqueta definida", P.undefinedRefs, i => i.key) + L("Citas que no están en la bibliografía", P.undefinedCites, i => i.key) +
          L("Archivos que no existen", P.missingFiles, i => `\\${i.kind}{${i.name}}`) + L("Etiquetas repetidas", P.dupLabels, i => i.key), false, true);
      };
    });
  }
  $("xr").onclick = xrrefOpen; function xrrefOpen() { xrefPanel(); }

  // ---------- Fórmula desde una imagen ----------
  function formulaDialog(preset) {
    let img = null;
    modal(`<h3>Fórmula desde una imagen</h3>
      <div id="fdrop" class="fdrop" tabindex="0">Pega aquí una captura (${M}V), arrastra una imagen o <button id="fpick" type="button">elige un archivo</button>.<input type="file" id="ffile" accept="image/png,image/jpeg,image/gif,image/webp" hidden></div>
      <img id="fimg" hidden alt="">
      <div class="fopt"><label><input type="radio" name="fm" value="formula" checked> Una fórmula</label><label><input type="radio" name="fm" value="text"> Texto con fórmulas</label><button id="fgo" class="pr" disabled>Convertir a LaTeX</button></div>
      <p id="fst" class="m"></p>
      <textarea id="ftx" rows="4" spellcheck="false" hidden placeholder="Aquí aparecerá el LaTeX"></textarea>
      <div id="fpv" class="fpv" hidden></div>
      <div class="acts"><button id="fcl">Cerrar</button><button id="fcp" disabled>Copiar</button><button id="fin" class="pr" disabled>Insertar en el cursor</button></div>`, (md, close) => {
      const $$ = s => md.querySelector(s);
      const setImg = f => {
        if (!f || !/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { $$("#fst").textContent = "Usa una imagen PNG, JPG, GIF o WebP."; return; }
        img = f; $$("#fimg").src = URL.createObjectURL(f); $$("#fimg").hidden = false; $$("#fgo").disabled = false; $$("#fst").textContent = "Imagen lista. Pulsa «Convertir a LaTeX».";
      };
      const render = () => {
        const t = $$("#ftx").value.trim(), pv = $$("#fpv"); $$("#fin").disabled = $$("#fcp").disabled = !t; pv.hidden = !t; if (!t) return;
        try { pv.innerHTML = renderMd(/^\s*\$|\\\[/.test(t) || $$("input[name=fm]:checked").value === "text" ? t : `$$${t}$$`); } catch { pv.textContent = ""; }
      };
      $$("#fpick").onclick = () => $$("#ffile").click(); $$("#ffile").onchange = e => setImg(e.target.files[0]);
      const dz = $$("#fdrop"); dz.focus();
      md.addEventListener("paste", e => { const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/")); if (f) { e.preventDefault(); setImg(f); } });
      dz.ondragover = e => e.preventDefault(); dz.ondrop = e => { e.preventDefault(); setImg(e.dataTransfer.files[0]); };
      $$("#ftx").oninput = render; md.querySelectorAll("input[name=fm]").forEach(r => r.onchange = render);
      $$("#fgo").onclick = async () => {
        if (!img) return; $$("#fgo").disabled = true; $$("#fst").textContent = "Leyendo la imagen con Claude… (puede tardar unos segundos)";
        const r = await api("/agent/formula", {method: "POST", body: {mime: img.type, data: await toB64(img), mode: $$("input[name=fm]:checked").value, model: $("agm").value}});
        $$("#fgo").disabled = false;
        if (r.error) { $$("#fst").textContent = r.error; return; }
        $$("#fst").textContent = "Revisa que coincida con la imagen; puedes corregir el código antes de insertarlo."; $$("#ftx").hidden = false; $$("#ftx").value = r.latex; render();
      };
      $$("#fcl").onclick = close;
      $$("#fcp").onclick = () => { navigator.clipboard?.writeText($$("#ftx").value); flash("Copiado."); };
      $$("#fin").onclick = () => {
        const t = $$("#ftx").value.trim(); if (!t || !view || histMode) return; close();
        const multi = /\n|\\\\|\\begin\{/.test(t), whole = /^\s*(\$|\\\[|\\begin\{(equation|align|gather|multline))/.test(t) || $$("input[name=fm]:checked")?.value === "text";
        const ins = whole ? t : multi ? `\\begin{equation*}\n${t}\n\\end{equation*}` : `\\[ ${t} \\]`;
        const s = view.state.selection.main; view.dispatch({changes: {from: s.from, to: s.to, insert: ins}, selection: {anchor: s.from + ins.length}, scrollIntoView: true, userEvent: "input"}); view.focus();
      };
      if (preset) setImg(preset);
    });
  }
  $("fm").onclick = () => formulaDialog();

  // ---------- Atajos de teclado ----------
  // ⌘ en Mac, Ctrl en el resto. Escuchador global en fase de captura: funciona con el foco en cualquier sitio
  // y se impone a los atajos por defecto del editor (p. ej. ⌘Enter, que ahí inserta una línea).
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const M = mac ? "⌘" : "Ctrl+", S = mac ? "⇧" : "Shift+";
  const wrap = cmd => {
    if (!view || histMode) return false;
    const [a, b] = [`\\${cmd}{`, "}"];
    view.dispatch(view.state.changeByRange(r => {
      const s = view.state.sliceDoc(r.from, r.to);
      if (s.startsWith(a) && s.endsWith(b) && s.length >= a.length + 1) {            // ya está envuelto: quitarlo
        const inner = s.slice(a.length, -1);
        return {changes: {from: r.from, to: r.to, insert: inner}, range: EditorSelection.range(r.from, r.from + inner.length)};
      }
      if (!r.empty && r.from >= a.length && view.state.sliceDoc(r.from - a.length, r.from) === a && view.state.sliceDoc(r.to, r.to + 1) === b)   // la selección está dentro de \cmd{…}
        return {changes: [{from: r.from - a.length, to: r.from}, {from: r.to, to: r.to + 1}], range: EditorSelection.range(r.from - a.length, r.to - a.length)};
      if (r.empty) return {changes: {from: r.from, insert: a + b}, range: EditorSelection.cursor(r.from + a.length)};
      return {changes: {from: r.from, to: r.to, insert: a + s + b}, range: EditorSelection.range(r.from + a.length, r.from + a.length + s.length)};
    }), {scrollIntoView: true, userEvent: "input"});
    view.focus(); return true;
  };
  const SHORTCUTS = [
    ["Compilar el PDF", `${M}Enter`, e => e.key === "Enter" && !e.shiftKey && !e.altKey, () => { compile(); return true; }],
    ["Compilar (como en Overleaf)", `${M}S`, e => e.key.toLowerCase() === "s" && !e.shiftKey && !e.altKey, () => { compile(); return true; }],
    ["Guardar versión con nombre", `${M}${S}S`, e => e.key.toLowerCase() === "s" && e.shiftKey && !e.altKey, () => { $("save").click(); return true; }],
    ["Abrir o cerrar el Historial", `${M}${S}H`, e => e.key.toLowerCase() === "h" && e.shiftKey && !e.altKey, () => { setHist(!histMode); return true; }],
    ["Negrita  \\textbf{ }", `${M}B`, e => e.key.toLowerCase() === "b" && !e.shiftKey && !e.altKey, () => wrap("textbf")],
    ["Cursiva  \\textit{ }", `${M}I`, e => e.key.toLowerCase() === "i" && !e.shiftKey && !e.altKey, () => wrap("textit")],
    ["Énfasis  \\emph{ }", `${M}E`, e => e.key.toLowerCase() === "e" && !e.shiftKey && !e.altKey, () => wrap("emph")],
    ["Buscar y reemplazar en todo el proyecto", `${M}${S}F`, e => e.code === "KeyF" && e.shiftKey && !e.altKey, () => { searchAll(); return true; }],
    ["Comentar el texto seleccionado", `${M}⌥M`, e => e.code === "KeyM" && e.altKey && !e.shiftKey, () => { addComment(); return true; }],
    ["Convertir una imagen en fórmula LaTeX", `${M}⌥V`, e => e.code === "KeyV" && e.altKey && !e.shiftKey, () => { formulaDialog(); return true; }],
    ["Ver referencias, citas y archivos con problemas", `${M}${S}R`, e => e.code === "KeyR" && e.shiftKey && !e.altKey, () => { xrefPanel(); return true; }],
    ["Abrir o cerrar el asistente", `${M}J`, e => e.key.toLowerCase() === "j" && !e.shiftKey && !e.altKey, () => { setAg(!agOn); return true; }, true],
    ["Del código al PDF (línea del cursor)", `${M}⌥Enter`, e => e.key === "Enter" && e.altKey && !e.shiftKey, () => { toPdf(); return true; }],
    ["Plegar o desplegar el bloque del cursor", mac ? "⌘⌥[  /  ⌘⌥]" : "Ctrl+Shift+[  /  ]", () => false, () => false],
    ["Plegar o desplegar todo", "Ctrl+⌥[  /  Ctrl+⌥]", () => false, () => false],
    ["Ver esta lista de atajos", `${M}${S}/`, e => (e.key === "?" || e.key === "/") && e.shiftKey && !e.altKey, () => { help(); return true; }, true],
  ];
  const INFO = [
    ["Ir a la definición de \\ref, \\cite o \\input", `${M}clic`], ["Comentar o descomentar líneas (%)", `${M}/`], ["Buscar en el archivo", `${M}F`], ["Ir a una línea", `${M}${mac ? "⌥" : "Alt+"}G`],
    ["Deshacer / rehacer", `${M}Z / ${M}${S}Z`], ["Mover la línea", `${mac ? "⌥" : "Alt+"}↑ / ↓`], ["Borrar la línea", `${M}${S}K`],
    ["Abrir las sugerencias a mano", "Ctrl+Espacio"], ["Aceptar la sugerencia", "Enter / Tab"], ["Cerrar ventanas, o salir del Historial", "Esc"],
  ];
  function help() {
    if (document.querySelector(".modal.keys")) return;
    const row = ([d, k]) => `<tr><td>${esc(d)}</td><td><kbd>${esc(k)}</kbd></td></tr>`;
    const md = document.createElement("div"); md.className = "modal keys";
    md.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Atajos de teclado"><h3>Atajos de teclado</h3>
      <table class="ks">${SHORTCUTS.map(s => row(s)).join("")}<tr><th colspan="2">Del editor</th></tr>${INFO.map(row).join("")}</table>
      <p class="m">Negrita, cursiva y énfasis envuelven la selección; si ya está envuelta, la desenvuelven.</p>
      <div class="acts"><button id="kc" class="pr">Cerrar</button></div></div>`;
    document.body.appendChild(md);
    md.onclick = e => { if (e.target === md) md.remove(); };
    $("kc").onclick = () => md.remove(); $("kc").focus();
  }
  const onKey = e => {
    if (e.key === "Escape") {
      const m = document.querySelector(".modal"); if (m) { m.remove(); e.preventDefault(); return; }
      if (histMode && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { setHist(false); e.preventDefault(); }
      return;
    }
    if (!(mac ? e.metaKey : e.ctrlKey) || e.isComposing || document.querySelector(".modal")) return;
    const s = SHORTCUTS.find(x => x[2](e));
    if (s && e.target?.id === "agi" && !s[4]) return;          // en el cuadro del asistente, Enter envía y ⌘B etc. no se aplican
    if (s && s[3]() !== false) { e.preventDefault(); e.stopPropagation(); }
  };
  document.addEventListener("keydown", onKey, true);
  const prevCleanup = cleanup;
  cleanup = () => { prevCleanup(); document.removeEventListener("keydown", onKey, true); };
  $("co").title = `Compilar (${M}Enter)`; $("save").title = `Guardar versión con nombre (${M}${S}S)`; $("hb").title = `Historial (${M}${S}H)`;
  $("kb").onclick = help; $("kb").title = `Atajos de teclado (${M}${S}/)`;

  await load();
  paintMain();
  { const z = lsGet(zotKey, null); if (z?.auto) zotSync(z, true).then(r => { if (!r.error && !r.unchanged && $("cs")) $("cs").textContent = `Zotero: ${r.file} actualizado (${r.count} referencias).`; }); }
  { const last = lsGet(posKey, {}).file; open(last && files.some(f => f.path === last && f.kind === "text") ? last : firstFile()); }
  wcNow(); xref(true);
  drawDiff();
}

addEventListener("hashchange", route); route();
