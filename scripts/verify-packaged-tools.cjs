const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");

const root = path.resolve(process.argv[2] || "resources/tools");
const modules = path.join(root, "npm-global", "node_modules");
// ⛔ 09-16 实测踩坑：electron-builder 的 copyDir 会**无条件丢弃 extraResources `from` 根级的
//    node_modules**（app-builder-lib/out/util/filter.js 里写死的 `if (relative === "node_modules") return false`，
//    且 walk() 在目录节点被过滤时整棵剪掉）。所以「npm-global 预解压」这条映射**从来只拷到了根级 shim**，
//    node_modules 是空的 —— 装出来的应用 nuphus 卡显示「未安装」，要用户点一次
//    「修复安装」解 zip 才可用，与「随包内置、开箱即用」的承诺不符。
//    修法：package.json 里另加一条 from=resources/tools/npm-global/node_modules 的映射（那层不叫 node_modules，绕过剪枝）。
//    下面两条断言把这件事钉死在产物层：谁把那条映射删了/写歪了，这里立刻红。
for (const marker of ["@nuphus/nuphus-mcp/package.json", "agent-desktop/package.json"]) {
  assert.ok(fs.existsSync(path.join(modules, marker)),
    `随包缺少 ${marker} —— npm-global/node_modules 没打进包。检查 package.json extraResources 里那条 ` +
    "from=resources/tools/npm-global/node_modules 的映射（electron-builder 会丢弃 from 根级的 node_modules）。");
}
/* agent-desktop（11-13，默认桌面后端）：CLI 启动器 + **本平台**主程序必须在；
   mac 还必须在 helper 且三个文件都有执行位 —— 这些只有产物层才看得出来。 */
const adBinDir = path.join(modules, "agent-desktop", "bin");
const adKey = process.platform === "win32" ? "win32" : process.platform;
const adSuffix = process.platform === "win32" ? ".exe" : "";
const adBinaryName = `agent-desktop-${adKey}-${process.arch}${adSuffix}`;
assert.ok(fs.existsSync(path.join(adBinDir, "agent-desktop")) && fs.existsSync(path.join(adBinDir, adBinaryName)),
  `随包缺少 agent-desktop 的 CLI 启动器或 ${adBinaryName} —— 检查 prepare-{windows,mac}-tools.cjs 的 agent-desktop 步骤。`);
if (process.platform === "darwin") {
  const helperName = `agent-desktop-macos-helper-darwin-${process.arch}`;
  const helper = path.join(adBinDir, helperName);
  assert.ok(fs.existsSync(helper), `mac 包缺少 ${helperName} —— agent-desktop 的 darwin launcher 硬依赖它（缺了直接退出）。`);
  assert.ok((fs.statSync(helper).mode & 0o111) !== 0, `${helperName} 没有执行位 —— .app 里 spawn 会 EACCES。`);
  assert.ok((fs.statSync(path.join(adBinDir, adBinaryName)).mode & 0o111) !== 0,
    `${adBinaryName} 没有执行位 —— MCP 起得来但每次调用都会失败。`);
}
/* 别的平台/别的架构的二进制不许躺在包里（prepare 侧已裁；这条防裁剪步骤被删掉）。 */
const adForeign = fs.readdirSync(adBinDir).filter((name) => {
  if (process.platform === "darwin") {
    if (name.startsWith("agent-desktop-win32-") || name.startsWith("agent-desktop-linux-")) return true;
    if (name.startsWith("agent-desktop-macos-helper-darwin-")) return !name.startsWith(`agent-desktop-macos-helper-darwin-${process.arch}`);
    if (name.startsWith("agent-desktop-darwin-")) return !name.startsWith(`agent-desktop-darwin-${process.arch}`);
    return false;
  }
  if (process.platform === "win32") return name.startsWith("agent-desktop-darwin-") || name.startsWith("agent-desktop-linux-");
  return false;
});
assert.deepEqual(adForeign, [],
  `包里残留别的平台/架构的 agent-desktop 二进制：${adForeign.join("、")} —— prepare 侧应裁掉（省体积、免杀软误报）。`);
const platform = process.platform === "darwin" ? "osx" : process.platform;
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeName = `nuphus-mcp-${platform}-${process.arch}`;
const native = [
  path.join(modules, "@nuphus", "nuphus-mcp", "node_modules", "@nuphus", nativeName, "bin", `nuphus-mcp${suffix}`),
  path.join(modules, "@nuphus", nativeName, "bin", `nuphus-mcp${suffix}`),
  path.join(root, "nuphus", `nuphus-mcp${suffix}`),
].find(fs.existsSync);
const node = path.join(root, "node", ...(process.platform === "win32" ? ["node.exe"] : ["bin", "node"]));
// ⛔ 09-17：mac 侧必须带上 cloudflared（无后缀单文件，prepare-mac-tools 现造）——
//    缺了它「手机扫码配对」的公网隧道静默不启动（remote.ts 找不到可执行文件就降级到局域网），
//    而这是产物层才看得出来的事（源码/预检都在 Windows 上跑，看不到 mac 包）。
if (process.platform === "darwin") {
  const cloudflared = path.join(root, "cloudflared", "cloudflared");
  assert.ok(fs.existsSync(cloudflared),
    "mac 包缺少 tools/cloudflared/cloudflared —— 检查 prepare-mac-tools.cjs 的 cloudflared 步骤" +
    "（remote.ts 的手机配对隧道依赖它）。");
  assert.ok((fs.statSync(cloudflared).mode & 0o111) !== 0,
    "tools/cloudflared/cloudflared 没有执行位 —— .app 里 spawn 会 EACCES。");
  // ── mac 的桌面自动化后端 open-computer-use（10-04）───────────────────────────
  // 这三条都是**只有产物层才看得出来**的事：源码在 Windows 上跑，装出来的 mac 包缺哪个文件、
  // 有没有执行位、有没有把别的平台的二进制一起带上，本地预检一律看不见。
  const ocuRoot = path.join(modules, "open-computer-use");
  const ocuLauncher = path.join(ocuRoot, "bin", "open-computer-use");
  const ocuBinary = path.join(ocuRoot, "dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse");
  assert.ok(fs.existsSync(ocuLauncher) && fs.existsSync(ocuBinary),
    "mac 包缺少 open-computer-use（桌面自动化后端）—— 检查 prepare-mac-tools.cjs 的 npm 安装与执行位补齐步骤。");
  assert.ok((fs.statSync(ocuBinary).mode & 0o111) !== 0,
    "open-computer-use 的 mac 主程序没有执行位 —— MCP 起得来但每次调用都会失败。");
  for (const foreign of ["windows", "linux"]) {
    assert.ok(!fs.existsSync(path.join(ocuRoot, "dist", foreign)),
      `mac 包里残留 open-computer-use/dist/${foreign}（别的平台的二进制）—— prepare-mac-tools 应裁掉它，` +
      "既省体积也免得杀软/审计问这是什么。");
  }
  /* RPA 键鼠录制 helper（11-13）：mac 必须随包并带执行位。 */
  const rpaMac = [path.join(root, "rpa", "rpa-input-mac"), path.join(root, "..", "rpa", "rpa-input-mac")].find(fs.existsSync);
  assert.ok(rpaMac, "mac 包缺少 tools/rpa/rpa-input-mac —— 检查 prepare-mac-tools.cjs 的 swiftc 编译步骤。");
  assert.ok((fs.statSync(rpaMac).mode & 0o111) !== 0, "tools/rpa/rpa-input-mac 没有执行位 —— 录制/回放会 EACCES。");
}
if (process.platform === "win32") {
  /* 键鼠录制/回放（11-13）：两个 PowerShell 脚本必须随包；缺了录制按钮就是死键。
     ⛔ 打包前这里传的是 resources/tools，脚本源在兄弟目录 resources/rpa；打包后是 tools/rpa。 */
  const rpaDir = [path.join(root, "rpa"), path.join(root, "..", "rpa")]
    .find((dir) => ["record.ps1", "play.ps1"].every((name) => fs.existsSync(path.join(dir, name))));
  assert.ok(rpaDir,
    "缺少 RPA 录制脚本（找过 tools/rpa 与 resources/rpa）—— 检查 package.json extraResources 里 resources/rpa → tools/rpa 的映射。");
  /* 11-03 用户令：Windows 也随包带 computer-use（辅助后端）。 */
  const ocuRoot = path.join(modules, "open-computer-use");
  const ocuLauncher = path.join(ocuRoot, "bin", "open-computer-use");
  const ocuExe = path.join(ocuRoot, "dist", "windows", "amd64", "open-computer-use.exe");
  assert.ok(fs.existsSync(ocuLauncher) && fs.existsSync(ocuExe),
    "Windows 包缺少 open-computer-use —— 检查 prepare-windows-tools.cjs 的 npm 安装步骤。");
  for (const foreign of ["Open Computer Use.app", "linux"]) {
    assert.ok(!fs.existsSync(path.join(ocuRoot, "dist", foreign)),
      `Windows 包里残留 open-computer-use/dist/${foreign}（别的平台的二进制）—— prepare-windows-tools 应裁掉它。`);
  }
}
const env = {
  ...process.env,
  PATH: [path.dirname(node), path.join(root, "npm-global"), path.join(root, "npm-global", "bin"), process.env.PATH].join(path.delimiter),
  NO_UPDATE_NOTIFIER: "1",
  NUPHUS_MCP_HUD: "off",
};

async function mcp() {
  assert.ok(native, "Missing native desktop MCP binary");
  return new Promise((resolve, reject) => {
    const child = spawn(native, [], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let complete = false;
    const timer = setTimeout(() => finish(new Error(`MCP handshake timed out: ${stderr}`)), 25000);
    function finish(error, result) {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(result);
    }
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-3000); });
    child.stdin.on("error", (error) => finish(error));
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => { if (!complete) finish(new Error(`MCP exited ${code}: ${stderr}`)); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.error) return finish(new Error(JSON.stringify(message.error)));
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        }
        if (message.id === 2) {
          const tools = message.result?.tools || [];
          if (!tools.some((tool) => tool.name.startsWith("desktop_"))) return finish(new Error("No desktop tools"));
          finish(null, tools.map((tool) => tool.name));
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "packaged-smoke", version: "1.0" },
    } });
  });
}

async function main() {
  assert.ok(fs.existsSync(node), "Missing bundled Node");
  console.log("Node:", spawnSync(node, ["--version"], { encoding: "utf8", windowsHide: true }).stdout.trim());
  // ⛔⛔ 10-07 实测事故（用户报「开发工具 / 知识库全部安装失败」）：上面那条只验了 `node.exe` 在不在，
  //    **从来没验过 npm**。而 Windows 包里 `tools/node/node_modules`（npm 本体 + 它自带的
  //    npm/node_modules）被 builder 剪掉了（它只剪 extraResources `from` 根级的 node_modules，
  //    见 app-builder-lib/out/util/filter.js）⇒ 装出来的应用里 `runtime-ipc.ts` / `kb-embed-backend.ts`
  //    一律抛「内置 Node 缺少 npm（…/npm/bin/npm-cli.js）」，所有需要 npm 的安装全挂。
  //    ⚠️ dev 态从仓库读 resources/tools（npm 在）⇒ 本地永远不复现；0.0.32 就是这么流出去的。
  //    ⇒ 产物层必须验到 **npm-cli.js 真能跑起来**，不是只看文件存在（存在但缺依赖同样跑不动）。
  //    配套：package.json 里那条 from=resources/tools/node/node_modules 的映射（守卫【27】钉着）。
  // ⛔⛔ 10-07 二次事故（**本断言自己把 mac job 打红**，v0.0.33 首轮 CI）：本文件验的是**两个平台**
  //    （build-win 与 build-mac 都调它，见 .github/workflows/{build-win,build-mac}.yml），而两个平台的
  //    随包 Node 是**两种解包布局**：
  //      · Windows：`prepare-windows-tools.cjs` 解官方 **zip** ⇒ npm 在 `node/node_modules/npm/`
  //      · macOS  ：`prepare-mac-tools.cjs` 解官方 **tar.gz** ⇒ npm 在 `node/lib/node_modules/npm/`
  //        （见该脚本 `const npm = path.join(tools, "node/lib/node_modules/npm/bin/npm-cli.js")`）
  //    第一版只写死 Windows 那一条 ⇒ mac 上 `resources/tools` 里永远找不到它 ⇒ 「Verify native
  //    automation before packaging」必红。同一文件第 29 行的 node 本体**本来就是按平台分支的**
  //    （`node.exe` vs `bin/node`）—— 我漏了这个既有模式。
  //    ⇒ 一律**按候选列表探测**，别再按平台写死单条路径；断言消息里两种布局都点出来。
  const npmCli = [
    path.join(root, "node", "node_modules", "npm", "bin", "npm-cli.js"),        // Windows（官方 zip 布局）
    path.join(root, "node", "lib", "node_modules", "npm", "bin", "npm-cli.js"), // macOS / Linux（官方 tar.gz 布局）
  ].find(fs.existsSync);
  assert.ok(npmCli,
    "随包 Node 缺少 npm（找过两种布局：node/node_modules/npm/bin/npm-cli.js 与 " +
    "node/lib/node_modules/npm/bin/npm-cli.js）—— 检查 package.json extraResources 里那条 " +
    "from=resources/tools/node/node_modules 的映射（electron-builder 会丢弃 from 根级的 node_modules）。" +
    "缺了它，「开发工具」与知识库的全部安装动作都会失败。");
  const npmVersion = spawnSync(node, [npmCli, "--version"], { encoding: "utf8", windowsHide: true, env, timeout: 60000 });
  assert.equal(npmVersion.status, 0, `随包 npm 跑不起来（${npmCli}）：${npmVersion.error?.message || npmVersion.stderr}`);
  console.log("npm:", String(npmVersion.stdout).trim());
  console.log("MCP tools:", (await mcp()).length);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
