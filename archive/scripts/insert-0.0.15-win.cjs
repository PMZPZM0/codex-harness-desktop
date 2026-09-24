// 落库 0.0.15 Windows 版（幂等：先滤同 version+channel+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.15-win.cjs
// ⚠️ 强更新：mandatory = 1（0.0.14→0.0.15 含多窗口配置正确性修复，保持强更新）
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");
const FILES = path.join(ROOT, "data/files");

const VERSION = "0.0.15";
const PLATFORM = "windows";
const FILENAME = "Codex Harness Desktop Setup 0.0.15.exe";
const STORED = "0.0.15_CodexHarness-Setup-0.0.15.exe";

const CHANGELOG = ["【新功能】专家团并行调度：成员头像轨、工作弹窗、历史记录 —— 多位专家同时干活，进度一目了然","【新功能】审批卡紧凑化：审批请求改到「输入框上一行 + 点开预览」，多条审批不再占满整屏","【优化】会话切换丝滑化：命中缓存的会话直渲（实测 P50 20ms）；冷加载先出骨架再补内容","【优化】大 diff 行级虚拟化：几千行的文件变更只渲染可视区，展开编辑卡不卡","【优化】切回不缩水：展开过的历史窗口与阅读位置切回即还原（带 LRU 上限）","【优化】多会话并发更省：主进程按会话裁剪事件，后台会话的流式数据不再白白跨进程","【修复】会话级配置收敛：模型/档位/权限单一存放 + 主进程权威落盘 —— 多窗口同时改配置不再互相覆盖、不再误报「另一个窗口改了配置」","【修复】模型自报身份改读会话级作用域，堵住全局档案被会话选择意外回写","【修复】窄窗口下弹窗自适应"].join("\n");

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
