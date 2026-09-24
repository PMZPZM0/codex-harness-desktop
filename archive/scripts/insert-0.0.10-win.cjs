// 落库 0.0.10 Windows 版（幂等：先滤同 version+channel+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.10-win.cjs
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");
const FILES = path.join(ROOT, "data/files");

const VERSION = "0.0.10";
const PLATFORM = "windows";
const FILENAME = "Codex Harness Desktop Setup 0.0.10.exe";
const STORED = "0.0.10_CodexHarness-Setup-0.0.10.exe";

const CHANGELOG = [
  "【性能】设置页按需加载 + 骨架先行：插件/技能/MCP 市场点击秒开，不再一次全量加载（开代理也不卡）",
  "【会话】切换供应商/账号时当前会话自动迁移绑定、历史保留；切换后输入框额度监控与模型配置立即强同步（带账号邮箱标识）",
  "【排队】排队消息 2 条以上可折叠/展开（默认展开），拖动排序带常驻手柄",
  "【重度用户】超长上下文时间线窗口化（视口外回合跳过渲染）；上下文用量 ≥70% 一键压缩、≥80% 橙 / ≥95% 红预警；新增「数据管理」页（存储统计/安全清理缓存，绝不删会话）",
  "【模型】模型列表删除保存后不再复活（保存以完整列表为权威）；额度重置倒计时（HH:mm）实时同步",
  "【修复】压缩成功/失败分隔线常驻留痕；流式出字上下跳动修复；恢复「最新 3 条」折叠设计 + 新增行淡入动画",
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
