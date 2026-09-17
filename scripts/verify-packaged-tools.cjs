const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

const root = path.resolve(process.argv[2] || "resources/tools");
const modules = path.join(root, "npm-global", "node_modules");
// ⛔ 09-16 实测踩坑：electron-builder 的 copyDir 会**无条件丢弃 extraResources `from` 根级的
//    node_modules**（app-builder-lib/out/util/filter.js 里写死的 `if (relative === "node_modules") return false`，
//    且 walk() 在目录节点被过滤时整棵剪掉）。所以「npm-global 预解压」这条映射**从来只拷到了根级 shim**，
//    node_modules 是空的 —— 装出来的应用 nuphus/playwright-cli 两张卡都显示「未安装」，要用户点一次
//    「修复安装」解 zip 才可用，与「随包内置、开箱即用」的承诺不符。
//    修法：package.json 里另加一条 from=resources/tools/npm-global/node_modules 的映射（那层不叫 node_modules，绕过剪枝）。
//    下面两条断言把这件事钉死在产物层：谁把那条映射删了/写歪了，这里立刻红。
for (const marker of ["@nuphus/nuphus-mcp/package.json", "@playwright/cli/package.json"]) {
  assert.ok(fs.existsSync(path.join(modules, marker)),
    `随包缺少 ${marker} —— npm-global/node_modules 没打进包。检查 package.json extraResources 里那条 ` +
    "from=resources/tools/npm-global/node_modules 的映射（electron-builder 会丢弃 from 根级的 node_modules）。");
}
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
}
const env = {
  ...process.env,
  PATH: [path.dirname(node), path.join(root, "npm-global"), path.join(root, "npm-global", "bin"), process.env.PATH].join(path.delimiter),
  CLOAKBROWSER_CACHE_DIR: path.join(root, "cloak-cache"),
  CLOAKBROWSER_AUTO_UPDATE: "false",
  NO_UPDATE_NOTIFIER: "1",
  PLAYWRIGHT_BROWSERS_PATH: path.join(root, "pw-browsers"),
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
  console.log("MCP tools:", (await mcp()).length);
  const cli = spawnSync(node, [path.join(modules, "@playwright", "cli", "playwright-cli.js"), "--help"], {
    env, encoding: "utf8", windowsHide: true, timeout: 20000,
  });
  assert.equal(cli.status, 0, `Playwright CLI failed: ${cli.error?.message || cli.stderr}`);
  console.log("Playwright CLI: OK");
  // CloakBrowser（09-16 起从随包剥离 → 「开发工具」页按需 npm 下载）：不再是断言项。
  // 包里有就顺手验一次（自测包/手工塞过），没有才是发布包的正常形态 —— 不能因为「没内置」判失败。
  const cloakEntry = path.join(modules, "cloakbrowser", "dist", "index.js");
  if (!fs.existsSync(cloakEntry)) {
    console.log("CloakBrowser: 未随包内置（按需下载，符合 09-16 起的打包策略）");
  } else {
    const entry = pathToFileURL(cloakEntry).href;
    const source = `const {launch}=await import(${JSON.stringify(entry)});const b=await launch({headless:true});try{const p=await b.newPage();await p.goto('data:text/html,<title>packaged-smoke</title><h1>OK</h1>',{waitUntil:'domcontentloaded'});if(await p.title()!=='packaged-smoke')throw Error('Bad page');console.log('CloakBrowser: OK')}finally{await b.close()}`;
    const browser = spawnSync(node, ["--input-type=module", "-e", source], {
      env, encoding: "utf8", windowsHide: true, timeout: 90000,
    });
    assert.equal(browser.status, 0, `CloakBrowser failed: ${browser.error?.message || browser.stderr}`);
    console.log(browser.stdout.trim());
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
