// Pruebas del límite de tiempo del asistente (inactividad + tope absoluto), con un «claude» falso: no se usa el programa real ni tu sesión.
// Se corren con:  npm test
import {test, after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, chmodSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import http from "node:http";

const tmp = mkdtempSync(join(tmpdir(), "ljtex-agente-test-"));
const fake = join(tmp, "claude");
// «claude» falso: según una palabra clave de la petición (que le llega por stdin) se comporta de una forma distinta.
writeFileSync(fake, String.raw`#!/usr/bin/env node
const fs = require("fs");
if (process.argv.includes("--version")) { console.log("fake 1.0"); process.exit(0); }
let input = ""; process.stdin.on("data", d => input += d);
process.stdin.on("end", () => {
  const out = o => process.stdout.write(JSON.stringify(o) + "\n");
  const say = t => out({type: "assistant", message: {content: [{type: "text", text: t}]}});
  out({type: "system", subtype: "init", tools: ["Read", "Edit", "Write", "Glob", "Grep"], cwd: process.cwd(), model: "fake"});
  const result = t => { out({type: "result", subtype: "success", is_error: false, num_turns: 1, result: t}); process.exit(0); };
  if (input.includes("MODO-MUDO")) return setInterval(() => {}, 1e6);                                   // no vuelve a decir nada
  if (input.includes("MODO-INFINITO")) return setInterval(() => say("sigo"), 500);                      // habla para siempre
  if (input.includes("MODO-LENTO")) { let n = 0; return setInterval(() => { say("trabajando"); if (++n === 8) { fs.appendFileSync("main.tex", "\n% editado\n"); result("Listo."); } }, 500); }
  result("Respuesta rápida.");
});
`);
chmodSync(fake, 0o755);
// Los límites se leen al cargar agent.js, así que se fijan antes de importarlo (minutos fraccionarios para que la prueba sea corta)
process.env.CLAUDE_BIN = fake;
process.env.AGENT_IDLE_MIN = "0.03";        // 1,8 s de silencio
process.env.AGENT_TIMEOUT_MIN = "0.1";      // 6 s en total
process.env.DB = join(tmp, "x.db");         // el registro de la última petición cae aquí, no en ~/Manuscrito-datos
delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
const {agentLimits, watchdog, registerAgent} = await import("../agent.js");
const {default: express} = await import("express");

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- agentLimits ----------
test("límites por defecto: 3 min de silencio y 30 min en total", () => {
  assert.deepEqual(agentLimits({}), {idleMs: 3 * 60e3, maxMs: 30 * 60e3});
});
test("los límites se pueden cambiar con AGENT_IDLE_MIN y AGENT_TIMEOUT_MIN", () => {
  assert.deepEqual(agentLimits({AGENT_IDLE_MIN: "5", AGENT_TIMEOUT_MIN: "45"}), {idleMs: 5 * 60e3, maxMs: 45 * 60e3});
});
test("la inactividad nunca pasa del tope total", () => {
  assert.deepEqual(agentLimits({AGENT_IDLE_MIN: "10", AGENT_TIMEOUT_MIN: "2"}), {idleMs: 2 * 60e3, maxMs: 2 * 60e3});
});
test("valores inválidos (0, negativos, texto) vuelven a los de por defecto", () => {
  for (const v of ["0", "-4", "abc", ""]) assert.deepEqual(agentLimits({AGENT_IDLE_MIN: v, AGENT_TIMEOUT_MIN: v}), {idleMs: 3 * 60e3, maxMs: 30 * 60e3}, `con «${v}»`);
});

// ---------- watchdog ----------
test("watchdog: sin señales se dispara onIdle, una sola vez", async () => {
  const ev = []; watchdog({idleMs: 80, maxMs: 1000, onIdle: () => ev.push("idle"), onMax: () => ev.push("max")});
  await sleep(300); assert.deepEqual(ev, ["idle"]);
});
test("watchdog: mientras haya ping() no se dispara onIdle", async () => {
  const ev = []; const w = watchdog({idleMs: 120, maxMs: 2000, onIdle: () => ev.push("idle"), onMax: () => ev.push("max")});
  for (let i = 0; i < 8; i++) { await sleep(60); w.ping(); }       // 480 ms en total: supera idleMs, pero nunca hubo 120 ms seguidos de silencio
  assert.deepEqual(ev, []); w.stop();
});
test("watchdog: el tope total se dispara aunque siga habiendo ping()", async () => {
  const ev = []; const w = watchdog({idleMs: 200, maxMs: 400, onIdle: () => ev.push("idle"), onMax: () => ev.push("max")});
  for (let i = 0; i < 12; i++) { await sleep(50); w.ping(); }
  assert.deepEqual(ev, ["max"]);
});
test("watchdog: stop() desactiva todo y ping() después no revive nada", async () => {
  const ev = []; const w = watchdog({idleMs: 60, maxMs: 120, onIdle: () => ev.push("idle"), onMax: () => ev.push("max")});
  w.stop(); w.ping(); await sleep(300); assert.deepEqual(ev, []);
});

// ---------- el asistente completo, con el claude falso ----------
const files = new Map([["main.tex", "\\documentclass{article}\n\\begin{document}\nHola\n\\end{document}"]]);
const db = {
  exec() {},
  prepare: sql => ({
    run() {},
    get: () => /from projects/.test(sql) ? {main: "main.tex"} : undefined,
    all: () => /from files/.test(sql) ? [...files.keys()].map(path => ({path, kind: "text", size: 1})) : [],
  }),
};
const lineDiff = (a, b) => { const x = a.split("\n"), y = b.split("\n"); return {add: y.filter(l => !x.includes(l)), del: x.filter(l => !y.includes(l))}; };
const app = express(); app.use(express.json());
registerAgent(app, {db, who: () => "test", okPath: () => true, getDocText: p => files.get(p.split("/").slice(1).join("/")) ?? "", lineDiff});
const server = http.createServer(app); await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); rmSync(tmp, {recursive: true, force: true}); });

const run = async prompt => {
  const r = await fetch(base + "/api/agent/start", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({project: "p1", prompt})});
  const {job, error} = await r.json(); assert.ok(job, "no arrancó: " + error);
  const t0 = Date.now();
  for (;;) {
    const v = await (await fetch(`${base}/api/agent/job/${job}`)).json();
    if (v.state !== "running" && v.state !== "stopping") return {...v, ms: Date.now() - t0};
    if (Date.now() - t0 > 20000) throw new Error("la petición no terminó en 20 s");
    await sleep(100);
  }
};

test("asistente: una petición normal termina bien", async () => {
  const v = await run("di algo");
  assert.equal(v.state, "done"); assert.equal(v.error, ""); assert.equal(v.text, "Respuesta rápida.");
});
test("asistente: si sigue dando señales, vive más que el límite de inactividad y termina", async () => {
  const v = await run("MODO-LENTO");
  assert.equal(v.state, "done", v.error); assert.equal(v.error, "");
  assert.ok(v.ms > 1800, `terminó en ${v.ms} ms: debía durar más que el límite de inactividad (1800 ms)`);
  assert.equal(v.changes.length, 1); assert.equal(v.changes[0].path, "main.tex"); assert.equal(v.changes[0].kind, "mod");
});
test("asistente: si se queda mudo, se corta por inactividad (no por el tope total)", async () => {
  const v = await run("MODO-MUDO");
  assert.equal(v.state, "error"); assert.match(v.error, /dejó de responder/); assert.doesNotMatch(v.error, /en total/);
  assert.ok(v.ms >= 1500 && v.ms < 4500, `se cortó a los ${v.ms} ms, esperaba ~1800`);
});
test("asistente: si habla para siempre, el tope total lo corta", async () => {
  const v = await run("MODO-INFINITO");
  assert.equal(v.state, "error"); assert.match(v.error, /en total/); assert.doesNotMatch(v.error, /dejó de responder/);
  assert.ok(v.ms >= 5000 && v.ms < 9000, `se cortó a los ${v.ms} ms, esperaba ~6000`);
});
test("asistente: tras un corte queda libre para otra petición", async () => {
  const v = await run("di algo otra vez");
  assert.equal(v.state, "done", v.error);
});
