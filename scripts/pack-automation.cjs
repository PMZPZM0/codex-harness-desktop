#!/usr/bin/env node
// 把 resources/tools/npm-global（nuphus-mcp / @playwright/cli）打成 automation-tools.zip，
// 供「开发工具」页的「修复安装」重新解压恢复。
//
// ⛔ 09-16（用户「CloakBrowser 不用内置，按需下载就行」）：zip **不含 cloakbrowser**。
//    它与 npm-global 的 extraResources filter（package.json）是同一份排除清单的两处落点：
//    zip 漏了这条排除 → 用户点一次「修复安装」就把 CloakBrowser 又装回包里。
//    CloakBrowser 现在走「开发工具」页按需 npm 安装（npmmirror 源）。
//
// 用法：node scripts/pack-automation.cjs [输出目录]
// 输出：<tools>/automation-tools.zip（zip 内顶层为 npm-global/）
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const toolsRoot = process.env.TOOLS_ROOT || path.join(root, "resources", "tools");
const globalDir = path.join(toolsRoot, "npm-global");
const outZip = process.argv[2]
  ? path.resolve(process.argv[2], "automation-tools.zip")
  : path.join(toolsRoot, "automation-tools.zip");

if (!fs.existsSync(path.join(globalDir, "node_modules"))) {
  console.error("缺少 resources/tools/npm-global/node_modules，先在本机装好自动化工具再打包。");
  process.exit(1);
}

// 优先内置 7z，其次系统 7z，最后 python zipfile
const sevenCandidates = [
  path.join(toolsRoot, "sevenzip", "7z.exe"),
  "C:\\Program Files\\7-Zip\\7z.exe",
  "7z",
];
let seven = sevenCandidates.find((c) => {
  if (c.includes("\\")) return fs.existsSync(c);
  try { spawnSync(c, ["-h"], { stdio: "ignore" }); return true; } catch { return false; }
});

if (fs.existsSync(outZip)) fs.rmSync(outZip, { force: true });

// 用 python zipfile 打 zip（比 7z 稳，内置 python 必在）
const pyCandidates = [
  path.join(toolsRoot, "python", "python.exe"),
  path.join(toolsRoot, "python", "python3.exe"),
  "python",
];
const py = pyCandidates.find((c) => c.includes("\\") ? fs.existsSync(c) : true);
const pyScript = `
import zipfile, os, sys
src = r"${globalDir.replace(/\\/g, "\\\\")}"
out = r"${outZip.replace(/\\/g, "\\\\")}"
skipped = 0
total = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for cur, dirs, files in os.walk(src):
        for f in files:
            fp = os.path.join(cur, f)
            rel = os.path.relpath(fp, os.path.dirname(src))  # 顶层 npm-global/
            arc = rel.replace("\\\\", "/")
            parts = arc.split("/")
            # 排除 CloakBrowser（顶层 shim + node_modules 包体 + .bin shim）——按需下载，不随包
            if len(parts) >= 2 and parts[1].startswith("cloakbrowser"):
                skipped += 1
                continue
            if len(parts) >= 3 and parts[1] == "node_modules" and (parts[2] == "cloakbrowser" or (parts[2] == ".bin" and parts[-1].startswith("cloakbrowser"))):
                skipped += 1
                continue
            z.write(fp, arc)
            total += 1
print("done files=%d skipped_cloak=%d" % (total, skipped))
`;
const res = spawnSync(py, ["-c", pyScript], { stdio: "pipe", encoding: "utf8" });
if (res.status !== 0) {
  console.error("python 打包失败:", res.stderr || res.stdout);
  process.exit(1);
}
console.log((res.stdout || "").trim());

const size = fs.statSync(outZip).size;
console.log(`OK ${outZip}  ${(size / 1048576).toFixed(1)} MB`);
