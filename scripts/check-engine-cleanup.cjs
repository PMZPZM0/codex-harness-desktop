/**
 * 退出清理 · 引擎进程级验证：
 * 真实 spawn codex.exe → 用 child.pid 锁定本次进程 → 调 server.stop() →
 * 用系统级 tasklist 确认该 PID 的 codex.exe 真的消失。
 * monkey-patch spawn 捕获子进程句柄，不依赖 tasklist 前后对比（避免干扰已有实例）。
 */
const Module = require("node:module");
const cp = require("node:child_process");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let results = [];
const check = (name, ok) => { results.push({ name, ok: Boolean(ok) }); console.log((ok ? "  OK " : "  FAIL ") + name); };

// 捕获 spawn 的 child，锁定本次引擎 PID
const spawned = [];
const originalSpawn = cp.spawn;
cp.spawn = function (...args) {
  const child = originalSpawn.apply(this, args);
  spawned.push(child);
  return child;
};

function codexPids() {
  try {
    const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
    return new Set(out.split("\n").filter((l) => l.includes("codex.exe")).map((l) => l.split(",")[0].replace(/"/g, "")).filter(Boolean));
  } catch { return new Set(); }
}

(async () => {
  const { CodexServer } = require("../dist-electron/codex-server.js");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-proc-"));
  const server = new CodexServer(home);

  await server.start();
  const myPids = spawned.filter((c) => c.pid).map((c) => String(c.pid));
  check("start() 后真实 spawn 了 codex.exe（PID: " + myPids.join(",") + "）", myPids.length > 0);

  // 模拟 cleanupAll 里的 server.stop()
  server.stop();
  await new Promise((r) => setTimeout(r, 1000));

  const alive = codexPids();
  const stillAlive = myPids.filter((p) => alive.has(p));
  check("stop() 后本次 spawn 的 codex.exe 全部消失（残留 " + stillAlive.join(",") + "）", stillAlive.length === 0);

  const fail = results.filter((r) => !r.ok).length;
  console.log("\n引擎退出清理验证：" + (results.length - fail) + "/" + results.length + " 通过");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("异常:", e); process.exit(1); });
