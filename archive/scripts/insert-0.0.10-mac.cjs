// 落库 0.0.10 mac 双平台外链（幂等：先滤同 version+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.10-mac.cjs
const fs = require("fs");
const path = require("path");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");

const VERSION = "0.0.10";
const CHANGELOG = [
  "【性能】设置页按需加载 + 骨架先行：插件/技能/MCP 市场点击秒开，不再一次全量加载（开代理也不卡）",
  "【会话】切换供应商/账号时当前会话自动迁移绑定、历史保留；切换后输入框额度监控与模型配置立即强同步（带账号邮箱标识）",
  "【排队】排队消息 2 条以上可折叠/展开（默认展开），拖动排序带常驻手柄",
  "【重度用户】超长上下文时间线窗口化（视口外回合跳过渲染）；上下文用量 ≥70% 一键压缩、≥80% 橙 / ≥95% 红预警；新增「数据管理」页（存储统计/安全清理缓存，绝不删会话）",
  "【模型】模型列表删除保存后不再复活（保存以完整列表为权威）；额度重置倒计时（HH:mm）实时同步",
  "【修复】压缩成功/失败分隔线常驻留痕；流式出字上下跳动修复；恢复「最新 3 条」折叠设计 + 新增行淡入动画",
].join("\n");

const PLATFORMS = [
  {
    platform: "mac-arm64",
    filename: "Codex Harness Desktop-0.0.10-arm64-mac.zip (Apple 芯片 M 系列)",
    external_url: "https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v0.0.10/Codex.Harness.Desktop-0.0.10-arm64-mac.zip",
    size: 920153219,
    sha256: "f1076107657fa563b5109aad07bc0b56f24a4a5cba886de1bcfa75c3bcab9047",
  },
  {
    platform: "mac-x64",
    filename: "Codex Harness Desktop-0.0.10-x64-mac.zip (Intel 芯片)",
    external_url: "https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v0.0.10/Codex.Harness.Desktop-0.0.10-x64-mac.zip",
    size: 952755432,
    sha256: "54dcbfe5b65016ae2e2d3ce94bfc3714c60a647e16cd37c1a41cc1bf6ff46c6c",
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
