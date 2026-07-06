// Config plugin: allow plain-HTTP connections to panel servers.
//
// Android blocks cleartext traffic by default since API 28, and the legacy
// app.json `android.usesCleartextTraffic` key is silently ignored by SDK 57's
// prebuild (its handling moved to the expo-build-properties package), so the
// manifest attribute has to be injected here.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) {
      throw new Error("with-cleartext-traffic: <application> not found in AndroidManifest.xml");
    }
    app.$["android:usesCleartextTraffic"] = "true";
    return mod;
  });
};
