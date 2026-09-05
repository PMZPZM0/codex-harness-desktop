// 发布站落库：登记 0.0.4 Windows 安装包（服务器已由 scp 上传 data/files/0.0.4_*.exe）
// 幂等：先滤同版本同 channel 的 windows 记录；sha256/size 由服务器对实文件计算
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DB = "/var/www/codex-harness-releases/data/releases.json";
const FILES_DIR = "/var/www/codex-harness-releases/data/files";

const VER = "0.0.4";
const CH = "stable";
const FILENAME = "Codex Harness Desktop Setup 0.0.4.exe";
const STORED = "0.0.4_CodexHarness-Setup-0.0.4.exe";
const CHANGELOG =
  "Codex 引擎升级 0.153.4（Windows 沙箱修复/断线重连/shell 超时可配）；设置页新增引擎在线更新（可配置代理，更新完自动重启）；渲染加速（屏外回合跳过布局绘制，长会话流式更流畅）；渠道机器人会话自动进侧栏；账号菜单新增刷新会话列表；上下文压缩后缓存重建提示";

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