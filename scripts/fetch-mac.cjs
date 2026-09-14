const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { api } = require("./gh-api.cjs");

const VERSION = "0.0.17";
const ROOT = "D:/Codex Harness Desktop";
const OUT = path.join(ROOT, "release-mac-" + VERSION);
const ITEMS = [
  { arch: "arm64", artifactId: "10351553266" },
  { arch: "x64", artifactId: "10354371001" },
];
const PY = ["C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe"];

function sha256(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(8 * 1024 * 1024);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest("hex");
}
function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  try {
    execFileSync("tar.exe", ["-xf", zip, "-C", dest], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 900000 });
    return "tar";
  } catch (e) {
    execFileSync(PY[0], ["-c", "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, dest], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 900000 });
    return "python";
  }
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  for (const it of ITEMS) {
    const raw = path.join(OUT, "raw-" + it.arch + ".zip");
    console.log(`[${it.arch}] 下载 artifact ${it.artifactId} …`);
    const t0 = Date.now();
    const args = ["-sL", "-x", "http://127.0.0.1:7897", "--max-time", "1800", "-H", "Authorization: Bearer " + require("./gh-api.cjs").tok, "-o", raw,
      `https://api.github.com/repos/PMZPZM0/codex-harness-desktop/actions/artifacts/${it.artifactId}/zip`];
    execFileSync("curl.exe", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1900000 });
    const rawSize = fs.statSync(raw).size;
    console.log(`[${it.arch}] 下载完成 ${(rawSize / 1048576).toFixed(0)}MB  用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

    const ex = path.join(OUT, "ex-" + it.arch);
    const how = unzip(raw, ex);
    const candidates = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.endsWith(".zip")) candidates.push(p);
      }
    })(ex);
    console.log(`[${it.arch}] 用 ${how} 解出，内层 zip: ${candidates.map((c) => path.basename(c)).join(" , ")}`);
    const hit = candidates.filter((c) => path.basename(c).includes(VERSION));
    if (hit.length !== 1) { console.log(`!! [${it.arch}] 命中 ${hit.length} 个含 ${VERSION} 的 zip，需人工确认`); process.exit(2); }
    const finalDir = path.join(OUT, "final");
    fs.mkdirSync(finalDir, { recursive: true });
    const finalName = `Codex Harness Desktop-${VERSION}-${it.arch}-mac.zip`;
    const finalPath = path.join(finalDir, finalName);
    fs.copyFileSync(hit[0], finalPath);
    const size = fs.statSync(finalPath).size;
    const sha = sha256(finalPath);
    console.log(`[${it.arch}] ✓ ${finalName}  ${(size / 1048576).toFixed(1)}MB  sha256=${sha}`);
    results.push({ arch: it.arch, file: finalPath, name: finalName, size, sha });
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(results, null, 2), "utf8");
  console.log("\n=== manifest 已写入 release-mac-" + VERSION + "/manifest.json ===");
  for (const r of results) console.log(`  ${r.arch}: size=${r.size} sha256=${r.sha}`);
})();
