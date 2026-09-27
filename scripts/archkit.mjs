#!/usr/bin/env node
/**
 * archkit CLI —— 架构图引擎（方法论逆向自 archify，净室重实现，不复制上游代码）。
 *
 * 用法：
 *   node scripts/archkit.mjs validate <input.json>          只校验
 *   node scripts/archkit.mjs render   <input.json> [-o out] 渲染自包含 HTML
 *   node scripts/archkit.mjs deliver  <input.json> [-o out] 渲染 + 确定性回执（sha256）
 *   node scripts/archkit.mjs demo     [-o out]              渲染本仓库自己的架构图（素材即证据）
 *   node scripts/archkit.mjs doctor                        环境自检
 *
 * 三层证据分离（与上游同源的理念，⛔ 不许把一层说成三层）：
 *   deliver = 确定性回执（输入/输出 sha256 + 计数）；visual-check = 真浏览器截图取证（人/脚本跑）；
 *   视觉评审 = 人眼。回执只能证明"渲染了什么"，不能证明"看起来对"。
 */
import fs from "node:fs";
import { readFileSync, writeFileSync, statSync, existsSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { archkitNormalizeDiagram, archkitDelta } from "../src/lib/archkit-model.mjs";
import { archkitRender } from "../src/lib/archkit-render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** visual-check 的 electron 截图+比对助手（写到临时目录再 spawn；基线以 dataURL 注入渲染进程比像素）。 */
const VISUAL_HELPER_CJS = `/* archkit visual-check 助手（临时生成） */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const [html, shotPng, baseline, reportJson] = process.argv.slice(2);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  await win.loadFile(html);
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  const png = img.toPNG();
  fs.writeFileSync(shotPng, png);
  const report = { width: img.getSize().width, height: img.getSize().height };
  if (baseline && fs.existsSync(baseline)) {
    const b64 = fs.readFileSync(baseline).toString("base64");
    const result = await win.webContents.executeJavaScript(
      "(async () => {" +
      "const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });" +
      "const shot = await load('data:image/png;base64," + png.toString("base64") + "');" +
      "const base = await load('data:image/png;base64," + b64 + "');" +
      "if (shot.width !== base.width || shot.height !== base.height) return { sizeMismatch: true, baseWidth: base.width, baseHeight: base.height };" +
      "const c1 = document.createElement('canvas'); c1.width = shot.width; c1.height = shot.height;" +
      "const x1 = c1.getContext('2d'); x1.drawImage(shot, 0, 0);" +
      "const c2 = document.createElement('canvas'); c2.width = base.width; c2.height = base.height;" +
      "const x2 = c2.getContext('2d'); x2.drawImage(base, 0, 0, base.width, base.height);" +
      "const a = x1.getImageData(0, 0, shot.width, shot.height).data;" +
      "const b = x2.getImageData(0, 0, shot.width, shot.height).data;" +
      "let diff = 0; const total = a.length / 4;" +
      "for (let i = 0; i < a.length; i += 4) { if (Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]) > 36) diff++; }" +
      "return { diffPixels: diff, total, ratio: diff / total };" +
      "})()"
    );
    Object.assign(report, result);
  }
  fs.writeFileSync(reportJson, JSON.stringify(report));
  app.exit(0);
});
`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const outIdx = argv.indexOf("-o");
const outPath = outIdx >= 0 ? argv[outIdx + 1] : null;
const arg = argv[1] && !argv[1].startsWith("-") ? argv[1] : null;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** demo 素材：本仓库自己的架构（节点证据锚到真实文件——这正是这套引擎的使用方式）。 */
function demoInput() {
  return {
    type: "architecture",
    title: "Codex Harness Desktop · 架构全景",
    nodes: [
      { id: "main", kind: "entry", label: "main.ts 主进程入口", evidence: ["electron/main.ts"] },
      { id: "codex", kind: "module", label: "codex-server 引擎宿主", evidence: ["electron/codex-server.ts"] },
      { id: "engine", kind: "external", label: "@openai/codex app-server", evidence: ["package.json"] },
      { id: "preload", kind: "module", label: "preload IPC 桥（生成）", evidence: ["electron/preload.ts", "electron/ipc-channels.manifest.json"] },
      { id: "ui", kind: "module", label: "AppView 渲染层", evidence: ["src/features/app-view"] },
      { id: "bag", kind: "store", label: "app-state bag 单一状态源", evidence: ["src/features/app-state/parts/bag-types.ts"] },
      { id: "skills", kind: "module", label: "skill-pack 技能落盘", evidence: ["electron/skill-pack.ts"] },
      { id: "skilldir", kind: "store", label: "skills 目录（引擎发现）", evidence: [".codex/skills"] },
      { id: "guards", kind: "infra", label: "预检守卫 scripts/guards", evidence: ["scripts/guards"] },
    ],
    edges: [
      { from: "main", to: "codex", label: "spawn" },
      { from: "codex", to: "engine", label: "stdio JSON-RPC" },
      { from: "main", to: "preload", label: "加载" },
      { from: "preload", to: "ui", label: "window.codex" },
      { from: "ui", to: "bag", label: "读写", style: "dashed" },
      { from: "main", to: "skills", label: "注册" },
      { from: "skills", to: "skilldir", label: "落盘" },
      { from: "guards", to: "ui", label: "断言", style: "dashed" },
      { from: "guards", to: "codex", label: "断言", style: "dashed" },
    ],
  };
}

function load(inputPath) {
  const raw = readFileSync(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  const norm = archkitNormalizeDiagram(parsed);
  if (!norm.ok) {
    console.error("✗ 校验失败：");
    for (const p of norm.problems) console.error(`  [${p.level}] ${p.message}`);
    process.exit(1);
  }
  return { raw, parsed, norm };
}

function write(out, html, receipt) {
  const dest = out || "archkit-out.html";
  writeFileSync(dest, html);
  console.log(`✓ 已写出 ${dest}（${(statSync(dest).size / 1024).toFixed(1)} KB）`);
  if (receipt) {
    const rPath = dest + ".receipt.json";
    writeFileSync(rPath, JSON.stringify(receipt, null, 2) + "\n");
    console.log(`✓ 确定性回执 ${rPath}`);
    console.log(`  输入 sha256 = ${receipt.input.sha256}`);
    console.log(`  输出 sha256 = ${receipt.output.sha256}`);
  }
  return dest;
}

if (cmd === "validate" && arg) {
  const { norm } = load(arg);
  console.log(`✓ 合法：${norm.diagram.nodes.length} 卡 / ${norm.diagram.edges.length} 线 / ${norm.diagram.messages.length} 消息`);
  for (const p of norm.problems) console.log(`  [${p.level}] ${p.message}`);
} else if (cmd === "render" && arg) {
  const { norm } = load(arg);
  write(outPath, archkitRender(norm.diagram));
} else if (cmd === "deliver" && arg) {
  const { raw, norm } = load(arg);
  const html = archkitRender(norm.diagram);
  const dest = write(outPath, html, {
    tool: "archkit", version: 1, generatedAt: new Date().toISOString(),
    input: { path: path.resolve(arg), sha256: sha256(raw), bytes: Buffer.byteLength(raw) },
    output: { path: path.resolve(outPath || "archkit-out.html"), sha256: sha256(html), bytes: Buffer.byteLength(html) },
    counts: { nodes: norm.diagram.nodes.length, edges: norm.diagram.edges.length, messages: norm.diagram.messages.length, evidence: norm.diagram.nodes.reduce((a, n) => a + n.evidence.length, 0) },
    problems: norm.problems,
  });
  console.log(`  ⛔ 回执只证明"渲染了什么"，不证明"看起来对"——视觉取证请另行截图（三层证据分离）`);
} else if (cmd === "demo") {
  const input = JSON.stringify(demoInput(), null, 2);
  const norm = archkitNormalizeDiagram(demoInput());
  if (!norm.ok) { console.error("demo 输入竟然不合法：", norm.problems); process.exit(1); }
  const dest = write(outPath, archkitRender(norm.diagram));
  console.log(`  素材：本仓库架构 ${norm.diagram.nodes.length} 卡 / ${norm.diagram.edges.length} 线（证据锚到真实文件）`);
} else if (cmd === "delta") {
  // delta old.json new.json [-o out.html]：两份同型图对比 → 新图渲染 + Δ 摘要面板
  const oldArg = argv[1];
  const newArg = argv[2] && !argv[2].startsWith("-") ? argv[2] : null;
  if (!oldArg || !newArg) { console.error("用法：archkit delta <old.json> <new.json> [-o out.html]"); process.exit(1); }
  const a = archkitNormalizeDiagram(JSON.parse(readFileSync(oldArg, "utf8")));
  const b = archkitNormalizeDiagram(JSON.parse(readFileSync(newArg, "utf8")));
  if (!a.ok) { console.error("✗ 旧图不合法：", a.problems); process.exit(1); }
  if (!b.ok) { console.error("✗ 新图不合法：", b.problems); process.exit(1); }
  const delta = archkitDelta(a.diagram, b.diagram);
  const html = archkitRender(b.diagram, { delta });
  const dest = outPath || "archkit-delta.html";
  writeFileSync(dest, html);
  console.log(`✓ delta 已写出 ${dest}`);
  console.log(`  节点：＋${delta.added.length} / −${delta.removed.length} / ~${delta.changed.length}${delta.changed.length ? "（" + delta.changed.join("、") + "）" : ""}`);
  console.log(`  连线：＋${delta.addedEdges.length} / −${delta.removedEdges.length}`);
  if (delta.addedMessages.length || delta.removedMessages.length) console.log(`  消息：＋${delta.addedMessages.length} / −${delta.removedMessages.length}`);
} else if (cmd === "visual-check") {
  // 视觉回归门禁：截图 → 与基线 PNG 逐像素比对（阈值 0.5%）。--update 重建基线。
  // ⛔ 基线按机器生成（字体渲染有平台差），跨机器比较没有意义。
  const target = argv[1];
  const baseline = outPath || "archkit-visual-baseline.png";
  const update = argv.includes("--update");
  if (!target) { console.error("用法：archkit visual-check <out.html|in.json> <baseline.png> [--update]"); process.exit(1); }
  let htmlPath = target;
  if (target.endsWith(".json")) {
    const { norm } = load(target);
    htmlPath = baseline.replace(/\.png$/, ".html");
    writeFileSync(htmlPath, archkitRender(norm.diagram));
  }
  const os = await import("node:os");
  const { spawn } = await import("node:child_process");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-visual-"));
  const helper = path.join(tmp, "shot.cjs");
  const shotPng = path.join(tmp, "shot.png");
  const reportJson = path.join(tmp, "report.json");
  fs.writeFileSync(helper, VISUAL_HELPER_CJS);
  const dist = path.join(ROOT, "node_modules", "electron", "dist");
  const electronBin = process.platform === "darwin" ? path.join(dist, "Electron.app", "Contents", "MacOS", "Electron")
    : process.platform === "win32" ? path.join(dist, "electron.exe") : path.join(dist, "electron");
  const child = spawn(electronBin, [helper, path.resolve(htmlPath), shotPng, fs.existsSync(baseline) ? path.resolve(baseline) : "", reportJson], {
    stdio: "ignore",
    timeout: 120_000,
    // ⛔ 宿主常带 ELECTRON_RUN_AS_NODE=1 / NODE_OPTIONS —— 不清掉，electron.exe 会退化成纯 Node，
    // require("electron") 直接 MODULE_NOT_FOUND（实测：报错里的 Node 版本是 electron 内嵌的 v24）。
    env: (() => { const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; return env; })(),
  });
  await new Promise((resolve) => child.on("exit", resolve));
  if (!fs.existsSync(reportJson)) { console.error("✗ 截图失败（electron 未产出报告）"); process.exit(1); }
  const report = JSON.parse(fs.readFileSync(reportJson, "utf8"));
  if (update || !fs.existsSync(baseline)) {
    fs.copyFileSync(shotPng, baseline);
    console.log(`✓ 基线已建立：${baseline}（${report.width}x${report.height}）—— 下次跑同一产物即为回归门禁`);
  } else {
    const ratio = Number(report.ratio ?? 1);
    const pass = ratio <= 0.005;
    console.log(`${pass ? "✓" : "✗"} 像素比对：${report.diffPixels}/${report.total} 不同（${(ratio * 100).toFixed(3)}%），阈值 0.5%`);
    if (!pass) { console.error("  超阈值 ⇒ 视觉回归门禁拦截（确认改动是预期的就 --update 重建基线）"); process.exitCode = 1; }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
} else if (cmd === "doctor") {
  console.log(`node ${process.version}（要求 >=18）: ${Number(process.versions.node.split(".")[0]) >= 18 ? "✓" : "✗"}`);
  console.log("纯函数模块: ✓（validate/render 不触文件系统之外的东西）");
  console.log("技能落点: 引擎原生发现 <cwd>/.codex/skills/，全局另见 $CODEX_HOME/skills/");
  console.log("图型: architecture / workflow / sequence / dataflow / lifecycle（5 型齐）");
} else {
  console.log("用法见文件头注释。子命令：validate / render / deliver / demo / delta / visual-check / doctor");
  process.exit(cmd ? 1 : 0);
}
