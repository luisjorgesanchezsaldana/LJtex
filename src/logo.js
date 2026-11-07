// Logotipo de LJtex: una versión caricaturizada de la perrita (dibujo original, en vectores).
let n = 0;
export function logoSvg(size = 40, label = "LJtex") {
  const id = "pd" + (++n), line = "#43302a", fur = "#fffaf0", shade = "#efe0c8", tan = "#dba96a", tanLight = "#ecc890";
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 128 128" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <g id="${id}h">
      <circle cx="36" cy="44" r="14"/><circle cx="50" cy="32" r="15"/><circle cx="68" cy="29" r="15"/><circle cx="84" cy="35" r="14"/><circle cx="93" cy="47" r="12"/>
      <ellipse cx="64" cy="70" rx="35" ry="33"/>
      <path d="M52 22q-4-12 4-14q-1 8 4 13zM68 20q2-12 11-10q-6 4-5 11zM38 32q-9-6-6-14q3 7 10 9z"/>
    </g>
    <path id="${id}el" d="M34 42C20 38 7 52 8 76c1 17 8 28 18 27c10-1 15-14 14-29c-1-14-1-26-6-32z"/>
    <path id="${id}er" d="M94 42C108 38 121 52 120 76c-1 17-8 28-18 27c-10-1-15-14-14-29c1-14 1-26 6-32z"/>
  </defs>
  <!-- orejas caídas -->
  <use href="#${id}el" fill="${line}" stroke="${line}" stroke-width="7" stroke-linejoin="round"/><use href="#${id}er" fill="${line}" stroke="${line}" stroke-width="7" stroke-linejoin="round"/>
  <use href="#${id}el" fill="${tan}"/><use href="#${id}er" fill="${tan}"/>
  <path d="M25 52c-7 8-8 22-5 33M103 52c7 8 8 22 5 33" fill="none" stroke="${tanLight}" stroke-width="6" stroke-linecap="round"/>
  <!-- cabeza esponjosa -->
  <use href="#${id}h" fill="${line}" stroke="${line}" stroke-width="7" stroke-linejoin="round"/>
  <use href="#${id}h" fill="${fur}"/>
  <path d="M33 86q8 22 31 24q23-2 31-24q-6 14-31 16q-25-2-31-16z" fill="${shade}"/>
  <ellipse cx="38" cy="70" rx="9" ry="12" fill="${tanLight}" opacity=".55"/><ellipse cx="90" cy="70" rx="9" ry="12" fill="${tanLight}" opacity=".55"/>
  <g fill="none" stroke="${shade}" stroke-width="3" stroke-linecap="round">
    <path d="M45 30q4-4 8-1M63 22q4-4 8-1M80 28q4-4 8-1M40 46q4-4 8-1M86 44q4-4 8-1"/>
  </g>
  <!-- ojos -->
  <path d="M38 56q8-7 17-2M90 56q-8-7-17-2" fill="none" stroke="${line}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="47" cy="69" r="8.5" fill="#5b3724" stroke="${line}" stroke-width="2.5"/><circle cx="81" cy="69" r="8.5" fill="#5b3724" stroke="${line}" stroke-width="2.5"/>
  <circle cx="47" cy="69" r="4.6" fill="#24150f"/><circle cx="81" cy="69" r="4.6" fill="#24150f"/>
  <circle cx="50" cy="65.5" r="2.8" fill="#fff"/><circle cx="84" cy="65.5" r="2.8" fill="#fff"/><circle cx="44.5" cy="72.5" r="1.3" fill="#fff"/><circle cx="78.5" cy="72.5" r="1.3" fill="#fff"/>
  <!-- hocico -->
  <ellipse cx="64" cy="89" rx="19" ry="15" fill="#fffdf8" stroke="${line}" stroke-width="3"/>
  <path d="M53 78q11-6 22 0q1 8-11 10q-12-2-11-10z" fill="${line}"/><ellipse cx="60" cy="79.5" rx="3.4" ry="1.6" fill="#fff" opacity=".8"/>
  <!-- boca abierta y lengua -->
  <path d="M64 87v3M50 91q14 5 28 0q-1 15-14 16q-13-1-14-16z" fill="#8c3a47" stroke="${line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M56 101q8-7 16 0q-3 6-8 6q-5 0-8-6z" fill="#ff8fa3"/><path d="M64 98v6" stroke="#e86f88" stroke-width="2" stroke-linecap="round"/>
</svg>`;
}
export const wordmark = `<span class="wm">LJ<i>tex</i></span>`;
