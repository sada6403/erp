const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expo,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*'],
  },
  {
    // `import axios from 'axios'` / `import i18n from 'i18next'` and calling axios.create / i18n.use is the documented usage.
    rules: { 'import/no-named-as-default-member': 'off' },
  },
]);
