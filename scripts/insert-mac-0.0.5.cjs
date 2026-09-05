// 发布站落库：为 0.0.5 登记 macOS 双芯片包（外链到 GitHub Releases，不占服务器带宽）
const fs = require("node:fs");
const DB = "/var/www/codex-harness-releases/data/releases.json";
const db = JSON.parse(fs.readFileSync(DB, "utf8"));

const VER = "0.0.5";
const CH = "stable";
const GH = "https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v0.0.5/";

db.releases.forEach((r) => { if (!r.platform) r.platform = "windows"; });
db.releases = db.releases.filter(
  (r) => !(r.version === VER && r.channel === CH && (r.platform === "mac-arm64" || r.platform === "mac-x64"))
);

const win = db.releases.find((r) => r.version === VER && r.channel === CH && r.platform === "windows");
const changelog = win ? win.changelog : "";
const ts = win ? win.uploaded_at : Date.now();

const items = [
  {
    platform: "mac-arm64",
    filename: "Codex Harness Desktop-0.0.5-arm64-mac.zip",
    size: 248409747,
    sha256: "319238606edcf2330329248e259705c824b03fe1a8d141beba6de09386c9da6f",
    url: GH + "Codex.Harness.Desktop-0.0.5-arm64-mac.zip",
  },
  {
    platform: "mac-x64",
    filename: "Codex Harness Desktop-0.0.5-x64-mac.zip",
    size: 261854912,
    sha256: "0fc345c365c84c92360933096ef0b05bff2364125b7ba4728195b3abab9f7fa9",
    url: GH + "Codex.Harness.Desktop-0.0.5-x64-mac.zip",
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