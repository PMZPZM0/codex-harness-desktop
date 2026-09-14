const { execFileSync } = require("child_process");
const fs = require("fs");
const G = "C:/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe";
const PROXY = "http://127.0.0.1:7897";
const REPO = "PMZPZM0/codex-harness-desktop";

const url = execFileSync(G, ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
const tok = (url.match(/https:\/\/[^:]+:([^@]+)@/) || [])[1] || "";
if (!tok) { console.log("!! 取不到 token"); process.exit(1); }

function api(path, opts) {
  const args = ["-s", "-x", PROXY, "--max-time", "90", "-H", "Authorization: Bearer " + tok, "-H", "Accept: application/vnd.github+json"];
  if (opts && opts.method) args.push("-X", opts.method);
  if (opts && opts.body) { args.push("-H", "Content-Type: application/json", "-d", opts.body); }
  args.push("https://api.github.com/repos/" + REPO + path);
  let lastErr = null;
  for (let i = 1; i <= 4; i++) {
    try {
      return execFileSync("curl.exe", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120000 }).trim();
    } catch (e) {
      lastErr = e;
      const buf = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(buf), 0, 0, 1200 * i);
      if (i === 4) throw e;
    }
  }
  throw lastErr;
}
module.exports = { api, tok, REPO, PROXY, fs, execFileSync };

if (require.main === module) {
  const runId = process.argv[2] || "34854770308";
  console.log("=== jobs ===");
  const jobs = JSON.parse(api(`/actions/runs/${runId}/jobs`));
  for (const job of jobs.jobs || []) {
    const s = job.started_at ? new Date(job.started_at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-";
    const e = job.completed_at ? new Date(job.completed_at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-";
    console.log("  " + job.name + "  →  " + job.status + " / " + (job.conclusion || "-") + "  (" + s + " → " + e + ")");
    const bad = (job.steps || []).filter((st) => st.conclusion && st.conclusion !== "success" && st.conclusion !== "skipped");
    if (bad.length) console.log("     非成功步骤: " + bad.map((st) => st.name + "=" + st.conclusion).join(", "));
  }
  console.log("\n=== artifacts ===");
  const arts = JSON.parse(api(`/actions/runs/${runId}/artifacts`));
  for (const a of arts.artifacts || []) {
    console.log("  " + a.name + " | id=" + a.id + " | " + ((a.size_in_bytes || 0) / 1048576).toFixed(0) + "MB | expired=" + a.expired + " | " + new Date(a.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }));
  }
}
