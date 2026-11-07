// Anota de qué versión del código se construyó la app (build-info.json), para que LJtex sepa si hay una más nueva.
// La acción de GitHub y `npm run dist` lo corren antes de empaquetar.
import {writeFileSync} from "fs";
import {execFileSync} from "child_process";
import {join, dirname} from "path";
import {fileURLToPath} from "url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => { try { return execFileSync("git", a, {cwd: root, encoding: "utf8"}).trim(); } catch { return ""; } };
const sha = process.env.GITHUB_SHA || git("rev-parse", "HEAD");
const time = +git("log", "-1", "--format=%ct", sha || "HEAD") || Math.floor(Date.now() / 1000);   // fecha del cambio, en segundos
const dirty = !process.env.GITHUB_SHA && git("status", "--porcelain", "--untracked-files=no") !== "";
const info = {sha, time, dirty, built: new Date().toISOString(), ci: !!process.env.GITHUB_ACTIONS};
writeFileSync(join(root, "build-info.json"), JSON.stringify(info, null, 1) + "\n");
console.log("build-info.json:", info);
