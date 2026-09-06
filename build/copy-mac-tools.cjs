const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const source = path.join(context.packager.projectDir, "resources/tools");
  const destination = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents/Resources/tools");
  // electron-builder's default filters omit nested node_modules in extraResources.
  // Copy the complete, target-native tool closure, preserving Unix executable bits.
  await fs.cp(source, destination, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
};
