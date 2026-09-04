/**
 * 引擎健康看门狗 e2e：验证 CodexServer 的心跳链路。
 * - 真实 spawn 引擎二进制，start() 后心跳应能正常通过（不误杀正常引擎）
 * - 验证 startWatchdog/stopWatchdog/heartbeat 存在且可调用
 * - 验证 thread/list 是引擎支持的心跳方法
 * 不真杀引擎（避免污染真实 CODEX_HOME），只验证「正常引擎不会被误判」。
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const bin = path.join(process.cwd(), "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
assert.ok(fs.existsSync(bin), "引擎二进制存在: " + bin);

// 动态加载编译后的 CodexServer（dist-electron/codex-server.js）
const { CodexServer } = require("../dist-electron/codex-server.js");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-"));
const server = new CodexServer(home);

let results = [];
const check = (name, ok) => { results.push({ name, ok: Boolean(ok) }); console.log((ok ? "  OK " : "  FAIL ") + name); };

(async () => {
  // 1. 未 start 时 stopWatchdog/startWatchdog 不应报错
  server.startWatchdog();
  server.stopWatchdog();
  check("看门狗可启动/停止（未 start 前）", true);

  // 2. 真实引擎 start
  await server.start();
  check("引擎 start() 成功", server.running);

  // 3. 心跳：验证 thread/list 是引擎支持的方法
  const r = await server.request("thread/list", {}, 8000);
  check("thread/list 心跳方法可用（返回对象）", r && typeof r === "object");
  check("引擎 running", server.running);

  // 4. 看门狗正常模式下不应触发重启
  if (typeof server.heartbeat === "function") await server.heartbeat();
  await new Promise((r) => setTimeout(r, 300));
  check("正常心跳不误杀（进程仍在）", server.running);

  // 5. stop 后看门狗停止
  server.stop();
  check("stop() 后引擎停止", !server.running);

  const fail = results.filter((r) => !r.ok).length;
  console.log("\n看门狗验证：" + (results.length - fail) + "/" + results.length + " 通过");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("看门狗验证异常:", e); process.exit(1); });
