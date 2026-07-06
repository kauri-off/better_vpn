// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // src/gen is buf-generated; its boilerplate trips unused-directive warnings.
    ignores: ["dist/*", "src/gen/*"],
  }
]);
