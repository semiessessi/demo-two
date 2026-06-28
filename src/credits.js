// Single source of truth for asset attribution. Rendered into the #info panel now (see main.js); a
// dedicated About screen can read the same data later. Keep every third-party asset listed here.

export const CREDITS = [
  {
    kind: 'Models',
    items: [
      {
        name: 'SA-43: Hammerhead',
        author: 'Hangar.b.productions',
        license: 'CC-BY-4.0',
        url: 'https://sketchfab.com/3d-models/sa-43-hammerhead-2c4579fd8add4d1aa1f8f4d93a7c4996',
      },
      {
        // CC-BY-NC-SA — NonCommercial + ShareAlike. Credited here; see the licensing note in the plan if
        // this site ever goes commercial.
        name: 'Chig Fighter — Space: Above and Beyond',
        author: 'FreeBug (orig. Steve G / 3DWarehouse)',
        license: 'CC-BY-NC-SA',
        url: 'https://cults3d.com/en/3d-model/game/chig-fighter-space-above-and-beyond',
      },
    ],
  },
  {
    kind: 'Audio',
    items: [
      { name: 'Explosion / weapon / engine SFX', author: 'synthesized for this project', license: 'CC0', url: '' },
      { name: 'Music — Space: Above and Beyond suite', author: '© its original rights holders', license: 'fan use · non-commercial', url: '' },
    ],
  },
  {
    kind: 'Libraries',
    items: [
      { name: 'three.js', author: 'mrdoob & contributors', license: 'MIT', url: 'https://threejs.org' },
      { name: 'lil-gui', author: 'George Michael Brower', license: 'MIT', url: 'https://lil-gui.georgealways.com' },
      { name: 'Draco', author: 'Google', license: 'Apache-2.0', url: 'https://github.com/google/draco' },
    ],
  },
  {
    kind: 'Data',
    items: [
      { name: 'Bright Star Catalogue (starfield)', author: 'Yale University Obs.', license: 'Public domain', url: '' },
    ],
  },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Compact grouped attribution list as an HTML string (reuses the #info .credit link styling).
export function creditsHtml() {
  const line = (it) => {
    const name = it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.name)}</a>` : esc(it.name);
    const by = it.author && it.author !== '—' ? ` — ${esc(it.author)}` : '';
    const lic = it.license ? ` <span class="lic">${esc(it.license)}</span>` : '';
    return `<div class="crow">${name}${by}${lic}</div>`;
  };
  const groups = CREDITS.map(
    (g) => `<div class="cgroup"><div class="chead">${esc(g.kind)}</div>${g.items.map(line).join('')}</div>`,
  ).join('');
  const footer = `<div class="cgroup" style="margin-top:12px;border-top:1px solid rgba(150,180,255,0.12);padding-top:10px;">`
    + `<div class="crow" style="opacity:0.78;">Non-commercial fan tribute to <em>Space: Above and Beyond</em> — not affiliated with, endorsed by, or licensed by its rights holders. Music &amp; trademarks &copy; their owners, used under fan terms.</div>`
    + `<div class="crow"><a href="/privacy-policy/" target="_blank" rel="noopener">Privacy Policy</a> &middot; <a href="/terms-of-service/" target="_blank" rel="noopener">Terms of Service</a></div></div>`;
  return `<h2>Credits</h2>${groups}${footer}`;
}
