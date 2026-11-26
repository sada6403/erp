// Declares hardware features as NOT required so Play does not filter devices (e.g. tablets/TV without Wi-Fi hardware, landscape-only devices).
// Play infers android.hardware.wifi (from the Wi-Fi state permission) and android.hardware.screen.portrait (from the portrait-only activity);
// an explicit required="false" entry overrides the inference. tools:node="replace" also wins over any library manifest declaring them required.
const { withAndroidManifest } = require('expo/config-plugins');

const FEATURES = ['android.hardware.wifi', 'android.hardware.screen.portrait'];

module.exports = function withOptionalHardware(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const list = (manifest['uses-feature'] = manifest['uses-feature'] || []).filter((f) => !FEATURES.includes(f.$ && f.$['android:name']));
    for (const name of FEATURES) list.push({ $: { 'android:name': name, 'android:required': 'false', 'tools:node': 'replace' } });
    manifest['uses-feature'] = list;
    return cfg;
  });
};
