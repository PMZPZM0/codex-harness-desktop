// 发布站落库：为 0.0.3 登记 macOS 双芯片包（外链到 GitHub Releases，不占服务器带宽）
// 幂等：先滤掉该版本已有的 mac 记录；同时给历史记录补 platform 字段（缺省 windows）
const fs = require("node:fs");
const DB = "/var/www/codex-harness-releases/data/releases.json";
const db = JSON.parse(fs.readFileSync(DB, "utf8"));

const VER = "0.0.3";
const CH = "stable";
const GH = "https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v0.0.3/";

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
    filename: "Codex Harness Desktop-0.0.3-arm64-mac.zip",
    size: 242145375,
    sha256: "8f8e3892113d2d4b28750dbbcb237646439d30ed4201ae716ec77888e1fecc4b",
    url: GH + "Codex.Harness.Desktop-0.0.3-arm64-mac.zip",
  },
  {
    platform: "mac-x64",
    filename: "Codex Harness Desktop-0.0.3-x64-mac.zip",
    size: 254159981,
    sha256: "0266f14c1a6024c515a7c709d4e0faed12910ed2536a8e39a33b51af0fbcd9b8",
    url: GH + "Codex.Harness.Desktop-0.0.3-x64-mac.zip",
  },
];

for (const it of items) {
  db.releases.push({
    id: db.nextId++,
    version: VER,
    channel: CH,
    platform: it.platform,
    filename: it.filename,
    stored_name: "", // 外链记录：无本地文件
    external_url: it.url,
    size: it.size,
    sha256: it.sha256,
    changelog,
    mandatory: 0,
    uploaded_by: "admin",
    uploaded_at: ts,
  });
}

const tmp = DB + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
fs.renameSync(tmp, DB);

const of = (p) => db.releases.filter((r) => r.version === VER && r.channel === CH && r.platform === p).length;
console.log(
  `ok: 0.0.3 windows=${of("windows")} mac-arm64=${of("mac-arm64")} mac-x64=${of("mac-x64")} total=${db.releases.length} nextId=${db.nextId}`
);
