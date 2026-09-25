/**
 * electron-builder `beforePack` 钩子 —— 保证随包自动化能力与插件一定在包里。
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
 * 结论：**缺随包能力的安装包 = 坏包**。宁可不打包，也不发坏包。
 * 确实要出一版不带它们的包：设 `AUTOMATION_ZIP_OPTIONAL=1`。
 *
 * 09-16 起（用户「有国内加速的都不用内置，全部放到开发工具」+「这三个内置，CloakBrowser 不用内置」）：
 *   npm-global 随包**预解压**（开箱即用），内部到 CloakBrowser 的排除见 package.json 的 filter 与
 *   pack-automation.cjs（两处必须同源，否则「修复安装」会把 CloakBrowser 装回来）。
 *   因此这里的硬校验从「zip 存在」升级为**直接校验随包内容**：npm-global 里必须有
 *   nuphus-mcp 与 @playwright/cli（zip 只是修复备用，不再是唯一保障）。
 *
 * macOS 不在此处理：mac 走 build/electron-builder.mac.cjs（extraResources: []）
 * + scripts/prepare-mac-tools.cjs + build/copy-mac-tools.cjs，直接铺开 npm-global，不需要 zip。
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/**
 * 从 index.html 的入口出发、跟随产物内部引用做 BFS，得到**真正会被加载**的 assets 文件集合。
 *
 * ⛔⛔ 判据必须是**可达闭包**，绝不能只看 index.html 的直接引用：
 *     vite 把懒加载写成 `import("./ModelSettingsSection-xxx.js")`，**这些 chunk 一个都不在
 *     index.html 里**。只看直接引用 = 把它们全判成"陈旧死重"删掉 ⇒ 打包版点开任意设置页
 *     都报 `Cannot read properties of undefined (reading 'default')`
 *     （**v0.0.27 真实事故**：CI 里 process.env.CI 为真 ⇒ 裁剪默认执行 ⇒ 整个设置面板全废）。
 */
function reachableAssets(assetsDir, entryNames) {
  const live = new Set();
  const queue = [...entryNames];
  const existsIn = (n) => fs.existsSync(path.join(assetsDir, n));
  while (queue.length) {
    const name = path.basename(queue.pop());
    if (live.has(name)) continue;
    live.add(name);
    if (!existsIn(name)) continue;
    const body = fs.readFileSync(path.join(assetsDir, name), "utf8");
    // ① 相对引用（vite 的静态/动态 import 都是 "./xxx.js"）
    for (const m of body.matchAll(/["'`]\.\/([A-Za-z0-9_$.\-]+\.(?:js|css))["'`]/g)) if (existsIn(m[1])) queue.push(m[1]);
    // ② assets/ 前缀形式
    for (const m of body.matchAll(/["'`]assets\/([A-Za-z0-9_$.\-]+\.(?:js|css))["'`]/g)) if (existsIn(m[1])) queue.push(m[1]);
    // ③ 裸文件名（vite 的 preload deps 数组里可能不带 ./）—— 用 existsSync 兜住，避免把文案当文件名
    for (const m of body.matchAll(/["'`]([A-Za-z0-9_$.\-]+\.(?:js|css))["'`]/g)) if (existsIn(m[1])) queue.push(m[1]);
  }
  return live;
}

/**
 * 打包期裁剪 `dist/assets` 里**真的不会再被加载**的陈旧 chunk（09-24 加，09-25 修判据）。
 *
 * 背景：`vite.config.ts` 设了 `emptyOutDir: false`（09-23 崩溃修复 —— `npm run check` 每次都跑
 * build，清空 dist 会让**正在运行的实例**懒加载 404）。代价是 dist 只增不减。
 *
 * ⛔⛔ 09-25 修正：原判据「只保留 index.html 里出现的 assets/xxx」是**错的** —— 懒加载 chunk
 *     全都不在 index.html 里，于是被整批删除，打出来的 0.0.27 安装包点开任意设置页都
 *     `reading 'default' of undefined`。现在必须走 `reachableAssets()` 的可达闭包。
 *     另加**安全阀**：闭包结果小得离谱（判据八成又算歪了）就一律不删 ——
 *     宁可包里多几十 MB 死重，也不能再删掉活文件。
 *
 * ⛔ 为什么默认只在 CI 开：本地 `npm run dist` 时开发机上**可能正跑着一个旧构建的实例**，
 *    它懒加载需要的 chunk 恰好就是"新闭包之外的"那批 —— 删了它会重演 09-23 那类「点开设置白屏」。
 *    本地要显式 `PACK_PRUNE_STALE_DIST=1` 才动手。
 */
function pruneStaleDistAssets(root, dryRun = false) {
  const distDir = path.join(root, "dist");
  const assetsDir = path.join(distDir, "assets");
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath) || !fs.existsSync(assetsDir)) return;
  const html = fs.readFileSync(indexPath, "utf8");

  const entries = new Set();
  for (const m of html.matchAll(/assets\/([A-Za-z0-9._/-]+)/g)) entries.add(path.basename(m[1]));
  const live = reachableAssets(assetsDir, [...entries]);

  const all = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      all.push(p);
    }
  };
  walk(assetsDir);

  /* ⛔ 安全阀：闭包算出的文件数少得离谱 ⇒ 判据可疑，**宁可不删**。 */
  if (live.size < Math.min(30, all.length)) {
    console.warn(`[before-pack] 可达闭包只算出 ${live.size} 个文件（assets 共 ${all.length} 个）—— 判据可疑，跳过裁剪（宁留死重，不可删活文件）`);
    return;
  }

  const stale = [];
  let staleBytes = 0;
  for (const p of all) {
    const name = path.basename(p);
    if (live.has(name)) continue;
    stale.push(p);
    try { staleBytes += fs.statSync(p).size; } catch { /* 忽略 */ }
  }
  const mb = (staleBytes / 1048576).toFixed(1);
  if (!stale.length) {
    console.log(`[before-pack] dist/assets 无陈旧产物（可达 ${live.size} 个，全覆盖）`);
    return;
  }
  const enabled = dryRun || process.env.CI || process.env.PACK_PRUNE_STALE_DIST === "1";
  if (!enabled) {
    console.log(`[before-pack] dist/assets 有 ${stale.length} 个陈旧文件（约 ${mb} MB 会被打进安装包；可达闭包 ${live.size} 个）。`
      + `\n  本地默认不删（可能有旧构建的实例正在运行，删了它会懒加载 404 —— 09-23 那次崩溃同源）。`
      + `\n  确认没有正在运行的实例后可加 PACK_PRUNE_STALE_DIST=1 重新打包。`);
    return;
  }
  let removed = 0;
  for (const p of stale) {
    if (dryRun) { removed += 1; continue; } // 只统计、不落盘（守卫/自检用）
    try { fs.unlinkSync(p); removed += 1; } catch { /* 忽略单个失败 */ }
  }
  console.log(`[before-pack] ${dryRun ? "[dry-run] 将裁剪" : "已裁剪"} ${removed}/${stale.length} 个陈旧 chunk（约 ${mb} MB；保留可达闭包 ${live.size} 个）`);
}

module.exports = async function beforePack() {
  // ⛔ 必须排在所有早退分支（darwin / AUTOMATION_ZIP_OPTIONAL）**之前**：裁剪与平台无关。
  try {
    pruneStaleDistAssets(path.resolve(__dirname, ".."));
  } catch (error) {
    console.warn("[before-pack] dist 陈旧产物裁剪失败（不影响打包）:", error?.message ?? error);
  }
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
      + "  没有它就无法生成 automation-tools.zip，装出来的应用「Nuphus 桌面自动化 / Playwright 浏览器自动化」全部是空的。\n"
      + "  先在本机装一次自动化工具链（应用内「开发工具」页，或把 automation-tools.zip 解压到 resources/tools/）再打包；\n"
      + "  确实要出一版不带它的包：设 AUTOMATION_ZIP_OPTIONAL=1。";
    if (optional) {
      console.warn(`${message}\n  （AUTOMATION_ZIP_OPTIONAL=1：已按你的要求放行）`);
      return;
    }
    throw new Error(message);
  }

  // 直接校验随包内容（09-16）：这两项是**内置**能力，缺任何一个都等于发坏包。
  // 注意这里查的是 npm-global 本体而不是 zip —— zip 只是「修复安装」的来源，不是唯一保障。
  // CloakBrowser 不在此列：它按需下载（npm 源），包里没有是**预期状态**。
  const requiredShipped = [
    { marker: ["@nuphus", "nuphus-mcp", "package.json"], label: "Nuphus 桌面自动化（nuphus-mcp）" },
    { marker: ["@playwright", "cli", "package.json"], label: "Playwright 浏览器自动化（@playwright/cli）" },
  ];
  const missingShipped = requiredShipped.filter(({ marker }) => !fs.existsSync(path.join(modules, ...marker)));
  if (missingShipped.length) {
    const message = `[before-pack] 随包 npm-global 缺少：${missingShipped.map((item) => item.label).join("、")}\n`
      + `  （查的是 ${missingShipped.map((item) => path.join(modules, ...item.marker)).join(" / ")}）\n`
      + "  缺了它，装出来的应用「开发工具」里对应卡片是空的，能力全无。\n"
      + "  补法：应用内「开发工具」页点该卡片的「修复安装」，或在开发机执行 node scripts/install-automation.cjs，再打包；\n"
      + "  确实要出一版不带自动化能力的包：设 AUTOMATION_ZIP_OPTIONAL=1。";
    if (optional) {
      console.warn(`${message}\n  （AUTOMATION_ZIP_OPTIONAL=1：已按你的要求放行）`);
      // 与上面的「缺 npm-global」同一语义：显式声明要出不带自动化能力的包 —— 直接放行，
      // 不再往下走 zip 生成（否则会拿它当 tools 根去生成/校验 zip，得到无关的失败）。
      return;
    }
    throw new Error(message);
  } else {
    console.log(`[before-pack] 随包自动化能力 OK（${requiredShipped.map((item) => item.label).join(" + ")}）`);
  }

  // zip 新鲜度 = zip 比「源目录」和「打包脚本」都新。⛔ 必须带上打包脚本自身：
  // pack-automation.cjs 里也有排除清单（09-16 起排除 cloakbrowser），只比 npm-global 目录的 mtime
  // 会在「只改了排除清单、没动 npm-global」时静默复用旧 zip —— 用户点一次「修复安装」就把
  // 已剥离的包又装回包里，而且日志还说「已是最新，跳过」，极难察觉。
  const packScript = path.join(root, "scripts", "pack-automation.cjs");
  const newestSource = Math.max(fs.statSync(modules).mtimeMs, fs.statSync(packScript).mtimeMs);
  const needBuild = !fs.existsSync(zip) || fs.statSync(zip).mtimeMs < newestSource;
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

/* 供预检守卫调用：真跑一次「可达闭包」判定，断言它**不会把懒加载 chunk 判成死重**
   （0.0.27 事故的回归防线）。dryRun 只统计不落盘。 */
module.exports.pruneStaleDistAssets = pruneStaleDistAssets;
module.exports.reachableAssets = reachableAssets;
