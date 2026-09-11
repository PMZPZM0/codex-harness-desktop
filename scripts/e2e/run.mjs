// scripts/e2e/run.mjs —— E2E 场景运行器
//
// 用法：
//   npm run e2e                  # 跑**全部**场景（验收门槛，新场景自动纳入）
//   npm run e2e -- smoke         # 只跑指定场景（可给多个：smoke model-recency）
//   npm run e2e -- --list        # 列出全部场景
//   npm run e2e -- smoke --keep  # 跑完不关闭应用（留给你手动接着看）

import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ElectronHarness } from "./lib/harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const SCENARIO_DIR = join(__dirname, "scenarios");

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
    const mod = await import(pathToFileURL(join(SCENARIO_DIR, f)).href);
    out[mod.name || f.replace(/\.mjs$/, "")] = mod;
  }
  return out;
}

const scenarios = await loadScenarios();

if (flags.has("--list")) {
  console.log("可用场景：");
  for (const [k, v] of Object.entries(scenarios)) console.log(`  ${k.padEnd(14)} ${v.description || ""}`);
  process.exit(0);
}

// 默认跑全部场景：验收门槛必须覆盖所有回归场景，否则新写的场景只是摆设。
const names = positional.length ? positional : Object.keys(scenarios);
const unknown = names.filter((n) => !scenarios[n]);
if (unknown.length) {
  console.error(`未知场景「${unknown.join(", ")}」。可用：${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}

async function runScenario(name) {
  const scenario = scenarios[name];
  console.log(`\n\x1b[1m▶ E2E 场景：${name}\x1b[0m  ${scenario.description || ""}\n`);

  const h = new ElectronHarness({
    root: ROOT,
    artifactsDir: join(ROOT, ".e2e-artifacts"),
    // 多场景共用一个截图目录：文件名带场景前缀，避免互相覆盖
    namePrefix: `${name}-`,
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

  console.log("\n\x1b[1m步骤耗时：\x1b[0m");
  for (const r of results) {
    console.log(`  ${r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${r.name}  \x1b[90m${r.ms}ms\x1b[0m${r.error ? `  ${r.error}` : ""}`);
  }
  console.log(`\n本场景耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，截图目录：.e2e-artifacts/shots\n`);

  return checkSummary.ok && badSteps.length === 0;
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
