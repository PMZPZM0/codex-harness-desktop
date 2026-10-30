const fs = require("node:fs/promises");
const path = require("node:path");
const { existsSync } = require("node:fs");

// 09-16 打包瘦身：Playwright 内核（pw-browsers，~700MB）不随包内置，
// 由「开发工具」页按需下载（主进程已接国内镜像 + 失败回落官方源）。
// 开发机 resources/tools 里这个目录照常保留，只是复制进 .app 时跳过。
// 浏览器自动化主通道 Ego Lite 是外部安装的应用，也不在随包目录里。
const NOT_BUNDLED = new Set(["pw-browsers"]);

module.exports = async function afterPack(context) {
  const resources = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents/Resources");
  const source = path.join(context.packager.projectDir, "resources/tools");
  // electron-builder's default filters omit nested node_modules in extraResources.
  // Copy the complete, target-native tool closure, preserving Unix executable bits.
  await fs.cp(source, path.join(resources, "tools"), {
    recursive: true, verbatimSymlinks: true, preserveTimestamps: true,
    filter: (entry) => !NOT_BUNDLED.has(path.basename(entry)),
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

  // ⛔ mac 适配（09-16）：Windows 包靠 package.json extraResources 把安装脚本带进 tools/，
  // mac 的 extraResources 是空数组 → 打出来的包 tools/ 里**没有 install-runtimes.cjs /
  // install-automation.cjs**，应用内点任何「安装」= spawn 不存在的脚本 = 瞬间失败
  // （「开发工具全部安装失败」的另一半根因）。Windows 侧从 scripts/ 复制，这里同源补齐。
  for (const name of ["install-runtimes.cjs", "install-automation.cjs"]) {
    const from = path.join(context.packager.projectDir, "scripts", name);
    if (!existsSync(from)) {
      throw new Error(`[copy-mac-tools] 缺少 scripts/${name} —— mac 包「开发工具」页的安装动作会全部失败，中止打包`);
    }
    await fs.cp(from, path.join(resources, "tools", name), { preserveTimestamps: true });
  }

  /* ⛔⛔ 10-30 审计（「装完能不能跑」第二轮）：mac 的 extraResources 是空数组，于是
     package.json 里那些**文件级** extraResources（`src/lib/video-providers.mjs` →
     `tools/video-providers.mjs` 等）在 mac 上**从来没人复制**。
     症状极隐蔽：Windows 正常，mac 上「视频生成」的 CLI 通道找不到厂商适配代码
     （`harness-video.mjs` 的兜底 `__dirname/../../src/lib` 在 .app 里根本不存在）。
     ⇒ 这里按 package.json 的文件级映射逐条补齐，保证两端 resources 布局一致。
     目录级映射不在这里做：`resources/tools` 的整树复制已覆盖（第 16 行）。 */
  const baseExtraResources = require("../package.json").build.extraResources || [];
  for (const entry of baseExtraResources) {
    const from = path.join(context.packager.projectDir, entry.from);
    const to = path.join(resources, entry.to);
    let stat = null;
    try { stat = await fs.stat(from); } catch { /* 源不在这台机上（如 Windows 专属资产） */ }
    if (!stat || !stat.isFile()) continue;
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.cp(from, to, { preserveTimestamps: true });
  }
};
