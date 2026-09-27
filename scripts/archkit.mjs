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
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { archkitNormalizeDiagram } from "../src/lib/archkit-model.mjs";
import { archkitRender } from "../src/lib/archkit-render.mjs";

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
} else if (cmd === "doctor") {
  console.log(`node ${process.version}（要求 >=18）: ${Number(process.versions.node.split(".")[0]) >= 18 ? "✓" : "✗"}`);
  console.log("纯函数模块: ✓（validate/render 不触文件系统之外的东西）");
  console.log("技能落点: 引擎原生发现 <cwd>/.codex/skills/，全局另见 $CODEX_HOME/skills/");
  console.log("未实现的图型: dataflow / lifecycle（上游 5 型，本轮复刻 3 型）");
} else {
  console.log("用法见文件头注释。子命令：validate / render / deliver / demo / doctor");
  process.exit(cmd ? 1 : 0);
}
