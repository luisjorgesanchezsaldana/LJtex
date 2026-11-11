// Asistente de Claude para LJtex (uso personal y local).
//
// Cómo funciona: copia los archivos de texto del proyecto a una carpeta temporal, ejecuta ahí el programa oficial
// `claude` (Claude Code) con tu propia sesión iniciada (`claude` → /login), y al terminar compara la carpeta con
// lo que había. Los cambios no se aplican solos: se devuelven como propuesta y tú aceptas o rechazas cada archivo.
//
// LJtex NUNCA ve ni guarda tus credenciales de Claude: solo lanza el programa oficial, sin modificarlo.
import {spawn, execFile} from "child_process";
import {appendFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from "fs";
import {homedir, tmpdir} from "os";
import {join, dirname} from "path";
import {randomUUID} from "crypto";

const BIN = process.env.CLAUDE_BIN || "claude";
// Límites de tiempo del asistente, en minutos: se corta si pasa AGENT_IDLE_MIN sin dar señales de vida (por defecto 3) o si en total
// pasa de AGENT_TIMEOUT_MIN (por defecto 30, es el tope absoluto). Mientras el programa siga escribiendo, no se corta por inactividad.
export const agentLimits = (env = process.env) => {
  const maxMin = +env.AGENT_TIMEOUT_MIN > 0 ? +env.AGENT_TIMEOUT_MIN : 30;
  const idleMin = Math.min(+env.AGENT_IDLE_MIN > 0 ? +env.AGENT_IDLE_MIN : 3, maxMin);
  return {idleMs: idleMin * 60e3, maxMs: maxMin * 60e3};
};
const {idleMs: IDLE, maxMs: TIMEOUT} = agentLimits();
const dur = ms => ms >= 60e3 ? (m => `${m} ${m === 1 ? "minuto" : "minutos"}`)(+(ms / 60e3).toFixed(1)) : `${Math.round(ms / 1e3)} segundos`;
// Vigilante: onIdle si pasa idleMs sin ping(), onMax si pasan maxMs desde el inicio. Se dispara una sola vez; stop() lo desactiva.
export function watchdog({idleMs, maxMs, onIdle, onMax}) {
  let idle, max, done = false;
  const stop = () => { done = true; clearTimeout(idle); clearTimeout(max); };
  const ping = () => { if (done) return; clearTimeout(idle); idle = setTimeout(() => { if (!done) { stop(); onIdle(); } }, idleMs); };
  max = setTimeout(() => { if (!done) { stop(); onMax(); } }, maxMs);
  ping();
  return {ping, stop};
}
const MAX_BIN = 20e6;                      // PDF e imágenes que se le prestan al asistente para leer, en total
const READABLE = /\.(pdf|png|jpe?g|gif|webp)$/i;
const MAX_FILE = 1e6;                       // no se manda al agente ningún archivo de texto mayor de 1 MB
const TOOLS = "Read,Edit,Write,Glob,Grep";  // solo herramientas de archivos: sin terminal ni internet

const SYSTEM = `Estás integrado en LJtex, un editor de LaTeX. El directorio actual contiene los archivos de texto del proyecto.
- Cuando te pidan un cambio, edítalo directamente en los archivos con las herramientas Edit o Write. La persona revisará tus cambios y los aceptará o rechazará, así que no hace falta pedir permiso.
- Haz los cambios mínimos necesarios. Conserva el estilo, las macros, las etiquetas, las claves de bibliografía y la estructura. No reformatees ni reescribas lo que no te piden.
- Si hay una selección, limita los cambios a ella, salvo que se pida otra cosa.
- No toques los archivos .bib salvo que te lo pidan, y nunca inventes referencias, datos ni resultados.
- No puedes ejecutar comandos ni compilar, y no hace falta: la aplicación compila el documento por su cuenta y le muestra el resultado a la persona. Por eso NUNCA digas que no pudiste compilar ni que no has comprobado que compile; simplemente cuida que tu LaTeX sea correcto (llaves y entornos equilibrados, paquetes y macros que existan). Si te pasan errores de compilación, corrígelos en el código fuente.
- Si la petición es una pregunta o una explicación, responde sin editar nada.
- Si te piden escribir, añadir o redactar contenido (un teorema, una demostración, una sección, un párrafo…), insértalo con Edit o Write en el archivo abierto: en la línea del cursor si te la indican; si no, en un lugar lógico del cuerpo (por ejemplo, antes de \\end{document}). Contestar solo en el chat NO cuenta: la persona espera ver los cambios propuestos en el archivo.
- Cuando te refieras a un lugar concreto del proyecto, cítalo siempre como archivo.tex:línea (o archivo.tex:inicio-fin, por ejemplo main.tex:42), con la ruta tal como está en el proyecto: la aplicación lo convierte en un enlace que lleva a esa línea.
- Nunca digas que cambiaste algo si no lo editaste de verdad con Edit o Write. Si una edición falla, dilo.
- Si hay una «Conversación anterior», úsala como contexto: «hazlo», «lo de antes» o «no se aplicó» se refieren a ella. Cada petición empieza con los archivos tal como están ahora, sin los cambios que la persona no haya aceptado.
- Responde siempre en español, de forma breve: qué cambiaste y por qué (o la respuesta). Puedes usar Markdown (negritas, listas cortas, tablas y bloques de código con \`\`\`latex) y escribir las fórmulas en LaTeX entre $…$ (en línea) o $$…$$ (en bloque); se mostrarán con formato.`;

const CLAIMS = /(?<![\p{L}])(agregu[ée]|a[ñn]ad[ií]|escrib[ií]|inclu[ií]|insert[ée]|cambi[ée]|modifiqu[ée]|corregí|correg[ií]|reescrib[ií]|cre[ée]|reemplac[ée]|actualic[ée]|he (hecho|escrito|agregado|añadido|modificado|cambiado|incluido|creado|corregido)|hice (los )?cambios)(?![\p{L}])/iu;
const loopback = ip => /^(::1|127\.|::ffff:127\.)/.test(ip || "");
// Solo desde esta misma computadora: así un coautor conectado a tu servidor no gasta tu suscripción.
export const isLocal = q => {
  const fwd = String(q.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return loopback(q.socket.remoteAddress) && (!fwd || loopback(fwd));
};

const ruta = p => p.split("\\").join("/");
function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    if (e.name.startsWith(".")) continue;                    // p. ej. la carpeta .claude que crea el programa
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(ruta(p.slice(base.length + 1)));
  }
  return out;
}
const isText = buf => !buf.includes(0);


// Por qué un «ya lo hice» no dejó cambios: herramientas que no estaban, rutas fuera de la carpeta, permisos…
function diagnose(job, dir) {
  let real = dir; try { real = realpathSync(dir); } catch {}
  const edits = job.trace.filter(x => /^(Edit|Write|MultiEdit|NotebookEdit) /.test(x));
  const tools = job.init?.tools;
  if (Array.isArray(tools) && !tools.some(t => /^(Edit|Write)$/.test(t)))
    return `Claude Code no le dio al asistente ninguna herramienta para editar archivos (solo tiene: ${tools.join(", ") || "ninguna"}). Lo que dice haber hecho no ocurrió.`;
  if (job.denials.length) return `Claude Code bloqueó la edición por permisos (${job.denials.slice(0, 2).join("; ")}). No se cambió nada.`;
  if (job.toolErrors.length) return "El asistente intentó editar los archivos pero no lo logró: " + job.toolErrors[0];
  const outside = edits.map(x => (/"file_path":"([^"]+)"/.exec(x) || [])[1]).filter(f => f && !(f.startsWith(dir + "/") || f.startsWith(real + "/") || !f.startsWith("/")));
  if (outside.length) return `El asistente editó «${outside[0]}», que está fuera de la carpeta del proyecto, así que no hay cambios que aceptar.`;
  if (edits.length) return `El asistente usó la herramienta de edición (${edits.length} ${edits.length === 1 ? "vez" : "veces"}) pero los archivos quedaron igual. Carpeta de trabajo: ${job.init?.cwd || "?"}.`;
  if (CLAIMS.test(job.text)) return "El asistente dice que hizo cambios, pero no usó ninguna herramienta de edición ni modificó ningún archivo, así que no hay nada que aceptar.";
  return "";
}
// Registro de la última petición, para poder ver qué pasó realmente (~/Manuscrito-datos/agente-ultimo.log)
function writeTrace(job, dir) {
  try {
    const d = process.env.DB ? dirname(process.env.DB) : join(homedir(), "Manuscrito-datos"); mkdirSync(d, {recursive: true});
    const txt = [`# ${new Date(job.t).toISOString()} · ${job.state}`, `petición: ${job.prompt.slice(0, 300)}`, `carpeta: ${dir}`, `init: ${JSON.stringify(job.init)}`,
      "pasos:", ...job.trace.map(x => "  " + x), `cambios detectados: ${job.changes.map(c => c.kind + " " + c.path).join(", ") || "ninguno"}`, `aviso: ${job.warn || "-"}`, "respuesta:", job.text.slice(0, 1500), ""].join("\n");
    writeFileSync(join(d, "agente-ultimo.log"), txt);
  } catch {}
}

// Combinación a tres bandas por líneas: «base» es el texto del que partió el asistente, «ahora» el que hay hoy y «propuesta» lo que propone.
// Devuelve el texto combinado, o null si ambos tocaron las mismas líneas (entonces hay que decidir a mano).
function lineHunks(a, b) {
  const x = a.split("\n"), y = b.split("\n");
  let s = 0; while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0; while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const n = x.length - s - e, m = y.length - s - e;
  if (!n && !m) return [];
  if (!n || !m || n * m > 4e6) return [{a0: s, a1: s + n, lines: y.slice(s, s + m)}];
  const W = m + 1, L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i * W + j] = x[s + i] === y[s + j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const out = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && x[s + i] === y[s + j]) { flush(); i++; j++; continue; }
    cur ||= {a0: s + i, a1: s + i, lines: []};
    if (j >= m || (i < n && L[(i + 1) * W + j] >= L[i * W + j + 1])) { i++; cur.a1 = s + i; } else { cur.lines.push(y[s + j]); j++; }
  }
  flush();
  return out;
}
export function merge3(base, ahora, propuesta) {
  if (ahora === base) return propuesta;
  if (propuesta === base || propuesta === ahora) return ahora;
  const A = lineHunks(base, propuesta).map(h => ({...h, o: "p"})), B = lineHunks(base, ahora).map(h => ({...h, o: "a"}));
  const all = [...A, ...B].sort((p, q) => p.a0 - q.a0 || p.a1 - q.a1);
  for (let k = 1; k < all.length; k++) {
    const p = all[k - 1], q = all[k];
    if (p.a1 > q.a0 || (p.a1 === q.a0 && (p.a0 === p.a1 || q.a0 === q.a1))) {      // se pisan, o dos inserciones en el mismo punto
      if (p.o !== q.o && p.a0 === q.a0 && p.a1 === q.a1 && p.lines.join("\n") === q.lines.join("\n")) { all.splice(k, 1); k--; continue; }   // hicieron exactamente lo mismo
      return null;
    }
  }
  const x = base.split("\n"), out = []; let pos = 0;
  for (const h of all) { for (; pos < h.a0; pos++) out.push(x[pos]); out.push(...h.lines); pos = h.a1; }
  for (; pos < x.length; pos++) out.push(x[pos]);
  return out.join("\n");
}

export function registerAgent(app, h) {
  const {db, hp, who, okPath, clashes, getFile, getDocText, lastVersion, addVersion, flushPending, setDocText, takeSnapshot, touch, log, deleteFile, track, lineDiff, verify} = h;
  const jobs = new Map();
  let running = null, vcache = {t: 0, v: null};
  // Conversaciones guardadas (por proyecto) y propuestas del asistente: sobreviven a cerrar el panel, recargar o reiniciar.
  db.exec(`create table if not exists chats(id text primary key, project text, title text, t integer, updated integer, items text);
    create table if not exists agent_jobs(id text primary key, project text, prompt text, t integer, text text, changes text, applied text);`);
  db.prepare("delete from agent_jobs where t < ?").run(Date.now() - 60 * 864e5);
  const getJob = id => {
    const j = jobs.get(id); if (j) return j;
    const row = db.prepare("select * from agent_jobs where id=?").get(id); if (!row) return null;
    const loaded = {id, project: row.project, prompt: row.prompt, t: row.t, state: "done", activity: [], text: row.text || "", error: "",
      changes: JSON.parse(row.changes || "[]"), applied: new Set(JSON.parse(row.applied || "[]")), base: new Map()};
    jobs.set(id, loaded); return loaded;
  };
  const saveJob = j => db.prepare("insert or replace into agent_jobs(id,project,prompt,t,text,changes,applied) values(?,?,?,?,?,?,?)")
    .run(j.id, j.project, j.prompt, j.t, j.text, JSON.stringify(j.changes), JSON.stringify([...j.applied]));
  const forgetProject = project => {
    db.prepare("delete from chats where project=?").run(project);
    db.prepare("delete from agent_jobs where project=?").run(project);
  };

  function version() {
    return new Promise(res => {
      if (Date.now() - vcache.t < 30e3) return res(vcache.v);
      execFile(BIN, ["--version"], {timeout: 15000}, (err, out) => { vcache = {t: Date.now(), v: err ? {error: err} : {ok: String(out).trim()}}; res(vcache.v); });
    });
  }
  const stats = (a, b) => { const d = lineDiff(a, b); return {add: d.add.length, del: d.del.length}; };

  app.get("/api/agent/status", async (q, r) => {
    if (!isLocal(q)) return r.json({available: false, reason: "remote", text: "El asistente solo está disponible desde la computadora donde corre Manuscrito."});
    const v = await version();
    if (v.error) return r.json({available: false, reason: "missing",
      text: v.error.code === "ENOENT" ? "No encuentro el programa «claude». Instala Claude Code, abre una Terminal, escribe claude e inicia sesión con tu cuenta; luego reinicia Manuscrito."
        : "No pude ejecutar «claude»: " + v.error.message});
    r.json({available: true, version: v.ok, busy: !!running});
  });

  app.post("/api/agent/start", async (q, r) => {
    if (!isLocal(q)) return r.status(403).json({error: "El asistente solo está disponible desde esta computadora."});
    if (running) return r.status(429).json({error: "El asistente ya está trabajando en otra petición."});
    const {project, path, selection, errors} = q.body, prompt = String(q.body.prompt || "").trim().slice(0, 8000);
    if (!prompt) return r.status(400).json({error: "Escribe qué quieres que haga."});
    if (!db.prepare("select 1 from projects where id=?").get(project)) return r.status(404).json({error: "El proyecto no existe."});
    const v = await version(); if (v.error) return r.status(503).json({error: "No encuentro el programa «claude» (Claude Code). Instálalo e inicia sesión."});

    const rows = db.prepare("select path,kind,text,length(data) as size from files where project=?").all(project);
    const dir = mkdtempSync(join(tmpdir(), "manuscrito-agente-")), base = new Map(), skipped = [], readonly = new Set();
    // PDF e imágenes: solo se copian (para que el asistente los LEA) los que se nombran en la petición, o el único PDF si se pide «el pdf» sin más
    const low = prompt.toLowerCase(), pdfs = rows.filter(f => f.kind === "bin" && /\.pdf$/i.test(f.path));
    const named = f => { const b = f.path.split("/").at(-1).toLowerCase(), stem = b.replace(/\.[^.]+$/, ""); return low.includes(b) || (stem.length >= 3 && low.includes(stem)); };
    const wanted = new Set(rows.filter(f => f.kind === "bin" && READABLE.test(f.path) && named(f)).map(f => f.path));
    if (!wanted.size && pdfs.length === 1 && /\bpdf\b/.test(low)) wanted.add(pdfs[0].path);
    let binBudget = MAX_BIN;
    for (const f of rows) {
      if (f.kind === "bin" && wanted.has(f.path) && f.size <= binBudget) {
        const row = db.prepare("select data from files where project=? and path=?").get(project, f.path);
        if (row?.data) { const p = join(dir, f.path); mkdirSync(dirname(p), {recursive: true}); writeFileSync(p, row.data); readonly.add(f.path); binBudget -= f.size; continue; }
      }
      if (f.kind !== "text") { skipped.push(f.path); continue; }
      const text = getDocText(`${project}/${f.path}`);
      if (text.length > MAX_FILE) { skipped.push(f.path); continue; }
      base.set(f.path, text);
      const p = join(dir, f.path); mkdirSync(dirname(p), {recursive: true}); writeFileSync(p, text);
    }
    // Archivos que la persona adjuntó en el chat: solo para leer, no pasan a ser parte del proyecto
    const adj = [];
    {
      const list = Array.isArray(q.body.attachments) ? q.body.attachments.slice(0, 6) : []; let tot = 0;
      for (const x of list) {
        const nm = String(x?.name || "").normalize("NFC").split(/[\\/]/).pop().replace(/[^\p{L}\p{N}_\-. ]+/gu, "_").replace(/^\.+/, "_").slice(0, 80);
        if (!/\.(png|jpe?g|gif|webp|pdf|txt|tex|bib|csv|md)$/i.test(nm)) continue;
        const buf = Buffer.from(String(x?.data || ""), "base64"); tot += buf.length;
        if (!buf.length || tot > 15e6) continue;
        let n = "adjuntos/" + nm, k = 2; while (adj.includes(n) || rows.some(f => f.path === n)) n = `adjuntos/${k++}-${nm}`;
        const pth = join(dir, n); mkdirSync(dirname(pth), {recursive: true}); writeFileSync(pth, buf); readonly.add(n); adj.push(n);
      }
    }
    let msg = "";
    const mainFile = db.prepare("select main from projects where id=?").get(project)?.main || "main.tex";
    if (base.has(mainFile)) msg += `Archivo principal del proyecto (el que se compila): ${mainFile}\n`;
    if (path && base.has(path)) msg += `Archivo abierto en el editor: ${path}\n`;
    if (selection?.text) msg += `\nLa persona tiene seleccionadas las líneas ${selection.from}–${selection.to} de ese archivo:\n<seleccion>\n${String(selection.text).slice(0, 20000)}\n</seleccion>\n`;
    const cursor = Math.floor(+q.body.cursor);
    if (path && base.has(path) && cursor >= 1 && !selection?.text) msg += `El cursor de la persona está en la línea ${cursor} de ese archivo.\n`;
    // Conversación anterior: cada petición es una ejecución nueva de Claude; sin esto no sabría de qué se habla.
    // Va de dos formas: la última respuesta del asistente COMPLETA dentro del mensaje (es a la que casi siempre se refiere «implementa todo»),
    // y toda la conversación sin recortar en un archivo de solo lectura que puede abrir si necesita algo más antiguo.
    const raw = (Array.isArray(q.body.history) ? q.body.history : []).slice(-40)
      .map(x => ({role: ["user", "assistant", "note"].includes(x?.role) ? x.role : null, text: String(x?.text || "").trim()})).filter(x => x.role && x.text);
    const lastA = raw.map(x => x.role).lastIndexOf("assistant");
    const hist = raw.slice(-16).map((x, i, a) => ({role: x.role, text: x.text.replace(/\s+/g, " "), full: x === raw[lastA]}))
      .map(x => ({...x, text: x.full ? x.text.slice(0, 40000) : x.text.slice(0, x.role === "assistant" ? 2000 : 800)}));
    let hs = "", used = 0;
    for (const x of hist.reverse()) { const l = (x.role === "user" ? "Persona: " : x.role === "assistant" ? "Asistente: " : "(Nota: ") + x.text + (x.role === "note" ? ")" : "") + "\n"; if (!x.full && used + l.length > 10000) break; hs = l + hs; if (!x.full) used += l.length; }
    if (hs) {
      let cname = "conversacion-anterior.md"; while (rows.some(f => f.path === cname)) cname = "_" + cname;
      const md = raw.map(x => (x.role === "user" ? "## Persona\n\n" : x.role === "assistant" ? "## Asistente\n\n" : "## (Nota)\n\n") + x.text.slice(0, 150000)).join("\n\n").slice(-600000);
      writeFileSync(join(dir, cname), md); readonly.add(cname);
      msg += `\nConversación anterior (contexto; los archivos de arriba son el estado actual). Las respuestas más antiguas están abreviadas aquí; la conversación completa y sin recortar está en el archivo ${cname}, que puedes LEER con Read si necesitas algo más:\n<conversacion>\n${hs}</conversacion>\n`;
    }
    if (errors) msg += `\nErrores de la última compilación:\n${String(errors).slice(0, 3000)}\n`;
    if (adj.length) msg += `\nLa persona adjuntó estos archivos a su mensaje: ${adj.join(", ")}. Ábrelos y léelos con Read antes de responder (las imágenes y los PDF se pueden leer). Son solo de referencia: no están en el proyecto y no los edites; si hay que usar una imagen en el documento, díselo a la persona para que la suba al proyecto.\n`;
    if (readonly.size) msg += `\nArchivos que puedes LEER (están en la carpeta, pero no los edites): ${[...readonly].join(", ")}. Si es un PDF largo, léelo por partes con el parámetro pages y solo lo que necesites.\n`;
    if (skipped.length) msg += `\n(Otros archivos del proyecto que no tienes disponibles: ${skipped.slice(0, 40).join(", ")}. Si necesitas leer uno de ellos, dile a la persona que escriba su nombre en la petición.)\n`;
    msg += `\nPetición:\n${prompt}\n`;

    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--tools", TOOLS,
      "--strict-mcp-config", "--no-session-persistence", "--append-system-prompt", SYSTEM];
    const pick = /^(sonnet|opus|haiku)$/.test(String(q.body.model || "")) ? q.body.model : process.env.AGENT_MODEL;   // solo alias conocidos: nada arbitrario llega a la línea de comandos
    if (pick) args.push("--model", pick);
    const env = {...process.env};
    // Si hubiera una clave de API en el entorno, se cobraría a esa cuenta en vez de usar tu sesión de Claude: se ignora.
    if (process.env.AGENT_USE_API_KEY !== "1") { delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; }

    const job = {id: randomUUID().slice(0, 12), project, prompt, t: Date.now(), state: "running", activity: [], text: "", changes: [], error: "", warn: "", toolErrors: [], trace: [], init: null, denials: [], applied: new Set(), base};
    jobs.set(job.id, job); running = job;
    for (const [k, j] of jobs) if (Date.now() - j.t > 3600e3 && j !== running) jobs.delete(k);

    let err = "", buf = "", finished = false;
    const proc = spawn(BIN, args, {cwd: dir, env, stdio: ["pipe", "pipe", "pipe"]});
    job.proc = proc;
    let deferred = false;
    const end = () => {
      if (finished) return; finished = true; wd.stop(); running = null;
      try {
        if (job.state === "running" || job.state === "stopping") {
          if (job.state === "stopping") job.state = "cancelled";
          else {
            const now = new Map();
            for (const p of walk(dir)) {
              if (!okPath(p) || readonly.has(p)) continue;
              const abs = join(dir, p); if (statSync(abs).size > MAX_FILE) continue;
              const b = readFileSync(abs); if (isText(b)) now.set(p, b.toString("utf8"));
            }
            for (const [p, after] of now) {
              if (!base.has(p)) job.changes.push({path: p, kind: "new", before: "", after, ...stats("", after)});
              else if (base.get(p) !== after) job.changes.push({path: p, kind: "mod", before: base.get(p), after, ...stats(base.get(p), after)});
            }
            for (const [p, before] of base) if (!now.has(p)) job.changes.push({path: p, kind: "del", before, after: "", ...stats(before, "")});
            job.changes.sort((a, b) => a.path.localeCompare(b.path));
            if (!job.error && job.changes.length && verify) {
              // Antes de dar la respuesta, se comprueba (con la compilación de siempre, no con el asistente) que el documento compila con estos cambios
              deferred = true; job.activity.push("Comprobando que el documento compila con estos cambios…");
              verify(project, path, new Map(job.changes.map(c => [c.path, c.kind === "del" ? null : c.after])))
                .then(c => { job.check = c; }).catch(() => {})
                .finally(() => { job.state = "done"; try { writeTrace(job, dir); } catch {} finish(); });
            } else {
              job.state = job.error ? "error" : "done";
              if (job.state === "done" && !job.text && !job.changes.length) job.text = "No hice ningún cambio.";
              if (job.state === "done" && !job.changes.length) job.warn = diagnose(job, dir);
              writeTrace(job, dir);
            }
          }
        }
      } catch (e) { job.state = "error"; job.error = "No pude leer los cambios del asistente: " + e.message; }
      if (!deferred) finish();
    };
    const finish = () => {
      if (job.state === "error" && !job.error) job.error = "El asistente terminó con un error.";
      if (job.state === "done") try { saveJob(job); } catch {}
      rmSync(dir, {recursive: true, force: true});
      delete job.proc;
    };
    const wd = watchdog({idleMs: IDLE, maxMs: TIMEOUT,
      onIdle: () => { job.error = `El asistente dejó de responder durante ${dur(IDLE)} y se detuvo.`; proc.kill("SIGKILL"); },
      onMax: () => { job.error = `El asistente tardó más de ${dur(TIMEOUT)} en total y se detuvo.`; proc.kill("SIGKILL"); }});

    proc.stdout.on("data", d => {
      wd.ping(); buf += d; let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { job.trace.push("stdout: " + line.slice(0, 300)); continue; }
        if (ev.type === "system" && ev.subtype === "init") job.init = {tools: ev.tools, cwd: ev.cwd, model: ev.model, permissionMode: ev.permissionMode};
        if (ev.type === "assistant") for (const c of ev.message?.content || []) {
          if (c.type === "tool_use") {
            job.trace.push(`${c.name} ${JSON.stringify(c.input || {}).slice(0, 200)}`);
            const f = String(c.input?.file_path || c.input?.path || c.input?.pattern || "").replace(dir + "/", "");
            const w = {Read: "Leyendo", Edit: "Editando", Write: "Escribiendo", Glob: "Buscando archivos", Grep: "Buscando en el texto"}[c.name] || c.name;
            job.activity.push(f ? `${w} ${f}` : w);
          }
        }
        if (ev.type === "user") for (const c of ev.message?.content || []) {
          if (c.type === "tool_result" && c.is_error) {
            const t = (typeof c.content === "string" ? c.content : (c.content || []).map(x => x.text || "").join(" ")).replace(/\s+/g, " ").trim().slice(0, 200);
            job.trace.push("ERROR de herramienta: " + t);
            job.toolErrors.push(t || "error desconocido"); job.activity.push("⚠ " + (t || "error al editar"));
          }
        }
        if (ev.type === "result") {
          if (Array.isArray(ev.permission_denials) && ev.permission_denials.length) {
            job.denials = ev.permission_denials.map(d => `${d.tool_name} ${String(d.tool_input?.file_path || "").slice(0, 150)}`.trim());
            job.trace.push("permisos denegados: " + job.denials.join("; "));
          }
          job.trace.push(`resultado: ${ev.subtype || ""} turnos=${ev.num_turns ?? "?"}`);
          job.text = String(ev.result || "").trim();
          if (ev.is_error) job.error = job.text || "El asistente terminó con un error.";
        }
      }
    });
    proc.stderr.on("data", d => { wd.ping(); err = (err + d).slice(-2000); });
    proc.on("error", e => { job.error = e.code === "ENOENT" ? "No encuentro el programa «claude»." : "No pude ejecutar «claude»: " + e.message; end(); });
    proc.on("close", code => {
      if (code && !job.error && job.state === "running") job.error = (/log ?in|auth|credential|401/i.test(err + job.text)
        ? "Claude Code no tiene la sesión iniciada. Abre una Terminal, escribe claude y usa /login con tu cuenta." : "El asistente terminó con un error." + (err ? "\n" + err.trim().slice(-400) : ""));
      end();
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(msg);
    r.json({job: job.id});
  });

  const view = (j, full) => ({state: j.state, activity: j.activity.slice(-30), text: j.text, error: j.error, warn: j.warn || "", check: j.check || null, prompt: j.prompt,
    changes: j.state === "done" ? j.changes.map(c => full ? {...c, applied: j.applied.has(c.path)} : {path: c.path, kind: c.kind, add: c.add, del: c.del, applied: j.applied.has(c.path)}) : []});
  app.get("/api/agent/job/:id", (q, r) => {
    const j = getJob(q.params.id); if (!j) return r.status(404).json({error: "Esa petición ya no existe."});
    r.json(view(j, q.query.full === "1"));
  });
  app.post("/api/agent/cancel", (q, r) => {
    const j = jobs.get(q.body.job);
    if (j?.proc && j.state === "running") { j.state = "stopping"; j.proc.kill("SIGTERM"); setTimeout(() => j.proc?.kill("SIGKILL"), 3000); }
    r.json({ok: true});
  });

  // Aplicar los cambios que la persona aceptó. Si un archivo cambió mientras el asistente trabajaba, no se pisa sin avisar.
  app.post("/api/agent/apply", async (q, r) => {
    if (!isLocal(q)) return r.status(403).json({error: "Solo desde esta computadora."});
    const j = getJob(q.body.job); if (!j || j.state !== "done") return r.status(404).json({error: "Esa propuesta ya no existe (caducó o se borró)."});
    const {paths, force} = q.body, me = who(q), project = j.project, applied = [], conflicts = [], errors = [], merged = [];
    // Revisión parcial: la persona aceptó solo algunos trozos, así que se aplica el texto final que quedó en su pantalla
    for (const [p, t] of Object.entries(q.body.texts && typeof q.body.texts === "object" ? q.body.texts : {})) {
      const c = j.changes.find(x => x.path === p);
      if (c && c.kind !== "del" && typeof t === "string" && t.length <= MAX_FILE && t !== c.after) { c.after = t; Object.assign(c, stats(c.before, t)); }
    }
    const label = "Asistente: " + j.prompt.replace(/\s+/g, " ").slice(0, 80);
    for (const path of Array.isArray(paths) ? paths : []) {
      const c = j.changes.find(x => x.path === path); if (!c || j.applied.has(path)) continue;
      const doc = `${project}/${path}`;
      try {
        if (c.kind === "mod") {
          if (!getFile(project, path)) { errors.push(`«${path}» ya no existe.`); continue; }
          flushPending(doc);
          const now = getDocText(doc);
          let fin = c.after;
          if (now !== c.before && !force) {
            // El archivo cambió mientras tanto (p. ej. aceptaste otra propuesta): se combinan los dos cambios si no tocan las mismas líneas
            const m = merge3(c.before, now, c.after);
            if (m == null) { conflicts.push(path); continue; }
            fin = m; merged.push(path);
          }
          if (now !== lastVersion(doc)?.text) addVersion(doc, "", "Estado antes del asistente", true, now);
          await setDocText(doc, fin, "Claude");
          addVersion(doc, "Claude", label, false, fin);
          track.delete(doc);
        } else if (c.kind === "new") {
          const all = db.prepare("select path from files where project=?").all(project).map(f => f.path);
          if (all.includes(path)) { if (!force) { conflicts.push(path); continue; } }
          else if (clashes(all, path)) { errors.push(`«${path}» choca con otro archivo o carpeta.`); continue; }
          const before = takeSnapshot(project);
          db.prepare("insert or replace into files(project,path,kind,text,data,hash) values(?,?,?,?,?,?)").run(project, path, "text", c.after, null, null);
          log(project, "Claude", "create", path, label, before);
          addVersion(doc, "Claude", label, false, c.after);
        } else if (c.kind === "del") {
          const row = getFile(project, path);
          if (row) {
            if (getDocText(doc) !== c.before && !force) { conflicts.push(path); continue; }
            const before = takeSnapshot(project);
            deleteFile(project, path); log(project, "Claude", "delete", path, label, before);
          }
        }
        touch(project); j.applied.add(path); applied.push(path);
      } catch (e) { errors.push(`«${path}»: ${e.message}`); }
    }
    if (applied.length) try { saveJob(j); } catch {}
    r.json({applied, conflicts, errors, merged});
  });

  // ---------- Fórmula desde una imagen ----------
  let formulaBusy = false;
  app.post("/api/agent/formula", async (q, r) => {
    if (!isLocal(q)) return r.status(403).json({error: "El asistente solo está disponible desde esta computadora."});
    if (formulaBusy) return r.status(429).json({error: "Ya estoy convirtiendo otra imagen. Espera un momento."});
    const mime = String(q.body.mime || ""), ext = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}[mime];
    if (!ext) return r.status(400).json({error: "Usa una imagen PNG, JPG, GIF o WebP."});
    const buf = Buffer.from(String(q.body.data || ""), "base64"); if (!buf.length || buf.length > 8e6) return r.status(400).json({error: "La imagen está vacía o pesa más de 8 MB."});
    const v = await version(); if (v.error) return r.status(503).json({error: "No encuentro el programa «claude» (Claude Code). Instálalo e inicia sesión."});
    formulaBusy = true;
    const dir = mkdtempSync(join(tmpdir(), "manuscrito-formula-")), file = `formula.${ext}`;
    writeFileSync(join(dir, file), buf);
    const mode = q.body.mode === "text" ? "texto con fórmulas" : "fórmula";
    const prompt = `Lee la imagen ${file} (usa la herramienta Read) y transcribe su contenido matemático a LaTeX.\n` +
      `- Es una ${mode}. ${q.body.mode === "text" ? "Transcribe el texto tal cual (en el idioma original) con las fórmulas entre $…$ o \\[…\\]." : "Devuelve solo el código de la fórmula, sin \\[ \\] ni $ alrededor, salvo que haya varias líneas: en ese caso usa un entorno aligned."}\n` +
      "- Usa comandos estándar de amsmath. No expliques nada. Si algo es ilegible, escribe tu mejor lectura y añade al final una línea «% revisar: …».\n" +
      "- Responde ÚNICAMENTE con un bloque ```latex … ```.";
    const args = ["-p", "--output-format", "text", "--permission-mode", "acceptEdits", "--tools", "Read", "--strict-mcp-config", "--no-session-persistence"];
    if (/^(sonnet|opus|haiku)$/.test(String(q.body.model || ""))) args.push("--model", q.body.model);
    const env = {...process.env}; if (process.env.AGENT_USE_API_KEY !== "1") { delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; }
    let out = "", err = "", done = false;
    const proc = spawn(BIN, args, {cwd: dir, env, stdio: ["pipe", "pipe", "pipe"]});
    const finish = (code, body) => { if (done) return; done = true; clearTimeout(tm); formulaBusy = false; rmSync(dir, {recursive: true, force: true}); r.status(code).json(body); };
    const tm = setTimeout(() => { proc.kill("SIGKILL"); finish(504, {error: "Tardó demasiado en leer la imagen. Inténtalo de nuevo."}); }, 120e3);
    proc.stdout.on("data", d => { out = (out + d).slice(-20000); });
    proc.stderr.on("data", d => { err = (err + d).slice(-1500); });
    proc.on("error", e => finish(500, {error: e.code === "ENOENT" ? "No encuentro el programa «claude»." : "No pude ejecutar «claude»: " + e.message}));
    proc.on("close", code => {
      const m = /```(?:latex|tex)?\s*\n([\s\S]*?)```/.exec(out), latex = (m ? m[1] : out).trim();
      if (code && !latex) return finish(500, {error: /log ?in|auth|credential|401/i.test(err + out) ? "Claude Code no tiene la sesión iniciada. Abre una Terminal, escribe claude y usa /login." : "No pude leer la imagen." + (err ? "\n" + err.trim().slice(-300) : "")});
      if (!latex) return finish(422, {error: "No encontré ninguna fórmula en la imagen."});
      finish(200, {latex});
    });
    proc.stdin.on("error", () => {}); proc.stdin.end(prompt);
  });

  // ---------- Conversaciones ----------
  app.get("/api/projects/:id/chats", (q, r) => {
    const rows = db.prepare("select id,title,t,updated,items from chats where project=? order by updated desc").all(q.params.id);
    r.json(rows.map(c => ({id: c.id, title: c.title, t: c.t, updated: c.updated, n: JSON.parse(c.items || "[]").filter(i => i.t === "user").length})));
  });
  app.get("/api/chats/:id", (q, r) => {
    const c = db.prepare("select * from chats where id=?").get(q.params.id);
    if (!c) return r.status(404).json({error: "Esa conversación ya no existe."});
    r.json({id: c.id, project: c.project, title: c.title, t: c.t, updated: c.updated, items: JSON.parse(c.items || "[]")});
  });
  app.put("/api/chats/:id", (q, r) => {
    const {project, title, items} = q.body, id = String(q.params.id);
    if (!/^[\w-]{6,40}$/.test(id) || !Array.isArray(items)) return r.status(400).json({error: "Datos no válidos."});
    if (!db.prepare("select 1 from projects where id=?").get(project)) return r.status(404).json({error: "El proyecto no existe."});
    const json = JSON.stringify(items); if (json.length > 3e6) return r.status(413).json({error: "La conversación es demasiado larga."});
    const old = db.prepare("select project,t from chats where id=?").get(id);
    if (old && old.project !== project) return r.status(403).json({error: "Esa conversación es de otro proyecto."});
    db.prepare("insert or replace into chats(id,project,title,t,updated,items) values(?,?,?,?,?,?)")
      .run(id, project, String(title || "Conversación").slice(0, 80), old?.t || Date.now(), Date.now(), json);
    r.json({ok: true});
  });
  app.delete("/api/chats/:id", (q, r) => { db.prepare("delete from chats where id=?").run(q.params.id); r.sendStatus(204); });
  return {forgetProject};
}
