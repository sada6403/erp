// Generates the launcher icon, adaptive-icon layers and splash image from ONE source logo. The logo is never redrawn or recoloured:
// it is only scaled and centred with a safe-zone padding. To use a new logo, run:  node scripts/make-icons.cjs path/to/new-logo.png
// Optional: PAD=0.18 (share of the canvas left empty on EACH side) and ANDROID_RES=C:/np/android/app/src/main/res (also writes native density files).
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
let sharp;
for (const p of ['sharp', path.join(root, '..', 'backend', 'node_modules', 'sharp')]) {
  try { sharp = require(p); break; } catch { /* try next */ }
}
if (!sharp) throw new Error('sharp not found (run from a folder where it is installed, e.g. backend/node_modules)');

const SRC = path.resolve(process.argv[2] || path.join(root, 'assets', 'logo.jpg'));
const PAD = Number(process.env.PAD || 0.18);
const SIZE = 1024;
const inner = Math.round(SIZE * (1 - PAD * 2));

(async () => {
  // Background colour = the logo's own background, sampled from its four corners.
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => { const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const pts = [at(2, 2), at(info.width - 3, 2), at(2, info.height - 3), at(info.width - 3, info.height - 3)];
  const bg = pts[0].map((_, c) => Math.round(pts.reduce((a, p) => a + p[c], 0) / pts.length));
  const bgHex = '#' + bg.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  console.log('source', path.basename(SRC), info.width + 'x' + info.height, 'background', bgHex, 'padding', PAD);

  const logo = await sharp(SRC).removeAlpha().resize(inner, inner, { fit: 'contain', background: { r: bg[0], g: bg[1], b: bg[2] } }).png().toBuffer();
  const canvas = (extra) => sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: extra } });
  const place = (buf, bgc) => canvas(bgc).composite([{ input: buf, gravity: 'centre' }]).png();
  const out = (n) => path.join(root, 'assets', n);
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const solid = { r: bg[0], g: bg[1], b: bg[2], alpha: 1 };

  await place(logo, solid).toFile(out('icon.png')); // store / legacy icon (opaque)
  await place(logo, clear).toFile(out('android-icon-foreground.png')); // adaptive foreground (transparent canvas)
  await canvas(solid).png().toFile(out('android-icon-background.png')); // adaptive background: logo's own colour
  await place(logo, clear).toFile(out('splash-icon.png')); // splash image, same safe-zone padding
  // Themed (monochrome) icon: dark parts of the logo become the opaque shape.
  const mono = await sharp(logo).greyscale().negate().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(inner * inner * 4);
  for (let i = 0; i < inner * inner; i++) { rgba[i * 4 + 3] = mono.data[i]; }
  const monoLogo = await sharp(rgba, { raw: { width: inner, height: inner, channels: 4 } }).png().toBuffer();
  await place(monoLogo, clear).toFile(out('android-icon-monochrome.png'));
  console.log('wrote assets/icon.png, android-icon-{foreground,background,monochrome}.png, splash-icon.png');

  const res = process.env.ANDROID_RES;
  if (res) {
    const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [d, k] of Object.entries(dens)) {
      const layer = Math.round(108 * k);
      const sp = Math.round(288 * k);
      const mip = path.join(res, 'mipmap-' + d);
      await sharp(out('android-icon-foreground.png')).resize(layer, layer).png().toFile(path.join(mip, 'ic_launcher_foreground.png'));
      await sharp(out('android-icon-background.png')).resize(layer, layer).png().toFile(path.join(mip, 'ic_launcher_background.png'));
      await sharp(out('android-icon-monochrome.png')).resize(layer, layer).png().toFile(path.join(mip, 'ic_launcher_monochrome.png'));
      const legacy = Math.round(48 * k);
      await sharp(out('icon.png')).resize(legacy, legacy).webp().toFile(path.join(mip, 'ic_launcher.webp'));
      await sharp(out('icon.png')).resize(legacy, legacy).composite([{ input: Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`), blend: 'dest-in' }]).webp().toFile(path.join(mip, 'ic_launcher_round.webp'));
      await sharp(out('splash-icon.png')).resize(sp, sp).png().toFile(path.join(res, 'drawable-' + d, 'splashscreen_logo.png'));
    }
    console.log('wrote native density files to', res);
  }
})();
