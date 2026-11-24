#!/usr/bin/env node
/**
 * Play-policy guard: the Play build must NEVER declare REQUEST_INSTALL_PACKAGES (only the staging/test flavour does,
 * for its APK self-update). Fails (exit 1) if any given AndroidManifest.xml declares it, including the merged
 * manifest produced by Gradle (library manifests are merged in there).
 *
 *   node scripts/check-play-manifest.cjs                      # checks android/app/src/main + any merged release manifests
 *   node scripts/check-play-manifest.cjs path/to/AndroidManifest.xml ...
 * Wired as the `eas-build-on-success` npm hook (package.json; runs after Gradle on the merged release manifest, production only) and as `npm run check:play-manifest`.
 * NOT a prebuildCommand: EAS passes prebuildCommand to `expo prebuild` as arguments, so a `&&` chain breaks it ("Invalid project root .../&&").
 */
const fs = require('fs');
const path = require('path');

// Play build must declare none of these (installer self-update is staging only; photos use the system Photo Picker, no storage/media permission).
const FORBIDDEN = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];
const PERMISSION = FORBIDDEN[0];

/** The forbidden permissions the manifest declares (a tools:node="remove" declaration does not count: it deletes it from the merge). */
function declaredForbidden(xml) {
  const tags = xml.match(/<uses-permission(?:-sdk-23)?\b[^>]*>/g) || [];
  return FORBIDDEN.filter((p) => tags.some((t) => t.includes(`"${p}"`) && !/tools:node\s*=\s*["']remove["']/.test(t)));
}
/** Back-compat: true when REQUEST_INSTALL_PACKAGES is declared. */
function declaresInstallPermission(xml) { return declaredForbidden(xml).includes(PERMISSION); }

function findManifests(root) {
  const out = [];
  const main = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(main)) out.push(main);
  const merged = path.join(root, 'android', 'app', 'build', 'intermediates', 'merged_manifests');
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'AndroidManifest.xml' && /release/i.test(p)) out.push(p);
    }
  };
  walk(merged);
  return out;
}

function main(args) {
  // --production-only: used by the EAS `eas-build-on-success` hook, which runs for every profile; the staging flavour legitimately has the permission.
  if (args.includes('--production-only') && process.env.APP_ENV !== 'production') { console.log('check-play-manifest: not a production build, skipped'); return 0; }
  const argv = args.filter((a) => !a.startsWith('--'));
  const files = argv.length ? argv : findManifests(process.cwd());
  if (!files.length) {
    console.error('check-play-manifest: no AndroidManifest.xml found (run expo prebuild first)');
    return 1;
  }
  let bad = 0;
  for (const f of files) {
    const found = declaredForbidden(fs.readFileSync(f, 'utf8'));
    if (found.length) {
      console.error(`FAIL ${f}: declares ${found.join(', ')} (Play build must not)`);
      bad++;
    } else console.log(`ok   ${f}`);
  }
  return bad ? 1 : 0;
}

module.exports = { declaresInstallPermission, declaredForbidden, FORBIDDEN, PERMISSION };
if (require.main === module) process.exit(main(process.argv.slice(2)));
