/**
 * electron-builder `beforePack` 钩子 —— 保证随包自动化工具 zip 一定存在。
 *
 * 背景（09-12 用户实测两次故障）：
 *   ① `resources/tools/*` 全部在 .gitignore 里，`automation-tools.zip` 必须在打包前**现造**；
 *      而 electron-builder 对 extraResources 里**缺失的源**只是静默跳过。
 *   ② 更早的一版是「找不到就 warn 后放过」，于是打出来的 Windows 包**没有** tools/automation-tools.zip，
 *      应用里点「桌面与浏览器自动化」→ 回落在线下载 → 而 GitHub Release 上**根本没有**
 *      automation-tools.zip 资产（实测 v0.0.13 只有两个 mac zip）→ 404。
 *      用户看到的就是「桌面自动化 / 浏览器自动化 / 浏览器内核三个都下载失败」
 *      （后两个依赖这个包里的 playwright-cli / cloakbrowser，所以一起废）。
 *
 * 结论：**包里没有 zip 的安装包 = 坏包**。所以这里改成硬失败——宁可不打包，也不发坏包。
 * 确实要出一版不带它的包：设 `AUTOMATION_ZIP_OPTIONAL=1`。
 *
 * macOS 不在此处理：mac 走 build/electron-builder.mac.cjs（extraResources: []）
 * + scripts/prepare-mac-tools.cjs + build/copy-mac-tools.cjs，直接铺开 npm-global，不需要 zip。
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

module.exports = async function beforePack() {
  if (process.platform === "darwin") return;

  const root = path.resolve(__dirname, "..");
  // AUTOMATION_TOOLS_ROOT 只给自动化验收用：preflight【8】会拿一个空目录跑本钩子，
  // 断言它**真的会硬失败**（同时断言逃生阀能放行）。
  const toolsRoot = process.env.AUTOMATION_TOOLS_ROOT || path.join(root, "resources", "tools");
  const zip = path.join(toolsRoot, "automation-tools.zip");
  const modules = path.join(toolsRoot, "npm-global", "node_modules");
  const optional = process.env.AUTOMATION_ZIP_OPTIONAL === "1";

  if (!fs.existsSync(modules)) {
    const message = `[before-pack] 缺少 ${modules}\n`
      + "  没有它就无法生成 automation-tools.zip，装出来的应用「桌面与浏览器自动化 / 浏览器内核」全部装不上。\n"
      + "  先在本机装一次自动化工具链（应用内「开发工具」页，或把 automation-tools.zip 解压到 resources/tools/）再打包；\n"
      + "  确实要出一版不带它的包：设 AUTOMATION_ZIP_OPTIONAL=1。";
    if (optional) {
      console.warn(`${message}\n  （AUTOMATION_ZIP_OPTIONAL=1：已按你的要求放行）`);
      return;
    }
    throw new Error(message);
  }

  const needBuild = !fs.existsSync(zip) || fs.statSync(zip).mtimeMs < fs.statSync(modules).mtimeMs;
  if (!needBuild) {
    console.log("[before-pack] automation-tools.zip 已是最新，跳过");
    return;
  }

  console.log("[before-pack] 生成 automation-tools.zip（npm-global → zip）…");
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "pack-automation.cjs")], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  if (result.status !== 0 || !fs.existsSync(zip)) {
    throw new Error("automation-tools.zip 生成失败：桌面/浏览器自动化会被打成「装了也不能用」，中止打包");
  }
  console.log(`[before-pack] OK ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);

  // ② ponytail 写代码模式插件（随包 2MB，会话钩子 + 6 个技能）。
  //    09-13 发 v0.0.14 前逐项核对 extraResources 源时发现：这个目录在开发机根本不存在，
  //    而 electron-builder 对缺失源静默跳过 → 装出来的应用「写代码模式插件」= 空（插件 0、钩子空）。
  //    mac 侧由 prepare-mac-tools.cjs 从 GitHub 拉取，Windows 侧必须在本机先备好。
  //    同样的硬失败原则：宁可不打包，也不发缺功能的坏包（逃生阀同一个 AUTOMATION_ZIP_OPTIONAL=1）。
  const pluginDir = path.join(toolsRoot, "ponytail-plugin");
  const pluginYaml = path.join(pluginDir, "plugin.yaml");
  const pluginOk = fs.existsSync(pluginYaml) && fs.existsSync(path.join(pluginDir, "skills"));
  if (!pluginOk) {
    const message = `[before-pack] 缺少 ${pluginDir}（或里面没有 plugin.yaml / skills）\n`
      + "  没有它，装出来的应用「ponytail 写代码模式插件」是空的（插件 0、钩子空、6 个技能全无）。\n"
      + "  补法（v4.9.0）：\n"
      + "    curl -L -o ponytail.tar.gz https://github.com/DietrichGebert/ponytail/archive/refs/tags/v4.9.0.tar.gz\n"
      + "    tar -xzf ponytail.tar.gz -C resources/tools/ponytail-plugin --strip-components=1\n"
      + "  确实要出一版不带它的包：设 AUTOMATION_ZIP_OPTIONAL=1。";
    if (optional) {
      console.warn(`${message}\n  （AUTOMATION_ZIP_OPTIONAL=1：已按你的要求放行）`);
      return;
    }
    throw new Error(message);
  }
  console.log(`[before-pack] ponytail-plugin OK（${/^version:\s*(\S+)/m.exec(fs.readFileSync(pluginYaml, "utf8"))?.[1] ?? "?"}）`);
};
