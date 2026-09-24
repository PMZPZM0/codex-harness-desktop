// 落库 0.0.12 Windows 版（幂等：先滤同 version+channel+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.12-win.cjs
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");
const FILES = path.join(ROOT, "data/files");

const VERSION = "0.0.12";
const PLATFORM = "windows";
const FILENAME = "Codex Harness Desktop Setup 0.0.12.exe";
const STORED = "0.0.12_CodexHarness-Setup-0.0.12.exe";

const CHANGELOG = [
  "【模型】切换模型/打开旧会话时，模型档案与引擎配置 100% 同步（custom-model.json + config.toml 一次写齐）：模型被问「你是什么模型」不再自报旧模型，打开旧会话不再被全局默认悄悄改掉",
  "【模型】同步档案不再重启引擎——正在跑的回合、流式输出完全不受打断（此前同步会杀掉在跑任务）",
  "【模型】删除供应商后旧会话可用的别名段兜底：配置里自动补齐已删除 id 的段，旧会话不再因 id 失效而 401",
  "【修复】会话中途切权限掉档问题（sandboxPolicy 每轮下发），Windows 沙箱下权限边界更可靠",
  "【测试】端到端测试升级为真实后端取证：断言直接读引擎 rollout 的真实模型与网关回包证据，回归更可信（对用户行为无影响）",
].join("\n");

function main() {
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  db.releases = db.releases.filter((r) => !(r.version === VERSION && (r.platform || "windows") === PLATFORM && r.channel === "stable"));
  const filePath = path.join(FILES, STORED);
  const stat = fs.statSync(filePath);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  db.releases.push({
    id: db.nextId++,
    version: VERSION,
    channel: "stable",
    platform: PLATFORM,
    filename: FILENAME,
    stored_name: STORED,
    size: stat.size,
    sha256,
    changelog: CHANGELOG,
    mandatory: 0,
    uploaded_by: "admin",
    uploaded_at: Date.now(),
  });
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
  console.log("inserted", VERSION, PLATFORM, stat.size, sha256.slice(0, 12), "total releases:", db.releases.length);
}

main();
