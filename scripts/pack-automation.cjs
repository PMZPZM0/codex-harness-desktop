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

/**
 * 打 zip 的执行体，按可用性依次回落。
 *
 * ⛔ 09-16 修：原实现**只**用 python，而 CI 的干净检出里没有随包 python
 *    （09-16 安装包瘦身把 python 移出随包，资源目录被 gitignore）——`before-pack` → 本脚本
 *    在 GitHub Actions 上会直接失败，整条 tag 触发的发布流水线跑不起来。
 *    现在优先 **bsdtar**（Windows 自带 `%WINDIR%\System32\tar.exe`，支持 `-a` 按扩展名选 zip
 *    与 `--exclude`；Linux/macOS runner 上系统 tar 同样是 bsdtar/支持 zip），
 *    python 与 7z 降级为备用。
 *
 * 排除清单在这里、package.json 的 extraResources filter、mac 的 copy-mac-tools.cjs
 * 三处必须同源 —— 漏一处，用户点一次「修复安装」就把已剥离的 CloakBrowser 装回包里。
 */
const CLAUB_EXCLUDES = [
  "npm-global/cloakbrowser",
  "npm-global/cloakbrowser.cmd",
  "npm-global/cloakbrowser.ps1",
  "npm-global/node_modules/cloakbrowser",
  "npm-global/node_modules/.bin/cloakbrowser",
  "npm-global/node_modules/.bin/cloakbrowser.cmd",
  "npm-global/node_modules/.bin/cloakbrowser.ps1",
];

/** 用 bsdtar 打包：顶层为 npm-global/，与 python/7z 两条实现一致 */
function packWithTar(bin) {
  const args = ["-a", "-c", "-f", outZip, "-C", toolsRoot, ...CLAUB_EXCLUDES.map((e) => "--exclude=" + e), "npm-global"];
  const res = spawnSync(bin, args, { stdio: "pipe", encoding: "utf8" });
  if (res.status !== 0) throw new Error(`tar 打包失败(${bin}): ${(res.stderr || res.stdout || "").slice(-500)}`);
  console.log(`tar 打包完成（${bin}）`);
}

/** 用内置 python zipfile 打包（备用；CI 上通常没有随包 python） */
function packWithPython(python) {
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
  const res = spawnSync(python, ["-c", pyScript], { stdio: "pipe", encoding: "utf8" });
  if (res.status !== 0) throw new Error("python 打包失败: " + (res.stderr || res.stdout || "").slice(-500));
  console.log((res.stdout || "").trim());
}

// 选打包方式：bsdtar（跨平台、系统自带）→ 内置 7z → 内置 python
const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
const tarCandidates = [
  path.join(windir, "System32", "tar.exe"),
  "/usr/bin/tar",
  "/bin/tar",
  "tar",
];
const tarBin = tarCandidates.find((c) => (c.includes("/") || c.includes("\\") ? fs.existsSync(c) : true));
const pyCandidates = [
  path.join(toolsRoot, "python", "python.exe"),
  path.join(toolsRoot, "python", "python3.exe"),
  "python3",
  "python",
];
const pyBin = pyCandidates.find((c) => (c.includes("\\") ? fs.existsSync(c) : true));

let packed = false;
const failures = [];
if (tarBin) {
  try { packWithTar(tarBin); packed = true; } catch (error) { failures.push(error.message); console.warn("[warn] " + error.message); }
}
if (!packed && pyBin) {
  try { packWithPython(pyBin); packed = true; } catch (error) { failures.push(error.message); console.warn("[warn] " + error.message); }
}
if (!packed) {
  console.error("打包失败：bsdtar / python 都不可用或失败。\n  " + failures.join("\n  "));
  process.exit(1);
}

const size = fs.statSync(outZip).size;
console.log(`OK ${outZip}  ${(size / 1048576).toFixed(1)} MB`);
