// 落库 0.0.14 mac 双平台外链（幂等：先滤同 version+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.14-mac.cjs
// ⚠️ size/sha256 必须在 GitHub Release 资产就绪后从 API 核对回填（本脚本拒绝空值）
const fs = require("fs");
const path = require("path");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");

const VERSION = "0.0.14";

const PLATFORMS = [
  {
    platform: "mac-arm64",
    filename: `Codex Harness Desktop-${VERSION}-arm64-mac.zip (Apple 芯片 M 系列)`,
    external_url: `https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v${VERSION}/Codex.Harness.Desktop-${VERSION}-arm64-mac.zip`,
    size: 1007379871,
    sha256: "097923abbb7ba408413e1b338192e489f42413a6a5d3c454943ff700f6aa6725",
  },
  {
    platform: "mac-x64",
    filename: `Codex Harness Desktop-${VERSION}-x64-mac.zip (Intel 芯片)`,
    external_url: `https://github.com/PMZPZM0/codex-harness-desktop/releases/download/v${VERSION}/Codex.Harness.Desktop-${VERSION}-x64-mac.zip`,
    size: 1041310592,
    sha256: "963cbb49bdf4a750e002567a178bffc4852668a215998cdce8a5aa18ea044a83",
  },
];

function main() {
  if (PLATFORMS.some((p) => !p.size || !p.sha256)) {
    console.error("size/sha256 未回填——请先从 GitHub Release 资产核对后再跑");
    process.exit(1);
  }
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
      changelog: win ? win.changelog : "",
      mandatory: 1,
      uploaded_by: "admin",
      uploaded_at: win ? win.uploaded_at : Date.now(),
    });
  }
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
  console.log("inserted mac", VERSION, PLATFORMS.map((p) => p.platform).join("+"), "mandatory=1", "| total releases:", db.releases.length);
}

main();
