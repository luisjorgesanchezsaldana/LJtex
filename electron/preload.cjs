// Corre antes que la página: deja lista la clave interna y reemplaza prompt()
const {ipcRenderer} = require("electron");
try {
  const c = ipcRenderer.sendSync("cfg");
  localStorage.setItem("clave", c.token);
  if (!localStorage.getItem("nombre")) localStorage.setItem("nombre", c.user);
} catch {}
window.prompt = (msg, def) => ipcRenderer.sendSync("prompt", String(msg), def == null ? "" : String(def));
