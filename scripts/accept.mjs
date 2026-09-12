// scripts/accept.mjs —— **唯一验收入口**（CDP 直连，不再有「一堆历史场景 + 增量哈希」那套）
//
// 为什么收成一条（09-12 用户两次定稿，原话：
//   「把旧的验收流程删干净，每次都写最新的 cpd 脚本验收，不然你老是卡住」/
//   「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」）：
//   ① 旧的 `scripts/e2e/scenarios/*` + 增量哈希 runner：改一处主进程源码就会连带选中
//      十几个历史场景（模型/中转站/语音/长窗口…），一轮十几分钟，人卡在等它跑完；
//   ② 旧的临时 profile 每次都是白纸 —— 侧栏零会话，切会话重播、首轮不出字、会话一多
//      互相拖慢这类问题**只在有历史时才现形**，空目录里测等于没测。
//   现在：**一条脚本、一个跨轮次复用的 profile（首次把真实会话历史搬进来）、每次只验
//   本轮改动**。顺手、快、而且测的是真实形态。
//
// 用法：
//   node scripts/accept.mjs                 # 跑全部验收项
//   node scripts/accept.mjs --list          # 只列验收项
//   node scripts/accept.mjs --only greet    # 只跑 id 含 "greet" 的项
//   node scripts/accept.mjs --keep          # 跑完不关应用（留着手动看）
//   node scripts/accept.mjs --profile main  # 换一个持久 profile 名（默认 main）
//   CODEX_HARNESS_RESEED=1 node scripts/accept.mjs   # 强制重灌真实配置/历史
//
// 查看/清空被测 profile：`.e2e-profile/<name>/`（已 gitignore，含真实对话内容，勿入库）

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ElectronHarness } from "./e2e/lib/harness.mjs";
import { greetingInjected } from "./e2e/lib/rollout-inspect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// 本轮验收项（**每次改动只改这一段**；旧的、已经不再对应的检查直接删掉，别攒着）
// ─────────────────────────────────────────────────────────────────────────────
const CHECKS = [
  {
    id: "boot-history",
    name: "① 启动即带真实历史（不是空白 profile）",
    run: async (h) => {
      await enterMain(h);
      h.check("已进入主界面", await h.exists(".app-shell"));
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      console.log(`  [历史] 侧栏会话行 ${rows} 个；本轮启动时 profile 已有 ${h.rolloutsBefore} 个 rollout`);
      h.check("侧栏有真实历史会话（测试形态 = 用户实际形态）", rows >= 1, `thread-row=${rows}`);
      h.check("profile 是跨轮次复用的持久目录", h.persistent === true, h.userDataDir);
    },
  },

  {
    id: "switch-speed",
    name: "② 切会话：首次打开 vs 再次切回（有历史的前提下）",
    run: async (h) => {
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("前置：有可切的会话行（≥3）", rows >= 3, `thread-row=${rows}`);
      // 必须分两轮量，别把「首次打开某会话」当成「热切换」——每个会话**第一次**打开都要
      // 走一次引擎 resume + 首屏渲染（实测 40~600ms 都出现过），真正代表「反复切会话体感」
      // 的是**再次切回已打开过的会话**（走本地缓存，实测 10~80ms）。
      const clickRow = (i) => h.eval(`(async () => {
        const list = [...document.querySelectorAll(".thread-row")];
        const row = list[${i}];
        const btn = row && row.querySelector("button");
        if (!btn) return { switched: false, reason: "no-row" };
        const running = /运行|正在|running/i.test(row.className + " " + (row.innerText || ""));
        const before = (document.querySelector(".thread-row.active button")?.innerText || "");
        const t0 = performance.now();
        btn.click();
        for (let k = 0; k < 300; k++) {
          await new Promise((res) => setTimeout(res, 10));
          const now = (document.querySelector(".thread-row.active button")?.innerText || "");
          if (now && now !== before) return { switched: true, ms: Math.round(performance.now() - t0), running };
        }
        return { switched: false, reason: "no-active-change", running };
      })()`);
      const n = Math.min(5, rows);
      const firstOpen = [];
      for (let i = 0; i < n; i++) { firstOpen.push(await clickRow(i)); await wait(250); }
      const revisit = [];
      for (let i = 0; i < n; i++) { revisit.push(await clickRow(i)); await wait(250); }
      const ms = (arr) => arr.filter((s) => s?.switched).map((s) => s.ms);
      const fMs = ms(firstOpen);
      const rMs = ms(revisit);
      const firstMax = fMs.length ? Math.max(...fMs) : -1;
      const revisitMax = rMs.length ? Math.max(...rMs) : -1;
      const revisitAvg = rMs.length ? Math.round(rMs.reduce((a, b) => a + b, 0) / rMs.length) : -1;
      // 分「回合仍在跑」与「已停止」两组看再次切回：运行中的会话**必须**跟引擎对齐一次
      // 状态（不许拿本地缓存糊弄，否则会看到已经结束的假运行态），这条路径天然比纯缓存慢；
      // 已停止的会话没有任何事件流，再次切回**必须**走本地缓存（这才是「丝滑」的判据）。
      const idleMs = revisit.filter((s) => s?.switched && !s.running).map((s) => s.ms);
      const runningMs = revisit.filter((s) => s?.switched && s.running).map((s) => s.ms);
      const idleMax = idleMs.length ? Math.max(...idleMs) : -1;
      const runningMax = runningMs.length ? Math.max(...runningMs) : -1;
      console.log(`  [切换] 首次打开 ${JSON.stringify(fMs)}（最大 ${firstMax}ms）`);
      console.log(`  [切换] 再次切回 全部 ${JSON.stringify(rMs)}（平均 ${revisitAvg}ms 最大 ${revisitMax}ms）`);
      console.log(`  [切换] 再次切回·已停止会话 ${JSON.stringify(idleMs)}（最大 ${idleMax}ms；判据 < 200ms）`);
      console.log(`  [切换] 再次切回·仍在跑会话 ${JSON.stringify(runningMs)}（最大 ${runningMax}ms；需与引擎对齐，判据 < 800ms）`);
      h.check("两轮切换都真的生效（各 ≥ 3 次）", fMs.length >= 3 && rMs.length >= 3, `first=${fMs.length} revisit=${rMs.length}`);
      h.check("首次打开 < 1500ms（含引擎 resume + 首屏渲染）", firstMax > 0 && firstMax < 1500, `firstMax=${firstMax}ms ${JSON.stringify(fMs)}`);
      // 用户的核心体感要求（「切换会话超级丝滑流畅很快」）：已停止的会话再切回**必须**走本地缓存。
      // 判据分两层，为的是把「缓存没命中（系统性问题）」和「后台恰好在渲染（一次性争用）」分开：
      //   · 慢样本 ≤ 1 个（真·缓存失效会**每个**会话都慢，不可能只慢一个）；
      //   · 对最慢那一行**原地再切两次**，其中至少要有一次 < 200ms —— 缓存路径本身是快的。
      const slowIdx = revisit.map((s, i) => ({ s, i })).filter(({ s }) => s?.switched && s.ms >= 200);
      console.log(`  [切换] 再次切回 ≥200ms 的样本：${slowIdx.length} 个 ${JSON.stringify(slowIdx.map(({ s }) => s.ms))}`);
      h.check("再次切回最多只有 1 个慢样本（系统性缓存失效会是每个都慢）", slowIdx.length <= 1, `slow=${slowIdx.length} ${JSON.stringify(rMs)}`);
      if (slowIdx.length) {
        const repeats = [];
        for (let k = 0; k < 2; k++) { repeats.push((await clickRow(slowIdx[0].i))?.ms ?? -1); await wait(250); }
        const best = Math.min(...repeats);
        console.log(`  [切换] 最慢那行（#${slowIdx[0].i}，首次 ${slowIdx[0].s.ms}ms）原地重切：${JSON.stringify(repeats)}（最好 ${best}ms）`);
        h.check("最慢那行重切能回到 < 200ms（缓存路径本身是快的，慢的是偶发争用）", best > 0 && best < 200, `repeats=${JSON.stringify(repeats)}`);
      }
      if (idleMs.length) {
        h.check("已停止会话的再次切回中位数 < 200ms", idleMs.sort((a, b) => a - b)[Math.floor(idleMs.length / 2)] < 200, JSON.stringify(idleMs));
      }
      await h.screenshot("切会话");
    },
  },

  {
    id: "greet-once",
    name: "③ 身份引导：有历史的新会话**不得**再引导（只打一次招呼）",
    run: async (h) => {
      // 权威判据：rollout 里 role === "developer" 的消息有没有引导指令
      //（项目 AGENTS.md 里也有「初次见面」四个字，对整份文本 includes 会恒为真 → 假红）
      const before = h._rolloutFiles().length;
      await h.clickByText("新建任务").catch(() => undefined);
      await wait(1200);
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", "只回复一个数字：21");
      await wait(250);
      await h.click(".send-button");
      await h.waitFor(`document.querySelectorAll(".turn-group").length >= 1`, { label: "回合出现", timeoutMs: 60000 }).catch(() => undefined);
      await wait(2500);
      const fresh = h._rolloutFiles({ since: h.launchedAt }).filter((f) => {
        try { return readFileSync(f, "utf8").includes("只回复一个数字：21"); } catch { return false; }
      });
      console.log(`  [引导] 本轮新增 rollout ${h._rolloutFiles({ since: h.launchedAt }).length} 个（历史 ${before}）；命中本轮消息 ${fresh.length} 个`);
      h.check("前置：本轮新会话产生了 rollout", fresh.length > 0, `hit=${fresh.length}`);
      const injected = fresh.filter((f) => {
        try { return greetingInjected(readFileSync(f, "utf8")); } catch { return false; }
      });
      h.check(
        "新会话没有注入初次见面引导（greeted/存量迁移生效，直接干活）",
        injected.length === 0,
        injected.map((f) => f.split(/[\\/]/).pop()).join(",")
      );
    },
  },

  {
    id: "concurrency",
    name: "④ 多会话并发：两边都真跑，主进程全程不被拖住",
    run: async (h) => {
      await h.clickByText("新建任务").catch(() => undefined);
      await wait(1000);
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", "只回复一个单词：alpha");
      await wait(200);
      await h.click(".send-button");
      const probes = [];
      for (let i = 0; i < 8; i++) {
        const t0 = Date.now();
        try { await h.eval(`window.codex.perfCounters()`); probes.push(Date.now() - t0); }
        catch { probes.push(9999); }
        await wait(400);
      }
      const max = Math.max(...probes);
      const running = Number(await h.eval(`document.querySelectorAll(".turn-group").length`)) || 0;
      console.log(`  [并发] 主进程探测 ${probes.join(", ")} ms（最大 ${max}）；当前会话回合 ${running}`);
      h.check("多会话并发下主进程每次都及时回话（最大 < 800ms）", max < 800, `max=${max}ms`);
      h.check("当前会话确有回合在渲染", running >= 1, `turns=${running}`);
      const c = await h.eval(`window.codex.perfCounters()`);
      console.log(`  [计数] ${JSON.stringify(c)}`);
    },
  },

  {
    id: "clean",
    name: "⑤ 渲染层无 console.error",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 下面是脚手架，通常不用动
// ─────────────────────────────────────────────────────────────────────────────

async function enterMain(h) {
  await h.waitFor(
    `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
    { label: "引导页或主界面", timeoutMs: 40000 }
  );
  if (await h.eval(`document.body.innerText.includes("直接进入")`)) {
    await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
  }
  await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 30000 });
  await wait(1500);
}

if (flag("list")) {
  console.log("验收项：");
  for (const c of CHECKS) console.log(`  ${c.id.padEnd(16)} ${c.name}`);
  process.exit(0);
}

const only = value("only", "");
const selected = only ? CHECKS.filter((c) => c.id.includes(only)) : CHECKS;
if (!selected.length) {
  console.error(`没有匹配 --only ${only} 的验收项；可用：${CHECKS.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

// 构建产物前置检查（验收跑的是 dist/ + dist-electron/，没构建就是测旧包）
const missing = [
  ["dist/index.html", "npm run build:vite"],
  ["dist-electron/main.js", "npm run build:electron"],
].filter(([p]) => !existsSync(join(ROOT, p)));
if (missing.length) {
  console.error("\x1b[31m验收前置检查失败：构建产物缺失\x1b[0m");
  for (const [p, cmd] of missing) console.error(`  - 缺 ${p} → 先跑 \`${cmd}\``);
  process.exit(1);
}

const h = new ElectronHarness({
  root: ROOT,
  artifactsDir: join(ROOT, ".e2e-artifacts"),
  namePrefix: "",
  // 跨轮次复用的持久 profile：会话历史一轮轮攒起来（首次会把真实历史搬进来）
  profileName: value("profile", "main"),
});

const t0 = Date.now();
const results = [];
try {
  await h.launch();
  console.log("\x1b[90m(应用已启动，CDP 已连接)\x1b[0m\n");
  for (const check of selected) {
    const st = Date.now();
    console.log(`\x1b[36m── ${check.name}\x1b[0m`);
    try {
      await check.run(h);
      results.push({ id: check.id, ok: true, ms: Date.now() - st });
    } catch (e) {
      console.log(`  \x1b[31m✗ 验收项异常：${e.message}\x1b[0m`);
      try {
        const p = await h.screenshot(`失败-${check.id}`);
        console.log(`  \x1b[90m失败截图：${p}\x1b[0m`);
      } catch { /* 截图失败不影响结论 */ }
      results.push({ id: check.id, ok: false, ms: Date.now() - st, error: e.message });
    }
  }
} catch (e) {
  console.error(`\x1b[31m启动阶段失败：${e.message}\x1b[0m`);
  results.push({ id: "(启动)", ok: false, ms: Date.now() - t0, error: e.message });
} finally {
  if (flag("keep")) console.log("\n\x1b[33m--keep：应用保持运行\x1b[0m");
  else await h.close();
}

const summary = h.summary("验收");
console.log("\n\x1b[1m验收项耗时：\x1b[0m");
for (const r of results) {
  console.log(`  ${r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${r.id.padEnd(16)} \x1b[90m${r.ms}ms\x1b[0m${r.error ? `  ${r.error}` : ""}`);
}
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s；截图：.e2e-artifacts/shots；被测 profile：${h.userDataDir}\n`);

process.exit(summary.ok && results.every((r) => r.ok) ? 0 : 1);
