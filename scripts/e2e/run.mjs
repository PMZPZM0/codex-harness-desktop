// scripts/e2e/run.mjs —— E2E 场景运行器
//
// 用法（2026-09-12 定稿：**验收只跑受本次改动影响的场景**，不重复跑已验收过的）：
//   npm run e2e                  # 只跑「covers 命中本次改动 且 尚未按当前内容验收过」的场景
//   npm run e2e -- --all         # 跑全部场景（发版前的整体回归才用）
//   npm run e2e -- --force       # 强制重跑受影响场景（忽略「已验收」记录；反证后重验用）
//   npm run e2e -- smoke         # 只跑指定场景（可给多个：smoke model-scope），永远跑
//   npm run e2e -- --list        # 列出全部场景与各自的 covers
//   npm run e2e -- smoke --keep  # 跑完不关闭应用（留给你手动接着看）
//
// 增量原理：场景可导出 `covers: string[]`（它负责的源文件/目录前缀）。本运行器把
// 「场景文件自身 + covers 命中的文件」的**内容哈希**记进 .e2e-state.json；默认运行时
// 只有哈希变了的场景才会跑，已验收且内容未变 → 跳过（不再空跑）。
// 没有任何场景覆盖的改动会**明确告警**，避免「跳过一切 = 假绿」。

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ElectronHarness } from "./lib/harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const SCENARIO_DIR = join(__dirname, "scenarios");
const STATE_FILE = join(ROOT, ".e2e-state.json");
/** 参与哈希的源码根（只看这些，避免把 node_modules / 构建产物算进来） */
const SOURCE_ROOTS = ["src", "electron", "scripts/e2e", "index.html", "package.json", "vite.config.ts"];

// 前置守卫：E2E 跑的是「已构建产物」，没构建就先别启动（否则测的是旧包，白测）
const missing = [
  ["dist/index.html", "npm run build:vite"],
  ["dist-electron/main.js", "npm run build:electron"],
].filter(([p]) => !existsSync(join(ROOT, p)));
if (missing.length) {
  console.error("\x1b[31mE2E 前置检查失败：构建产物缺失\x1b[0m");
  for (const [p, cmd] of missing) console.error(`  - 缺 ${p} → 先跑 \`${cmd}\``);
  console.error("\n或直接跑 \x1b[1mnpm run check\x1b[0m（会连带构建 + 预检）");
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

async function loadScenarios() {
  const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".mjs"));
  const out = {};
  for (const f of files) {
    const full = join(SCENARIO_DIR, f);
    const mod = await import(pathToFileURL(full).href);
    out[mod.name || f.replace(/\.mjs$/, "")] = { ...mod, __file: full };
  }
  return out;
}

const scenarios = await loadScenarios();

if (flags.has("--list")) {
  console.log("可用场景：");
  for (const [k, v] of Object.entries(scenarios)) {
    console.log(`  ${k.padEnd(18)} ${v.description || ""}`);
    const covers = Array.isArray(v.covers) ? v.covers : [];
    console.log(`  ${"".padEnd(18)} \x1b[90mcovers: ${covers.length ? covers.join(", ") : "(未声明 → 只随场景文件变更跑)"}\x1b[0m`);
  }
  process.exit(0);
}

/** 收集所有参与哈希的源文件 */
function listSourceFiles() {
  const out = [];
  const walk = (abs) => {
    let st;
    try { st = statSync(abs); } catch { return; }
    if (st.isFile()) { out.push(abs); return; }
    if (!st.isDirectory()) return;
    let entries = [];
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(join(abs, e.name));
    }
  };
  for (const rel of SOURCE_ROOTS) walk(join(ROOT, rel));
  return out.map((abs) => ({ abs, rel: relative(ROOT, abs).replace(/\\/g, "/") }));
}
const allFiles = listSourceFiles();

function hashFiles(files) {
  const h = createHash("sha1");
  for (const f of files) {
    try { h.update(f.rel).update("\0").update(readFileSync(f.abs)); } catch { /* 读不到就跳过 */ }
  }
  return h.digest("hex");
}

/** 某场景的输入哈希 = 场景文件自身 + covers 命中的源文件（目录前缀也算） */
function scenarioInputs(scenario) {
  const covers = (Array.isArray(scenario.covers) ? scenario.covers : []).map((c) => c.replace(/\\/g, "/"));
  const relSelf = relative(ROOT, scenario.__file).replace(/\\/g, "/");
  const files = allFiles.filter((f) => {
    if (f.rel === relSelf) return true;
    return covers.some((c) => (c.endsWith("/") ? f.rel.startsWith(c) : f.rel === c || f.rel.startsWith(c + "/")));
  });
  if (!files.some((f) => f.rel === relSelf)) files.push({ abs: scenario.__file, rel: relSelf });
  return files;
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function writeState(state) {
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8"); } catch { /* 状态写不进去不影响验收本身 */ }
}

// ── 场景选择 ─────────────────────────────────────────────────────────────
let names;
const state = readState();
const inputsByScenario = new Map();

if (positional.length) {
  names = positional;                          // 显式点名：永远跑
} else if (flags.has("--all")) {
  names = Object.keys(scenarios);              // 全量回归
} else {
  const force = flags.has("--force");
  const changed = [];
  const accepted = [];
  const coveredRels = new Set();
  for (const [name, sc] of Object.entries(scenarios)) {
    const files = scenarioInputs(sc);
    const hash = hashFiles(files);
    inputsByScenario.set(name, { files, hash });
    for (const f of files) coveredRels.add(f.rel);
    const prev = state[name];
    if (force || !prev || prev.hash !== hash) changed.push(name);
    else accepted.push(name);
  }
  names = changed;
  if (accepted.length) console.log(`\x1b[90m(已按当前内容验收过、跳过：${accepted.join(", ")})\x1b[0m`);
  // 「无人覆盖的改动」告警：默认不静默放过，否则「跳过一切」会被误读成绿
  const uncovered = allFiles.filter((f) => !coveredRels.has(f.rel) && !f.rel.startsWith("scripts/e2e/scenarios/"));
  if (uncovered.length) {
    const seen = state.__uncovered || {};
    const fresh = uncovered.filter((f) => seen[f.rel] !== hashFiles([f]));
    if (fresh.length) {
      console.log(`\x1b[33m⚠ 以下改动没有 e2e 场景覆盖（不会自动验证，请人工确认或补场景）：\x1b[0m`);
      for (const f of fresh.slice(0, 15)) console.log(`    ${f.rel}`);
      if (fresh.length > 15) console.log(`    … 共 ${fresh.length} 个`);
      const next = { ...seen };
      for (const f of uncovered) next[f.rel] = hashFiles([f]);
      writeState({ ...readState(), __uncovered: next });
    }
  }
}
const unknown = names.filter((n) => !scenarios[n]);
if (unknown.length) {
  console.error(`未知场景「${unknown.join(", ")}」。可用：${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}
if (!names.length) {
  console.log("\x1b[32m✓ 没有受本次改动影响的场景需要跑（全部已按当前内容验收过）\x1b[0m");
  console.log("\x1b[90m发版前整体回归：npm run e2e -- --all；强制重跑：npm run e2e -- --force\x1b[0m");
  process.exit(0);
}
console.log(`\x1b[90m(本次要跑：${names.join(", ")})\x1b[0m`);

async function runScenario(name) {
  const scenario = scenarios[name];
  console.log(`\n\x1b[1m▶ E2E 场景：${name}\x1b[0m  ${scenario.description || ""}\n`);

  const h = new ElectronHarness({
    root: ROOT,
    artifactsDir: join(ROOT, ".e2e-artifacts"),
    // 多场景共用一个截图目录：文件名带场景前缀，避免互相覆盖
    namePrefix: `${name}-`,
    // 场景可自带 harness 选项（如 seedProfile 预播种钩子）
    ...(scenario.harnessOpts || {}),
  });
  const t0 = Date.now();
  const results = [];

  try {
    await h.launch();
    console.log("\x1b[90m(应用已启动，CDP 已连接)\x1b[0m\n");

    for (const step of scenario.steps) {
      const st = Date.now();
      console.log(`\x1b[36m── ${step.name}\x1b[0m`);
      try {
        await step.run(h);
        results.push({ name: step.name, ok: true, ms: Date.now() - st });
      } catch (e) {
        results.push({ name: step.name, ok: false, ms: Date.now() - st, error: e.message });
        console.log(`  \x1b[31m✗ 步骤异常：${e.message}\x1b[0m`);
        try {
          const p = await h.screenshot(`失败-${step.name}`);
          console.log(`  \x1b[90m失败截图：${p}\x1b[0m`);
        } catch {}
      }
    }
  } catch (e) {
    console.error(`\x1b[31m启动阶段失败：${e.message}\x1b[0m`);
    results.push({ name: "(启动)", ok: false, ms: Date.now() - t0, error: e.message });
  } finally {
    if (flags.has("--keep")) {
      console.log("\n\x1b[33m--keep 已指定：应用保持运行，端口等下次输出\x1b[0m");
    } else {
      await h.close();
    }
  }

  const checkSummary = h.summary(`E2E「${name}」断言`);
  const badSteps = results.filter((r) => !r.ok);
  const ok = checkSummary.ok && badSteps.length === 0;

  console.log("\n\x1b[1m步骤耗时：\x1b[0m");
  for (const r of results) {
    console.log(`  ${r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${r.name}  \x1b[90m${r.ms}ms\x1b[0m${r.error ? `  ${r.error}` : ""}`);
  }
  console.log(`\n本场景耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，截图目录：.e2e-artifacts/shots\n`);

  // 只有真正通过才记账：下次同内容直接跳过；失败不记账 → 下轮还会跑
  if (ok) {
    const inputs = inputsByScenario.get(name) ?? { files: scenarioInputs(scenario), hash: "" };
    const next = { ...readState() };
    next[name] = {
      hash: inputs.hash || hashFiles(inputs.files),
      acceptedAt: new Date().toISOString(),
      files: inputs.files.map((f) => f.rel),
    };
    writeState(next);
  }
  return ok;
}

const tAll = Date.now();
const outcomes = [];
for (const name of names) outcomes.push({ name, ok: await runScenario(name) });

if (names.length > 1) {
  console.log("\x1b[1m各场景结果：\x1b[0m");
  for (const o of outcomes) console.log(`  ${o.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${o.name}`);
  console.log(`\n\x1b[1m全部场景总耗时 ${((Date.now() - tAll) / 1000).toFixed(1)}s\x1b[0m\n`);
}

process.exit(outcomes.every((o) => o.ok) ? 0 : 1);
