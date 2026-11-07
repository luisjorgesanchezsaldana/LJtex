// LJtex como app de escritorio: arranca el servidor interno, abre una ventana y lo detiene al cerrar.
const {app, BrowserWindow, Menu, shell, dialog, ipcMain} = require("electron");
const {spawn, execFileSync} = require("child_process");
const {existsSync} = require("fs");
const {join} = require("path");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const updater = require("./update.cjs");

const TOKEN = crypto.randomBytes(18).toString("hex");   // clave interna: nadie la escribe, cambia en cada arranque
const PORT = 3000;
let server = null, quitting = false, output = "";
// Cada pestaña es una ventana de LJtex agrupada con las pestañas nativas de macOS (tabbingIdentifier)
const wins = new Set();
const live = () => [...wins].filter(w => !w.isDestroyed());
const cur = () => { const f = BrowserWindow.getFocusedWindow(); return f && wins.has(f) ? f : live().at(-1) || null; };
// Antes de cerrar, cada pestaña puede pedir algo (p. ej. sincronizar con GitHub). Devuelve false si la persona se queda.
const asking = new WeakMap();
function canCloseWin(w) {
  if (!w || w.isDestroyed() || w.ljClose) return Promise.resolve(true);
  if (!asking.has(w)) asking.set(w, w.webContents.executeJavaScript("window.ljtexBeforeClose ? window.ljtexBeforeClose() : true", true)
    .then(v => v !== false, () => true).finally(() => asking.delete(w)));
  return asking.get(w);
}
// Para salir de LJtex se pregunta pestaña por pestaña (mostrando la que pregunta)
async function canClose() {
  for (const w of live()) {
    if (w.ljClose) continue;
    if (!w.isFocused()) { w.show(); w.focus(); }
    if (!(await canCloseWin(w))) return false;
  }
  return true;
}

// Una app abierta desde el Dock no hereda el PATH de la terminal: sin esto no encontraría latexmk, claude, etc.
function fullPath() {
  const home = os.homedir();
  const extra = ["/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin", join(home, ".local/bin"), join(home, ".claude/local"), join(home, ".npm-global/bin"), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  let shellPath = "";
  try { shellPath = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf %s "$PATH"'], {timeout: 4000, encoding: "utf8"}).split("\n").pop(); } catch {}
  return [...new Set([...(shellPath ? shellPath.split(":") : []), ...extra, ...(process.env.PATH || "").split(":")].filter(Boolean))].join(":");
}
const icloud = join(os.homedir(), "Library/Mobile Documents/com~apple~CloudDocs/LJtex-datos");

function startServer(extraEnv = {}) {
  output = "";
  const env = {...process.env, ...extraEnv, ELECTRON_RUN_AS_NODE: "1", TOKEN, PATH: fullPath()};
  // Si existe la carpeta LJtex-datos en iCloud Drive, la base local se sincroniza con ella (al abrir y al cerrar)
  if (env.LJTEX_SYNC === undefined && existsSync(icloud)) env.LJTEX_SYNC = icloud;
  server = spawn(process.execPath, [join(app.getAppPath(), "server.js")], {cwd: app.getAppPath(), env, stdio: ["ignore", "pipe", "pipe"]});
  server.stdout.on("data", d => output += d); server.stderr.on("data", d => output += d);
  return new Promise(resolve => {
    let done = false; const fin = v => { if (!done) { done = true; resolve(v); } };
    server.on("exit", code => { server = null; fin({ok: false, code}); });
    const t0 = Date.now();
    (function poll() {
      if (done) return;
      http.get({host: "127.0.0.1", port: PORT, path: "/"}, r => { r.resume(); fin({ok: true}); })
        .on("error", () => Date.now() - t0 > 90000 ? fin({ok: false, code: "tiempo"}) : setTimeout(poll, 400));
    })();
  });
}

function stopServer() {
  return new Promise(resolve => {
    if (!server) return resolve();
    const s = server, t = setTimeout(() => { try { s.kill("SIGKILL"); } catch {} resolve(); }, 25000);   // da tiempo a subir los cambios a iCloud
    s.once("exit", () => { clearTimeout(t); resolve(); });
    try { s.kill("SIGINT"); } catch { clearTimeout(t); resolve(); }
  });
}

// window.prompt() no existe en Electron: lo reemplazo por una ventanita propia (el código de la app sigue igual)
ipcMain.on("cfg", e => { e.returnValue = {token: TOKEN, user: os.userInfo().username}; });
ipcMain.on("prompt", (e, msg, def) => {
  const parent = BrowserWindow.fromWebContents(e.sender) || cur();
  const w = new BrowserWindow({parent: parent || undefined, modal: !!parent, width: 460, height: 200, resizable: false, minimizable: false, maximizable: false, show: false,
    webPreferences: {nodeIntegration: true, contextIsolation: false}});
  w.setMenuBarVisibility(false);
  let answered = false;
  const answer = v => { if (answered) return; answered = true; e.returnValue = v; if (!w.isDestroyed()) w.close(); };
  ipcMain.once("prompt-result", (ev, v) => answer(v));
  w.on("closed", () => answer(null));
  const html = `<!doctype html><meta charset="utf-8"><style>body{font:14px -apple-system,system-ui;margin:18px;color:#222}input{width:100%;box-sizing:border-box;font:inherit;padding:6px 8px;margin:10px 0;border:1px solid #bbb;border-radius:6px}div{display:flex;gap:8px;justify-content:flex-end}button{font:inherit;padding:5px 14px;border-radius:6px;border:1px solid #bbb;background:#f6f6f6}button.p{background:#2f4fb3;color:#fff;border-color:#2f4fb3}p{white-space:pre-wrap;margin:0}</style>
<p id=m></p><input id=i autofocus><div><button id=c>Cancelar</button><button class=p id=o>Aceptar</button></div>
<script>const {ipcRenderer}=require("electron");m.textContent=${JSON.stringify(String(msg))};i.value=${JSON.stringify(String(def ?? ""))};i.select();
o.onclick=()=>ipcRenderer.send("prompt-result",i.value);c.onclick=()=>ipcRenderer.send("prompt-result",null);
addEventListener("keydown",e=>{if(e.key==="Enter")o.onclick();if(e.key==="Escape")c.onclick()});</script>`;
  w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)); w.once("ready-to-show", () => w.show());
});

// Actualizaciones (botón «Buscar actualizaciones» y menú LJtex)
ipcMain.handle("update-check", async () => { try { return await updater.check(); } catch (e) { return {error: e.message, needToken: !!e.needToken}; } });
ipcMain.handle("update-install", async e => {
  try {
    const r = await updater.install((phase, frac) => { if (!e.sender.isDestroyed()) e.sender.send("update-progress", phase, frac); });
    if (!r.ready) return r;                                    // p. ej. se abrió el .dmg para instalarlo a mano
    if (!(await canClose())) return {cancelled: true};         // la persona decidió quedarse (p. ej. cambios sin subir a GitHub)
    r.run(); quitting = true; live().forEach(w => w.ljClose = true); stopServer().then(() => app.exit(0));   // se cierra; el script pone la versión nueva y la abre
    return {restarting: true};
  } catch (err) { return {error: err.message, needToken: !!err.needToken}; }
});
ipcMain.on("build-info", e => { e.returnValue = updater.current(); });
ipcMain.handle("update-last", () => updater.lastResult());
ipcMain.handle("update-open-dmg", (e, f) => { updater.openDmg(f); });
const askUpdate = () => { const w = cur(); if (w) w.webContents.executeJavaScript("window.ljtexCheckUpdates && window.ljtexCheckUpdates(true)", true).catch(() => {}); };
// Pestañas: la página pide abrir otra (proyecto o pantalla principal) con ipc o con ⌘-clic en un enlace
const BASE = `http://localhost:${PORT}/`;
ipcMain.on("tab-open", (e, hash) => openWindow(BASE + (typeof hash === "string" && /^#\/?[\w\/-]*$/.test(hash) ? hash : ""), BrowserWindow.fromWebContents(e.sender)));
const newTab = () => openWindow(BASE, cur());

// Abre una ventana de LJtex; con «junto» se agrega como pestaña nueva de esa ventana
function openWindow(url = BASE, junto = null) {
  const w = new BrowserWindow({width: 1500, height: 950, title: "LJtex", backgroundColor: "#f4f6fb", tabbingIdentifier: "ljtex", show: false,
    webPreferences: {preload: join(__dirname, "preload.cjs"), contextIsolation: false, nodeIntegration: false, sandbox: false}});
  wins.add(w);
  if (junto && !junto.isDestroyed() && typeof junto.addTabbedWindow === "function") junto.addTabbedWindow(w);
  w.loadURL(url);
  w.once("ready-to-show", () => { w.show(); w.focus(); });
  const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u);
  // ⌘-clic o clic con la rueda en un proyecto: se abre en una pestaña nueva de LJtex (con todo lo que necesita la app)
  w.webContents.setWindowOpenHandler(({url: u}) => { if (local(u)) openWindow(u, w); else shell.openExternal(u); return {action: "deny"}; });
  w.webContents.on("will-navigate", (e, u) => { if (!local(u)) { e.preventDefault(); shell.openExternal(u); } });
  w.on("close", e => {
    if (w.ljClose || quitting) return;
    e.preventDefault();
    canCloseWin(w).then(ok => { if (ok && !w.isDestroyed()) { w.ljClose = true; w.close(); } });
  });
  w.on("closed", () => wins.delete(w));
  return w;
}

async function launch(extraEnv) {
  const r = await startServer(extraEnv);
  if (r.ok) return openWindow();
  const conflict = /LJTEX_SYNC_RESOLVE/.test(output);
  if (conflict) {
    const names = (output.match(/cambiaron en esta Mac Y en otra[^:]*: ([^\n]*)\./) || [])[1] || "";
    const {response} = await dialog.showMessageBox({type: "warning", title: "LJtex",
      message: "Un proyecto cambió en esta Mac y en la otra",
      detail: (names ? `Proyectos: ${names}\n\n` : "") + "No se tocó ninguna versión. Elige qué hacer; lo que descartes se guarda en la carpeta «respaldos».",
      buttons: ["Conservar las dos (la otra como copia)", "Conservar lo de esta Mac", "Usar lo de iCloud", "Cancelar"], defaultId: 0, cancelId: 3});
    if (response === 0) return launch({LJTEX_SYNC_RESOLVE: "both"});
    if (response === 1) return launch({LJTEX_SYNC_RESOLVE: "local"});
    if (response === 2) return launch({LJTEX_SYNC_RESOLVE: "remote"});
    return app.exit(0);
  }
  const busy = /EADDRINUSE/.test(output);
  await dialog.showMessageBox({type: "error", title: "LJtex",
    message: busy ? "Ya hay otra copia de LJtex abierta" : "LJtex no pudo arrancar",
    detail: (busy ? "Ciérrala (o detén el servidor que tengas corriendo en la terminal) y vuelve a abrir LJtex.\n\n" : "") + output.trim().split("\n").map(l => l.slice(0, 200)).filter(l => !/^\(\(\)=>|node_init|^\s*at /.test(l) || /Error/.test(l)).slice(-12).join("\n")});
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const w = cur(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.on("activate", () => { if (server && !live().length) openWindow(); });   // clic en el Dock sin ventanas abiertas
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label: app.name, submenu: [
      {role: "about"}, {label: "Buscar actualizaciones…", click: askUpdate}, {type: "separator"},
      {role: "services"}, {type: "separator"}, {role: "hide"}, {role: "hideOthers"}, {role: "unhide"}, {type: "separator"}, {role: "quit"}]},
      {label: "Archivo", submenu: [
        {label: "Nueva pestaña", accelerator: "CmdOrCtrl+T", click: newTab},
        {label: "Nueva ventana", accelerator: "CmdOrCtrl+N", click: () => openWindow()},
        {type: "separator"}, {label: "Cerrar pestaña", accelerator: "CmdOrCtrl+W", role: "close"}]}, {role: "editMenu"}, {role: "viewMenu"}, {role: "windowMenu"}]));
    launch();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", e => {
    if (quitting) return; e.preventDefault();
    canClose().then(ok => {
      if (!ok || quitting) return;   // se quedó en LJtex
      quitting = true; live().forEach(w => w.ljClose = true);
      stopServer().then(() => app.exit(0));
    });
  });
}
