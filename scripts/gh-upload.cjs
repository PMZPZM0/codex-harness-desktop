const { execFileSync } = require("child_process");
const fs = require("fs");
const { tok } = require("./gh-api.cjs");
const REPO = "PMZPZM0/codex-harness-desktop";
const RELEASE_ID = "388758489";
const LOG = "D:/Codex Harness Desktop/.e2e-artifacts/gh-upload.log";
try { fs.unlinkSync(LOG); } catch {}
const log = (m) => fs.appendFileSync(LOG, `[${new Date().toLocaleTimeString()}] ${m}\n`, "utf8");

const ITEMS = [
  { file: "release-0.0.17/Codex Harness Desktop Setup 0.0.17.exe", name: "Codex.Harness.Desktop-0.0.17-win-x64.exe", label: "Windows", type: "application/octet-stream" },
  { file: "release-mac-0.0.17/final/Codex Harness Desktop-0.0.17-arm64-mac.zip", name: "Codex.Harness.Desktop-0.0.17-arm64-mac.zip", label: "mac arm64", type: "application/zip" },
  { file: "release-mac-0.0.17/final/Codex Harness Desktop-0.0.17-x64-mac.zip", name: "Codex.Harness.Desktop-0.0.17-x64-mac.zip", label: "mac x64", type: "application/zip" },
];

function upload(item, useProxy) {
  const args = ["-sL", "--max-time", "3600", "-H", "Authorization: Bearer " + tok,
    "-H", "Content-Type: " + item.type, "-H", "Accept: application/vnd.github+json",
    "--data-binary", "@" + item.file, "-w", "\n__HTTP__%{http_code}",
    `https://uploads.github.com/repos/${REPO}/releases/${RELEASE_ID}/assets?name=${encodeURIComponent(item.name)}`];
  if (useProxy) args.splice(1, 0, "-x", "http://127.0.0.1:7897");
  else args.splice(1, 0, "--noproxy", "*");
  return execFileSync("curl.exe", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 3700000 });
}

(async () => {
  const out = {};
  for (const item of ITEMS) {
    const size = fs.statSync(item.file).size;
    log(`开始上传 ${item.label}  ${(size / 1048576).toFixed(1)}MB → ${item.name}`);
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const useProxy = attempt > 1;
      const t0 = Date.now();
      try {
        const res = upload(item, useProxy);
        const code = (res.match(/__HTTP__(\d+)/) || [])[1];
        if (code === "201") {
          const body = res.replace(/__HTTP__\d+\s*$/, "");
          const j = JSON.parse(body.slice(body.indexOf("{")));
          log(`✓ ${item.label} 上传成功  id=${j.id}  size=${j.size}  ${((Date.now() - t0) / 1000).toFixed(0)}s${useProxy ? "（走代理）" : "（直连）"}`);
          log(`   digest=${j.digest || "-"}`);
          out[item.label] = j;
          done = true;
        } else {
          log(`✗ ${item.label} 第 ${attempt} 次 HTTP=${code}  ${((Date.now() - t0) / 1000).toFixed(0)}s  响应=${res.slice(0, 200).replace(/\s+/g, " ")}`);
        }
      } catch (e) {
        log(`✗ ${item.label} 第 ${attempt} 次异常: ${String(e.message).slice(0, 160)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      const buf = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(buf), 0, 0, 3000);
    }
    if (!done) log(`!! ${item.label} 三次都没传上去`);
  }
  fs.writeFileSync("D:/Codex Harness Desktop/.e2e-artifacts/gh-assets.json", JSON.stringify(out, null, 2), "utf8");
  log("=== 全部结束 ===");
})();
