// 落库 0.0.16 Windows 版（幂等：先滤同 version+channel+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.16-win.cjs
// ⚠️ 强更新：mandatory = 1（0.0.14→0.0.16 含多窗口配置正确性修复，保持强更新）
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");
const FILES = path.join(ROOT, "data/files");

const VERSION = "0.0.16";
const PLATFORM = "windows";
const FILENAME = "Codex Harness Desktop Setup 0.0.16.exe";
const STORED = "0.0.16_CodexHarness-Setup-0.0.16.exe";

const CHANGELOG = ["【新功能】专家团会话侧栏聚簇：主会话 + 成员会话合并为一行（「N 会话」徽标），默认折叠，点箭头展开「主会话/成员会话」分节（限高滚动适配）","【修复】欢迎页项目地址流程：选完目录不再丢消息、不再建进错误的临时目录","【优化】项目地址菜单三段式：历史项目地址（直接沿用）/ 新项目地址 / 不使用项目地址，选项加大","【修复】成员工作弹窗：运行中关掉再点开历史不再空白（活跃委托并入历史）、产出自动跟随最新、滚动不再穿透主消息区","【修复】成员/子智能体首条消息不再裸露角色提示词（旧会话打开即正确折叠）","【优化】成员头像轨改浮层：消息区不再被右侧空白列挤压，气泡与输入框右缘对齐"].join("
"););

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
    mandatory: 1,
    uploaded_by: "admin",
    uploaded_at: Date.now(),
  });
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
  console.log("inserted", VERSION, PLATFORM, "mandatory=1", stat.size, sha256.slice(0, 12), "| total releases:", db.releases.length);
}

main();
