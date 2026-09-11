// 落库 0.0.12 mac 双平台外链（幂等：先滤同 version+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.12-mac.cjs
// size/sha256 需在 GitHub Release 资产就绪后从 API 核对回填（见发版流程）。
const fs = require("fs");
const path = require("path");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");

const VERSION = "0.0.12";
const CHANGELOG = [
  "【模型】切换模型/打开旧会话时，模型档案与引擎配置 100% 同步（custom-model.json + config.toml 一次写齐）：模型被问「你是什么模型」不再自报旧模型，打开旧会话不再被全局默认悄悄改掉",
  "【模型】同步档案不再重启引擎——正在跑的回合、流式输出完全不受打断（此前同步会杀掉在跑任务）",
  "【模型】删除供应商后旧会话可用的别名段兜底：配置里自动补齐已删除 id 的段，旧会话不再因 id 失效而 401",
  "【修复】会话中途切权限掉档问题（sandboxPolicy 每轮下发），权限边界更可靠",
  "【测试】端到端测试升级为真实后端取证：断言直接读引擎 rollout 的真实模型与网关回包证据，回归更可信（对用户行为无影响）",
].join("\n");

const PLATFORMS = [
  {
    platform: "mac-arm64",
    filename: `Codex Harness Desktop-${VERSION}-arm64-mac.zip (Apple 芯片 M 系列)`,
    external_url: `https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v${VERSION}/Codex.Harness.Desktop-${VERSION}-arm64-mac.zip`,
    size: 937154105,
    sha256: "756e30f3e288bab9dd22df7c59b353bc0978512d4cd785f3973bd3d1160a3291",
  },
  {
    platform: "mac-x64",
    filename: `Codex Harness Desktop-${VERSION}-x64-mac.zip (Intel 芯片)`,
    external_url: `https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v${VERSION}/Codex.Harness.Desktop-${VERSION}-x64-mac.zip`,
    size: 969755597,
    sha256: "d4fe9848fa3418817f20293f932e5d0f4200b8b125efd715daa8131acd0557e9",
  },
];

function main() {
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  db.releases = db.releases.filter((r) => !(r.version === VERSION && (r.platform || "windows").startsWith("mac") && r.channel === "stable"));
  const win = db.releases.find((r) => r.version === VERSION && (r.platform || "windows") === "windows");
  for (const p of PLATFORMS) {
    db.releases.push({
      id: db.nextId++,
      version: VERSION,
      channel: "stable",
      platform: p.platform,
      filename: p.filename,
      stored_name: "",
      external_url: p.external_url,
      size: p.size,
      sha256: p.sha256,
      changelog: CHANGELOG,
      mandatory: 0,
      uploaded_by: "admin",
      uploaded_at: win?.uploaded_at ?? Date.now(),
    });
  }
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
  console.log("inserted mac records for", VERSION, "total releases:", db.releases.length);
}

main();
