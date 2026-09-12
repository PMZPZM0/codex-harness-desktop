/**
 * electron-builder `beforePack` 钩子 —— 保证随包自动化工具 zip 一定存在。
 *
 * 背景（09-12 用户实测故障）：`resources/tools/*` 全部在 .gitignore 里，`automation-tools.zip`
 * 必须在打包前**现造**；而 electron-builder 对 extraResources 里**缺失的源**只是静默跳过，
 * 于是装出来的应用点「桌面与浏览器自动化」必然报「缺少 ……/tools/automation-tools.zip」。
 * 把生成动作挂到打包钩子上，从根上杜绝这类「漏带」——不依赖人记得先跑哪个脚本。
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
  const toolsRoot = path.join(root, "resources", "tools");
  const zip = path.join(toolsRoot, "automation-tools.zip");
  const modules = path.join(toolsRoot, "npm-global", "node_modules");

  if (!fs.existsSync(modules)) {
    // 本机没装过自动化工具链：不阻断打包，安装时会走 AUTOMATION_TOOLS_URL 在线回落
    console.warn("[before-pack] 未找到 resources/tools/npm-global/node_modules，跳过 automation-tools.zip（安装时走在线下载）");
    return;
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
};
