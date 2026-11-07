// Corre antes que la página: deja lista la clave interna y reemplaza prompt()
const {ipcRenderer} = require("electron");
try {
  const c = ipcRenderer.sendSync("cfg");
  localStorage.setItem("clave", c.token);
  if (!localStorage.getItem("nombre")) localStorage.setItem("nombre", c.user);
} catch {}
window.prompt = (msg, def) => ipcRenderer.sendSync("prompt", String(msg), def == null ? "" : String(def));
// Actualizaciones de la app (solo existe en la app de escritorio)
window.ljtexUpdate = {
  check: () => ipcRenderer.invoke("update-check"),
  install: () => ipcRenderer.invoke("update-install"),
  onProgress: cb => { const f = (e, phase, frac) => cb(phase, frac); ipcRenderer.on("update-progress", f); return () => ipcRenderer.removeListener("update-progress", f); },
  lastResult: () => ipcRenderer.invoke("update-last"),
  openDmg: f => ipcRenderer.invoke("update-open-dmg", f),
  info: () => { try { return ipcRenderer.sendSync("build-info"); } catch { return null; } },
};
