const fs = require("node:fs/promises");
const path = require("node:path");
const { existsSync } = require("node:fs");

// 09-16 打包瘦身：浏览器内核（Playwright pw-browsers / Cloak cloak-cache，合计 ~1.2GB 原始）
// 不再随包内置，由「开发工具」页按需下载（主进程已接国内镜像 + 失败回落官方源）。
// 开发机 resources/tools 里这两个目录照常保留，只是复制进 .app 时跳过。
const NOT_BUNDLED = new Set(["pw-browsers", "cloak-cache"]);

// 09-16 用户「CloakBrowser 不用内置，按需下载就行」：cloakbrowser 的 npm 包体与 shell shim
// 同样不进包（Windows 侧是 package.json extraResources 的 filter，两处必须同源）。
// 用 basename 匹配，覆盖 bin/cloakbrowser、node_modules/cloakbrowser、node_modules/.bin/cloakbrowser。
function isCloakPackage(entry) {
  return /^cloakbrowser(\.cmd|\.ps1)?$/.test(path.basename(entry));
}

module.exports = async function afterPack(context) {
  const resources = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents/Resources");
  const source = path.join(context.packager.projectDir, "resources/tools");
  // electron-builder's default filters omit nested node_modules in extraResources.
  // Copy the complete, target-native tool closure, preserving Unix executable bits.
  await fs.cp(source, path.join(resources, "tools"), {
    recursive: true, verbatimSymlinks: true, preserveTimestamps: true,
    filter: (entry) => !NOT_BUNDLED.has(path.basename(entry)) && !isCloakPackage(entry),
  });

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
