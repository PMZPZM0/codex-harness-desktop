// 发布站落库：登记 0.0.5 Windows 安装包（已 scp 上传 data/files/0.0.5_*.exe）
// 幂等：先滤同版本同 channel 的 windows 记录；sha256/size 由服务器对实文件计算
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DB = "/var/www/codex-harness-releases/data/releases.json";
const FILES_DIR = "/var/www/codex-harness-releases/data/files";

const VER = "0.0.5";
const CH = "stable";
const FILENAME = "Codex Harness Desktop Setup 0.0.5.exe";
const STORED = "0.0.5_CodexHarness-Setup-0.0.5.exe";
const CHANGELOG =
  "自动化工具完整内置（nuphus/playwright-cli/cloakbrowser 包本体 + Chromium 内核随包）；模型上下文额度防呆（编辑器标题显示供应商名）；欢迎页个性化副语（配置模型后模型真实生成）；侧栏会话刷新按钮；/命令中文注释+常用置顶；Electron 44.2.0；引擎更新下载跟随本地网络";

const db = JSON.parse(fs.readFileSync(DB, "utf8"));
db.releases.forEach((r) => { if (!r.platform) r.platform = "windows"; });

db.releases = db.releases.filter(
  (r) => !(r.version === VER && r.channel === CH && (r.platform || "windows") === "windows")
);

const filePath = path.join(FILES_DIR, STORED);
const stat = fs.statSync(filePath);
const sha = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const maxId = db.releases.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);

db.releases.push({
  id: Math.max(maxId + 1, (db.nextId ?? maxId + 1)),
  version: VER,
  channel: CH,
  platform: "windows",
  filename: FILENAME,
  stored_name: STORED,
  size: stat.size,
  sha256: sha,
  changelog: CHANGELOG,
  mandatory: 0,
  uploaded_by: "admin",
  uploaded_at: Date.now(),
});
db.nextId = Math.max(db.nextId ?? 0, db.releases[db.releases.length - 1].id + 1);

const tmp = DB + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
fs.renameSync(tmp, DB);
console.log("inserted:", FILENAME, stat.size, sha.slice(0, 12) + "...");