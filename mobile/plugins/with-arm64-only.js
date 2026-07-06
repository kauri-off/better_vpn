// Config plugin: build native code for arm64-v8a only.
//
// The default gradle.properties template builds all four Android ABIs, which
// roughly quadruples C++ build time and APK size. This app is only deployed
// to the admin's own (arm64) phone; anyone needing another ABI can override
// with `./gradlew <task> -PreactNativeArchitectures=...`.
const { withGradleProperties } = require("expo/config-plugins");

module.exports = function withArm64Only(config) {
  return withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(
      (item) => !(item.type === "property" && item.key === "reactNativeArchitectures"),
    );
    mod.modResults.push({
      type: "property",
      key: "reactNativeArchitectures",
      value: "arm64-v8a",
    });
    return mod;
  });
};
