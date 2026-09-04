// 引擎 [permissions] 配置格式探针：验证引擎原生是否支持按 MCP 工具配权限。
//
// 背景：WorkBuddy 有工具级 deny/ask/allow 权限模型，我们想复刻到 Codex Harness。
// 引擎二进制里有 GranularApprovalConfig（sandbox_approval/skill_approval/
// request_permissions/mcp_elicitations）与 approval_policy 开关，但不确定 config.toml
// 里到底怎么序列化。本探针用独立 CODEX_HOME 逐种候选格式起 app-server，
// 看 initialize 握手能不能过、进程会不会崩，从而确定能安全写进生产的格式。
//
// 跑法：node scripts/probe-permissions-config.cjs
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

const pkg = require.resolve("@openai/codex-win32-x64/package.json");
const bin = path.join(path.dirname(pkg), "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

const CANDIDATES = {
  // 1) 旧版经典：permissions.allow/ask/deny 数组（mcp__server__tool 命名）
  "legacy-allow-ask-deny": [
    '[permissions.allow]',
    '"mcp__nuphus__desktop_screenshot" = true',
    '[permissions.ask]',
    '"mcp__nuphus__desktop_exec" = true',
  ].join("\n"),
  // 2) 顶层 permissions 键，值为字符串档位（on-request 风格）
  "top-level-map": [
    '[permissions]',
    '"mcp__nuphus__desktop_exec" = "ask"',
    '"mcp__nuphus__desktop_screenshot" = "allow"',
  ].join("\n"),
  // 3) 顶层权限 + default_permissions 指向一个 profile
  "profile-default": [
    '[permissions]',
    'default_permissions = "workspace-write"',
    '[permissions.granular]',
    '"mcp__nuphus__desktop_exec" = "ask"',
  ].join("\n"),
  // 4) approval_policy 顶层键（on-request/granular/never）
  "approval-policy": [
    'approval_policy = "granular"',
    '[permissions]',
    '"mcp__nuphus__desktop_exec" = "ask"',
  ].join("\n"),
  // 5) ToolsToml 的 disabled_tools（mcp__ 命名，引擎明确支持按工具启停）
  "tools-disabled": [
    '[tools]',
    'web_search = true',
    'disabled_tools = ["mcp__nuphus__desktop_exec"]',
  ].join("\n"),
  // 6) 空 [permissions] 表（纯验证表能被解析）
  "empty-table": [
    '[permissions]',
    'default_permissions = "workspace-write"',
  ].join("\n"),
  // 7) 生产格式：permissionsToml() 实际输出的样子（mcp__server__tool = true）
  "prod-format": [
    '[permissions.allow]',
    '"mcp__nuphus__desktop_screenshot" = true',
    '[permissions.ask]',
    '"mcp__nuphus__desktop_exec" = true',
    '[permissions.deny]',
    '"mcp__nuphus__browser_goto" = true',
  ].join("\n"),
};

function runScenario(label, extraToml) {
  const home = `D:/tmp-codex-perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  fs.mkdirSync(home, { recursive: true });
  // 最小可起 config：必须有一个模型 provider，否则引擎可能直接拒绝启动
  const base = [
    `model = "gpt-5-codex"`,
    `model_provider = "harness-probe"`,
    "",
    `[model_providers.harness-probe]`,
    `name = "harness-probe"`,
    `base_url = "http://127.0.0.1:1"`,
    `env_key = "CODEX_HARNESS_API_KEY"`,
    `wire_api = "responses"`,
    "requires_openai_auth = false",
    "",
    extraToml,
  ].join("\n");
  fs.writeFileSync(path.join(home, "config.toml"), base);

  const child = spawn(bin, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, CODEX_HOME: home, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
  });

  let nextId = 1;
  const pending = new Map();
  let stderrBuf = "";
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id === undefined) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
  });
  child.stderr.on("data", (d) => { stderrBuf += d.toString(); });
  const request = (method, params, timeoutMs = 8000) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return (async () => {
    let readBack = null;
    let configDump = null;
    try {
      await request("initialize", { clientInfo: { name: "codex_harness_desktop", title: "probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
      await sleep(600);
      // permissionProfile/list 直接暴露引擎解析后的权限配置
      try {
        const v = await request("permissionProfile/list", {}, 5000);
        readBack = { key: "permissionProfile/list", value: v };
      } catch (e) {
        readBack = { key: "permissionProfile/list", value: "ERR:" + e.message };
      }
      // config/read 看引擎内部解析后的 permissions / tools 字段
      try {
        const v = await request("config/read", {}, 5000);
        if (v && typeof v === "object") {
          const src = v.config ?? v;
          // 完整保留 permissions / tools 两段，便于观察引擎到底解析出什么
          configDump = {
            permissions: src.permissions ?? null,
            tools: src.tools ?? null,
          };
        }
      } catch { /* config/read 不可用就跳过 */ }
      return { label, ok: true, result: "握手通过", readBack, configDump, stderr: stderrBuf.slice(0, 400) };
    } catch (error) {
      return { label, ok: false, result: error.message, readBack: null, configDump: null, stderr: stderrBuf.slice(0, 600) };
    } finally {
      child.kill();
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 引擎未完全退出 */ }
    }
  })();
}

(async () => {
  console.log("逐候选 [permissions] 配置起 app-server，验证能否安全解析：\n");
  for (const [label, toml] of Object.entries(CANDIDATES)) {
    process.stdout.write(`  → ${label.padEnd(22)} …`);
    const result = await runScenario(label, toml);
    const tag = result.ok ? "✅ 通过" : "❌ 失败";
    console.log(` ${tag}  ${result.result}`);
    if (result.readBack) {
      const val = typeof result.readBack.value === "string" ? result.readBack.value : JSON.stringify(result.readBack.value);
      console.log(`        profiles: ${val.slice(0, 300)}`);
    }
    if (result.configDump) {
      console.log(`        config: ${JSON.stringify(result.configDump).slice(0, 400)}`);
    }
    if (result.stderr && !result.ok) {
      // 只看关键错误行
      const keyLine = result.stderr.split(/\r?\n/).filter((l) => /error|invalid|cannot|permission|toml/i.test(l)).slice(0, 3).join(" | ");
      if (keyLine) console.log(`        stderr: ${keyLine}`);
    }
  }
  process.exit(0);
})();
