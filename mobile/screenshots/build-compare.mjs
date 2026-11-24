// DEV-ONLY: builds diff PNGs + compare/index.html + compare/results.json
// from demo/<id>.png and emulator/<id>.png.
// Usage: node build-compare.mjs [--threshold 5] [--pixel-threshold 0.1]
//   --threshold        max mismatch % for "pass" (default 5)
//   --pixel-threshold  pixelmatch per-pixel colour tolerance 0..1 (default 0.1)
// Optional accepted.json: { "<id or glob with *>": "reason" }  or  { "<id>": { "reason": "...", "maxMismatch": 12 } }
//   (an array of ids is also accepted). Accepted only upgrades a "fail" to "accepted".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const THRESHOLD = parseFloat(arg('threshold', '5'));
const PIXEL_THRESHOLD = parseFloat(arg('pixel-threshold', '0.1'));

const DEMO = path.join(here, 'demo');
const EMU = path.join(here, 'emulator');
const DIFF = path.join(here, 'diff');
const OUT = path.join(here, 'compare');
for (const d of [DEMO, EMU, DIFF, OUT]) fs.mkdirSync(d, { recursive: true });

// ---- inputs
let screens = [];
const manifestPath = path.join(here, 'screens.json');
if (fs.existsSync(manifestPath)) screens = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const known = new Set(screens.map((s) => s.id));
for (const f of fs.readdirSync(DEMO).filter((f) => f.endsWith('.png'))) {
  const id = f.slice(0, -4);
  if (!known.has(id)) {
    const m = id.match(/^([a-z]+)-(.+)-(olive|purple)$/);
    screens.push({ id, role: m?.[1] ?? '?', screen: m?.[2] ?? id, theme: m?.[3] ?? '?', label: id, deeplinkHint: '' });
  }
}
screens = screens.filter((s) => fs.existsSync(path.join(DEMO, `${s.id}.png`)));

let accepted = {};
const accPath = path.join(here, 'accepted.json');
if (fs.existsSync(accPath)) {
  const raw = JSON.parse(fs.readFileSync(accPath, 'utf8'));
  accepted = Array.isArray(raw) ? Object.fromEntries(raw.map((id) => [id, 'accepted'])) : raw;
}
const globToRe = (g) => new RegExp('^' + g.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
const acceptedRules = Object.entries(accepted).map(([k, v]) => ({
  re: globToRe(k),
  reason: typeof v === 'string' ? v : v.reason || 'accepted',
  max: typeof v === 'object' && v && v.maxMismatch != null ? v.maxMismatch : Infinity,
}));

// ---- image helpers
const readPng = (p) => PNG.sync.read(fs.readFileSync(p));

function resizeBilinear(src, w, h) {
  if (src.width === w && src.height === h) return src;
  const out = new PNG({ width: w, height: h });
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.min(src.height - 1, Math.floor(fy)), y1 = Math.min(src.height - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.min(src.width - 1, Math.floor(fx)), x1 = Math.min(src.width - 1, x0 + 1), wx = fx - x0;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * src.width + x0) * 4 + c], b = src.data[(y0 * src.width + x1) * 4 + c];
        const d = src.data[(y1 * src.width + x0) * 4 + c], e = src.data[(y1 * src.width + x1) * 4 + c];
        out.data[o + c] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy);
      }
    }
  }
  return out;
}

// ---- compute
const results = [];
for (const s of screens) {
  const r = { ...s, demo: `demo/${s.id}.png`, emulator: null, diff: null, mismatchPct: null, status: 'missing', note: '' };
  const emuPath = path.join(EMU, `${s.id}.png`);
  if (fs.existsSync(emuPath)) {
    const demo = readPng(path.join(DEMO, `${s.id}.png`));
    let emu = readPng(emuPath);
    r.demoSize = [demo.width, demo.height];
    r.emulatorSize = [emu.width, emu.height];
    if (emu.width !== demo.width || emu.height !== demo.height) {
      emu = resizeBilinear(emu, demo.width, demo.height);
      r.note = `emulator resized ${r.emulatorSize.join('x')} -> ${r.demoSize.join('x')}`;
    }
    const diff = new PNG({ width: demo.width, height: demo.height });
    const n = pixelmatch(demo.data, emu.data, diff.data, demo.width, demo.height, { threshold: PIXEL_THRESHOLD, includeAA: false });
    fs.writeFileSync(path.join(DIFF, `${s.id}.png`), PNG.sync.write(diff));
    r.emulator = `emulator/${s.id}.png`;
    r.diff = `diff/${s.id}.png`;
    r.mismatchPct = +((n / (demo.width * demo.height)) * 100).toFixed(2);
    if (r.mismatchPct <= THRESHOLD) r.status = 'pass';
    else {
      const rule = acceptedRules.find((a) => a.re.test(s.id) && r.mismatchPct <= a.max);
      if (rule) {
        r.status = 'accepted';
        r.acceptedReason = rule.reason;
      } else r.status = 'fail';
    }
  }
  results.push(r);
}

const summary = {
  generatedAt: new Date().toISOString(),
  threshold: THRESHOLD,
  pixelThreshold: PIXEL_THRESHOLD,
  total: results.length,
  pass: results.filter((r) => r.status === 'pass').length,
  accepted: results.filter((r) => r.status === 'accepted').length,
  fail: results.filter((r) => r.status === 'fail').length,
  missing: results.filter((r) => r.status === 'missing').length,
};
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ summary, results }, null, 2) + '\n');

// ---- html
const esc = (s) => JSON.stringify(s).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo vs Emulator</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--fg:#1c2330;--mut:#667085;--bd:#d9dde5;--pass:#1a8f4c;--fail:#d92d20;--miss:#8a8f98;--acc:#b7791f}
@media(prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1b2029;--fg:#e8ebf0;--mut:#98a2b3;--bd:#2c3340}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--bd);padding:10px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
header h1{font-size:16px;margin:0 8px 0 0}
label{color:var(--mut);font-size:12px}select,button{font:inherit;padding:4px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg)}
.sum span{margin-right:10px;font-weight:600}
main{padding:16px;display:flex;flex-direction:column;gap:16px}
.row{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px}
.row h2{font-size:14px;margin:0 0 2px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hint{color:var(--mut);font-size:12px;margin-bottom:8px}
.badge{font-size:11px;font-weight:700;color:#fff;border-radius:999px;padding:2px 9px;text-transform:uppercase}
.b-pass{background:var(--pass)}.b-fail{background:var(--fail)}.b-missing{background:var(--miss)}.b-accepted{background:var(--acc)}
.pct{font-variant-numeric:tabular-nums;color:var(--mut);font-size:12px}
.grid{display:flex;gap:12px;overflow-x:auto;align-items:flex-start}
figure{margin:0;flex:0 0 auto;width:240px}figcaption{font-size:11px;color:var(--mut);margin-bottom:4px}
figure img{width:100%;display:block;border:1px solid var(--bd);border-radius:6px;background:#888}
.ph{width:240px;aspect-ratio:412/915;border:1px dashed var(--bd);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:12px;text-align:center;padding:8px}
.ov{position:relative;width:240px}.ov img{position:absolute;top:0;left:0;width:100%}
.ov .base{position:relative}
.ctl{margin-top:6px;display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--mut)}
.ctl input[type=range]{width:100%}
.ov.mode-slider .top{clip-path:inset(0 0 0 var(--cut,50%))}
.ov .bar{position:absolute;top:0;bottom:0;width:2px;background:#f0f;left:var(--cut,50%);display:none;z-index:2}
.ov.mode-slider .bar{display:block}
.note{font-size:11px;color:var(--mut);margin-top:6px}
.none{padding:40px;text-align:center;color:var(--mut)}
</style></head><body>
<header>
<h1>Demo vs Emulator</h1>
<label>Role <select id="fRole"></select></label>
<label>Theme <select id="fTheme"></select></label>
<label>Status <select id="fStatus"></select></label>
<label>Overlay <select id="fMode"><option value="slider">slider (wipe)</option><option value="opacity">opacity blend</option></select></label>
<span class="sum" id="sum"></span>
</header>
<main id="main"></main>
<script>
const SUMMARY=${esc(summary)};
const DATA=${esc(results)};
const $=id=>document.getElementById(id);
const uniq=k=>['all',...new Set(DATA.map(d=>d[k]))];
const fill=(el,vals)=>el.innerHTML=vals.map(v=>'<option>'+v+'</option>').join('');
fill($('fRole'),uniq('role'));fill($('fTheme'),uniq('theme'));fill($('fStatus'),['all','fail','missing','accepted','pass']);
$('sum').innerHTML='<span>'+SUMMARY.total+' screens</span><span style="color:var(--pass)">'+SUMMARY.pass+' pass</span><span style="color:var(--acc)">'+SUMMARY.accepted+' accepted</span><span style="color:var(--fail)">'+SUMMARY.fail+' fail</span><span style="color:var(--miss)">'+SUMMARY.missing+' missing</span><span class="pct">threshold '+SUMMARY.threshold+'%</span>';
function img(src,cap){return '<figure><figcaption>'+cap+'</figcaption><img loading="lazy" src="../'+src+'"></figure>'}
function ph(cap,msg){return '<figure><figcaption>'+cap+'</figcaption><div class="ph">'+msg+'</div></figure>'}
function render(){
  const r=$('fRole').value,t=$('fTheme').value,s=$('fStatus').value,mode=$('fMode').value;
  const rows=DATA.filter(d=>(r==='all'||d.role===r)&&(t==='all'||d.theme===t)&&(s==='all'||d.status===s));
  $('main').innerHTML=rows.length?rows.map((d,i)=>{
    const has=!!d.emulator;
    const ov=has?'<figure><figcaption>overlay</figcaption><div class="ov mode-'+mode+'" data-i="'+i+'"><img class="base" src="../'+d.demo+'"><img class="top" src="../'+d.emulator+'"><div class="bar"></div></div>'
      +'<div class="ctl"><input type="range" min="0" max="100" value="50" data-ov="'+i+'"><span>'+(mode==='slider'?'drag: demo left / emulator right':'0 = demo, 100 = emulator')+'</span></div></figure>':ph('overlay','needs emulator shot');
    return '<section class="row"><h2>'+d.id+' <span class="badge b-'+d.status+'">'+d.status+'</span><span class="pct">'+(d.mismatchPct==null?'':d.mismatchPct+'% mismatch')+'</span></h2>'
      +'<div class="hint">'+d.label+(d.deeplinkHint?' &middot; '+d.deeplinkHint:'')+'</div>'
      +'<div class="grid">'+img(d.demo,'demo (spec)')+(has?img(d.emulator,'emulator'):ph('emulator','missing: emulator/'+d.id+'.png'))+(has?img(d.diff,'diff'):ph('diff','n/a'))+ov+'</div>'
      +(d.note||d.acceptedReason?'<div class="note">'+[d.note,d.acceptedReason&&'accepted: '+d.acceptedReason].filter(Boolean).join(' | ')+'</div>':'')+'</section>';
  }).join(''):'<div class="none">No screens match the filters.</div>';
  document.querySelectorAll('input[data-ov]').forEach(inp=>{
    const ovEl=document.querySelector('.ov[data-i="'+inp.dataset.ov+'"]');
    const apply=()=>{const v=inp.value;if(mode==='slider'){ovEl.style.setProperty('--cut',v+'%')}else{ovEl.querySelector('.top').style.opacity=v/100}};
    inp.oninput=apply;apply();
  });
}
['fRole','fTheme','fStatus','fMode'].forEach(id=>$(id).onchange=render);
render();
</script></body></html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(JSON.stringify(summary));
console.log('wrote', path.join(OUT, 'index.html'));
