// 发布站落库：登记 0.0.3 stable（幂等：先滤同版本同 channel 记录）
const fs = require("node:fs");
const DB = "/var/www/codex-harness-releases/data/releases.json";
const db = JSON.parse(fs.readFileSync(DB, "utf8"));
db.releases = (db.releases ?? []).filter((r) => !(r.version === "0.0.3" && r.channel === "stable"));
db.releases.push({
  id: db.nextId++,
  version: "0.0.3",
  channel: "stable",
  filename: "Codex Harness Desktop Setup 0.0.3.exe",
  stored_name: "0.0.3_CodexHarness-Setup-0.0.3.exe",
  size: 675891444,
  sha256: "b6bd613437aaaf4596d614748e7b7ad54e6b607324d7736795a29f706c3080df",
  changelog: [
    "更新地址可切换：官方发布站 / GitHub Releases 双源（检查更新菜单内选择）",
    "修复偶发残留的发送中占位",
    "修正长任务缓存命中率统计口径",
    "界面优化：模型菜单按供应商着色、附件菜单 WorkBuddy 式双面板",
  ].join("\n"),
  mandatory: 0,
  uploaded_by: "admin",
  uploaded_at: Date.now(),
});
const tmp = DB + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
fs.renameSync(tmp, DB);
console.log("inserted 0.0.3, total releases:", db.releases.length, "nextId:", db.nextId);
