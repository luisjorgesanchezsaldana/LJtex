// Corrector ortográfico (Hunspell vía nspell) en un hilo aparte para no frenar el editor.
import nspell from "nspell";

let token = "";
const dicts = new Map();      // idioma → Promise<nspell>
const failed = new Set();

function load(lang) {
  if (!dicts.has(lang)) dicts.set(lang, (async () => {
    const get = ext => fetch(`/api/dict/${lang}/index.${ext}`, {headers: {"x-token": token}}).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    const [aff, dic] = await Promise.all([get("aff"), get("dic")]);
    return nspell(aff, dic);
  })().catch(e => { dicts.delete(lang); failed.add(lang); return null; }));
  return dicts.get(lang);
}
const ok = (sp, w) => {
  if (sp.correct(w)) return true;
  if (w.includes("'")) { const parts = w.split("'").filter(p => p.length > 1); return parts.length > 0 && parts.every(p => sp.correct(p)); }   // l'homme, dell'arte
  return false;
};

self.onmessage = async ({data}) => {
  const {id, op} = data;
  if (op === "init") { token = data.token; return; }
  const sps = (await Promise.all((data.langs || []).map(l => load(l).then(sp => sp && [l, sp])))).filter(Boolean);
  const failedNow = (data.langs || []).filter(l => failed.has(l));
  if (op === "check") {
    if (!sps.length) return self.postMessage({id, bad: [], failed: failedNow, none: true});
    self.postMessage({id, bad: data.words.filter(w => !sps.some(([, sp]) => ok(sp, w))), failed: failedNow});
  } else if (op === "suggest") {
    const lists = sps.map(([, sp]) => sp.suggest(data.word).slice(0, 5)), out = [];
    for (let i = 0; i < 5; i++) for (const l of lists) if (l[i] && !out.includes(l[i])) out.push(l[i]);
    self.postMessage({id, suggestions: out.slice(0, 6)});
  }
};
