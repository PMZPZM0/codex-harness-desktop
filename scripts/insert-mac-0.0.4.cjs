// 发布站落库：为 0.0.4 登记 macOS 双芯片包（外链到 GitHub Releases，不占服务器带宽）
// 幂等：先滤掉该版本已有的 mac 记录；同时给历史记录补 platform 字段（缺省 windows）
const fs = require("node:fs");
const DB = "/var/www/codex-harness-releases/data/releases.json";
const db = JSON.parse(fs.readFileSync(DB, "utf8"));

const VER = "0.0.4";
const CH = "stable";
const GH = "https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v0.0.4/";

// 1) 历史记录补 platform（缺省 windows，保证 /api/latest 平台过滤行为一致）
db.releases.forEach((r) => {
  if (!r.platform) r.platform = "windows";
});

// 2) 清掉该版本旧的 mac 记录后重建（幂等）
db.releases = db.releases.filter(
  (r) => !(r.version === VER && r.channel === CH && (r.platform === "mac-arm64" || r.platform === "mac-x64"))
);

const win = db.releases.find((r) => r.version === VER && r.channel === CH && r.platform === "windows");
const changelog = win ? win.changelog : "";
const ts = win ? win.uploaded_at : Date.now();

const items = [
  {
    platform: "mac-arm64",
    filename: "Codex Harness Desktop-0.0.4-arm64-mac.zip",
    size: 240369520,
    sha256: "70c2eb332e281bd237c3f8401d736df1fb928e8097c9fd05485bb52aca6d158f",
    url: GH + "Codex.Harness.Desktop-0.0.4-arm64-mac.zip",
  },
  {
    platform: "mac-x64",
    filename: "Codex Harness Desktop-0.0.4-x64-mac.zip",
    size: 252039797,
    sha256: "cbe9f0a8d2308550bff6bd29d37567ecb46f49aa840fc9dd2371d5a679e1b36a",
    url: GH + "Codex.Harness.Desktop-0.0.4-x64-mac.zip",
  },
];

for (const item of items) {
  db.releases.push({
    id: (db.nextId ?? Math.max(...db.releases.map((r) => Number(r.id) || 0), 0) + 1),
    version: VER,
    channel: CH,
    platform: item.platform,
    filename: item.filename,
    stored_name: "",
    external_url: item.url,
    size: item.size,
    sha256: item.sha256,
    changelog,
    mandatory: 0,
    uploaded_by: "admin",
    uploaded_at: ts,
  });
  db.nextId = (db.nextId ?? Math.max(...db.releases.map((r) => Number(r.id) || 0), 0)) + 1;
}

const tmp = DB + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
fs.renameSync(tmp, DB);
console.log("inserted 2 mac external records for", VER);