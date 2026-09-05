const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

const root = path.resolve(process.argv[2] || "resources/tools");
const modules = path.join(root, "npm-global", "node_modules");
const platform = process.platform === "darwin" ? "osx" : process.platform;
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeName = `nuphus-mcp-${platform}-${process.arch}`;
const native = [
  path.join(modules, "@nuphus", "nuphus-mcp", "node_modules", "@nuphus", nativeName, "bin", `nuphus-mcp${suffix}`),
  path.join(modules, "@nuphus", nativeName, "bin", `nuphus-mcp${suffix}`),
  path.join(root, "nuphus", `nuphus-mcp${suffix}`),
].find(fs.existsSync);
const node = path.join(root, "node", ...(process.platform === "win32" ? ["node.exe"] : ["bin", "node"]));
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
  const entry = pathToFileURL(path.join(modules, "cloakbrowser", "dist", "index.js")).href;
  const source = `const {launch}=await import(${JSON.stringify(entry)});const b=await launch({headless:true});try{const p=await b.newPage();await p.goto('data:text/html,<title>packaged-smoke</title><h1>OK</h1>',{waitUntil:'domcontentloaded'});if(await p.title()!=='packaged-smoke')throw Error('Bad page');console.log('CloakBrowser: OK')}finally{await b.close()}`;
  const browser = spawnSync(node, ["--input-type=module", "-e", source], {
    env, encoding: "utf8", windowsHide: true, timeout: 90000,
  });
  assert.equal(browser.status, 0, `CloakBrowser failed: ${browser.error?.message || browser.stderr}`);
  console.log(browser.stdout.trim());
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
