const fs = require("node:fs/promises");
const path = require("node:path");
const { existsSync } = require("node:fs");

module.exports = async function afterPack(context) {
  const resources = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents/Resources");
  const source = path.join(context.packager.projectDir, "resources/tools");
  // electron-builder's default filters omit nested node_modules in extraResources.
  // Copy the complete, target-native tool closure, preserving Unix executable bits.
  await fs.cp(source, path.join(resources, "tools"), { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });

  // 09-13 v0.0.14 补漏：mac 的 extraResources 是空数组（避免 builder 过滤 node_modules），
  // 只 copy 了 resources/tools —— 于是 expert-skills（知微/呈象的技能包，含 ppt-master）
  // 与 voice-presets（内置音色样本）**根本没进包**，装出来的 mac 版专家技能与音色都是空的。
  // 这两个目录在 Windows 侧由 package.json extraResources 覆盖，mac 侧必须在这里补齐。
  for (const name of ["expert-skills", "voice-presets"]) {
    const from = path.join(context.packager.projectDir, "resources", name);
    if (!existsSync(from)) {
      throw new Error(`[copy-mac-tools] 缺少 resources/${name} —— mac 包会缺功能（专家技能/内置音色），中止打包`);
    }
    await fs.cp(from, path.join(resources, name), { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  }
};
