const path = require("node:path");
const base = require("../package.json").build;

module.exports = {
  ...base,
  directories: { output: "release-mac" },
  extraResources: [],
  afterPack: path.resolve(__dirname, "copy-mac-tools.cjs"),
  mac: {
    target: "zip",
    category: "public.app-category.developer-tools",
    artifactName: "${productName}-${version}-${arch}-mac.${ext}",
    extendInfo: {
      NSAppleEventsUsageDescription: "Use desktop automation to control applications when you request it.",
      NSScreenCaptureUsageDescription: "Capture the screen for desktop automation when you request it.",
    },
  },
};
