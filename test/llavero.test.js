// La clave de GitHub en el Llavero de macOS (con la herramienta «security» simulada en test/fixtures)
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "fs";
import {join, dirname} from "path";
import {tmpdir} from "os";
import {fileURLToPath} from "url";
import {createRequire} from "module";

const here = dirname(fileURLToPath(import.meta.url));
process.env.PATH = join(here, "fixtures") + ":" + process.env.PATH;
process.env.FAKE_KC = join(mkdtempSync(join(tmpdir(), "llavero-")), "db.json");
process.env.LJTEX_KEYCHAIN_TEST = "1";
const kc = createRequire(import.meta.url)("../ghtoken.cjs");

test("guarda, lee y borra la clave", () => {
  assert.equal(kc.available, true);
  assert.equal(kc.get(true), null);
  assert.equal(kc.set("ghp_abcdefghijklmnopqrstuvwxyz0123"), true);
  assert.equal(kc.get(true), "ghp_abcdefghijklmnopqrstuvwxyz0123");
  assert.equal(kc.set("gho_ZYXWVUTSRQPONMLKJIHGFEDCBA9876"), true);   // reemplaza la anterior
  assert.equal(kc.get(true), "gho_ZYXWVUTSRQPONMLKJIHGFEDCBA9876");
  kc.remove();
  assert.equal(kc.get(true), null);
});

test("no acepta algo que no parece una clave (no se mete texto raro en el comando)", () => {
  assert.equal(kc.set('ghp_x" -w "otra'), false);
  assert.equal(kc.set(""), false);
  assert.equal(kc.get(true), null);
});
