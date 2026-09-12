// scripts/accept.mjs —— **唯一验收入口**（CDP 直连）
//
// 用户 09-12 三次定稿，全部体现在这个文件里：
//   ① 「把旧的验收流程删干净，每次都写最新的 cpd 脚本验收，不然你老是卡住」
//      → 旧的 `scripts/e2e/scenarios/*` + 增量哈希 runner 已删除（preflight【7】硬守卫不许回来）。
//   ② 「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」
//      → 跑在**跨轮次复用的持久 profile** 上，首次把真实 profile 的会话历史搬进来，之后一轮轮叠加。
//   ③ 「用旧会话测试，不要一直新建会话」
//      → 所有验收项都只在**已有会话**上操作；不新建会话、不发新消息。
//
// 用法：
//   node scripts/accept.mjs                  # 跑全部验收项
//   node scripts/accept.mjs --list            # 列出验收项
//   node scripts/accept.mjs --only reveal     # 只跑 id 含 reveal 的项
//   node scripts/accept.mjs --keep            # 跑完不关应用
//   node scripts/accept.mjs --profile main    # 换一个持久 profile 名
//   CODEX_HARNESS_RESEED=1 node scripts/accept.mjs   # 强制重灌真实配置/历史
//
// 被测 profile：`.e2e-profile/<name>/`（已 gitignore，含真实对话内容，勿入库）

import { existsSync, readFileSync, statSync } from "node:fs";
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

// 最长的一条 assistant 正文字数（「进来就在实时进度」的判据用它，与具体回合序号无关）
const BODY_LEN = `(() => {
  let max = 0;
  for (const b of document.querySelectorAll(".assistant-message .message-body")) {
    const n = (b.innerText || "").length;
    if (n > max) max = n;
  }
  return max;
})()`;

/** 点侧栏第 i 个会话行（只用旧会话） */
const clickRow = (h, i) => h.eval(`(() => {
  const list = [...document.querySelectorAll(".thread-row")];
  const btn = list[${i}] && list[${i}].querySelector("button");
  if (!btn) return false;
  btn.click();
  return true;
})()`);

// ─────────────────────────────────────────────────────────────────────────────
// 本轮验收项（**每次改动只改这一段**；不再对应的旧项直接删掉，别攒着）
// ─────────────────────────────────────────────────────────────────────────────
const CHECKS = [
  {
    id: "boot-history",
    name: "① 启动即带真实历史（不是空白 profile，也不新建会话）",
    run: async (h) => {
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      console.log(`  [历史] 侧栏会话行 ${rows} 个；启动时 profile 已有 ${h.rolloutsBefore} 个 rollout`);
      h.check("已进入主界面", await h.exists(".app-shell"));
      h.check("侧栏有真实历史会话（测试形态 = 用户实际形态）", rows >= 1, `thread-row=${rows}`);
      h.check("profile 是跨轮次复用的持久目录", h.persistent === true, h.userDataDir);
      h.check("profile 里确有历史 rollout（历史搬进来了）", h.rolloutsBefore > 0, `rolloutsBefore=${h.rolloutsBefore}`);
    },
  },

  {
    id: "switch-speed",
    name: "② 旧会话切进切出：首次打开 vs 再次切回",
    run: async (h) => {
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 有可切的旧会话（≥3）", rows >= 3, `thread-row=${rows}`);
      const measure = (i) => h.eval(`(async () => {
        const list = [...document.querySelectorAll(".thread-row")];
        const btn = list[${i}] && list[${i}].querySelector("button");
        if (!btn) return { switched: false };
        const before = (document.querySelector(".thread-row.active button")?.innerText || "");
        const t0 = performance.now();
        btn.click();
        for (let k = 0; k < 300; k++) {
          await new Promise((res) => setTimeout(res, 10));
          const now = (document.querySelector(".thread-row.active button")?.innerText || "");
          if (now && now !== before) return { switched: true, ms: Math.round(performance.now() - t0) };
        }
        return { switched: false, reason: "no-active-change" };
      })()`);
      const n = Math.min(5, rows);
      const firstOpen = [];
      for (let i = 0; i < n; i++) { firstOpen.push(await measure(i)); await wait(250); }
      const revisit = [];
      for (let i = 0; i < n; i++) { revisit.push(await measure(i)); await wait(250); }
      const ms = (arr) => arr.filter((s) => s?.switched).map((s) => s.ms);
      const fMs = ms(firstOpen);
      const rMs = ms(revisit);
      const firstMax = fMs.length ? Math.max(...fMs) : -1;
      const rMed = rMs.length ? rMs.slice().sort((a, b) => a - b)[Math.floor(rMs.length / 2)] : -1;
      console.log(`  [切换] 首次打开 ${JSON.stringify(fMs)}（最大 ${firstMax}ms）`);
      console.log(`  [切换] 再次切回 ${JSON.stringify(rMs)}（中位数 ${rMed}ms）`);
      h.check("两轮切换都真的生效（各 ≥ 3 次）", fMs.length >= 3 && rMs.length >= 3, `first=${fMs.length} revisit=${rMs.length}`);
      h.check("首次打开 < 1500ms（含引擎 resume + 首屏渲染）", firstMax > 0 && firstMax < 1500, `firstMax=${firstMax}ms`);
      h.check("再次切回中位数 < 200ms（反复切会话的体感，走本地缓存）", rMed > 0 && rMed < 200, `median=${rMed}ms ${JSON.stringify(rMs)}`);
      h.check("再次切回最多 1 个慢样本（系统性缓存失效会每个都慢）", rMs.filter((v) => v >= 200).length <= 1, JSON.stringify(rMs));
      await h.screenshot("旧会话切换");
    },
  },

  {
    id: "reveal-on-switch",
    name: "③ **旧会话**来回切：进来就在实时进度，绝不复播正文",
    run: async (h) => {
      // 用户定稿：「实时进度在哪里，进来就在哪里」——切进任何旧会话，正文必须**立刻**是
      // 当前长度，不许出现「从短到长重新出字」。
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 侧栏有旧会话可切（≥3 行）", rows >= 3, `thread-row=${rows}`);

      const seen = [];
      for (let i = 0; i < Math.min(4, rows); i++) {
        await clickRow(h, i);
        await wait(1400);
        seen.push(Number(await h.eval(BODY_LEN)) || 0);
      }
      console.log(`  [复播] 各旧会话正文长度：${JSON.stringify(seen)}`);
      const stock = Math.max(...seen);
      h.check("[前置] 存在正文足够长的旧会话（≥80 字，复播才看得出来）", stock >= 80, `lens=${JSON.stringify(seen)}`);
      const target = seen.indexOf(stock);
      const other = target === 0 ? 1 : 0;

      await clickRow(h, other);
      await wait(1200);
      await h.eval(`(window.__adbg = [])`);
      await clickRow(h, target);
      const samples = [];
      for (let i = 0; i < 40; i++) {
        const len = Number(await h.eval(BODY_LEN)) || 0;
        if (len > 0) samples.push(len);
        if (samples.length >= 12) break;
        await wait(50);
      }
      const first = samples.length ? samples[0] : -1;
      const min = samples.length ? Math.min(...samples) : -1;
      console.log(`  [复播] 重进旧会话 #${target}（离开时 ${stock} 字）→ 采样 ${JSON.stringify(samples.slice(0, 12))}`);
      const reveals = await h.eval(`(() => (window.__adbg || []).filter((e) => e && e.r === "reveal"))()`);
      const maxAnimated = reveals.length ? Math.max(...reveals.map((e) => Number(e.animated) || 0)) : 0;
      const byKey = new Map();
      for (const e of reveals) {
        const k = String(e.key ?? "?");
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(Number(e.from) || 0);
      }
      const regressions = [];
      for (const [k, seq] of byKey) {
        let peak = -1;
        for (let i = 0; i < seq.length; i++) {
          if (seq[i] < peak - 1) regressions.push({ key: k, at: i, from: seq[i], prevPeak: peak });
          if (seq[i] > peak) peak = seq[i];
        }
      }
      if (reveals.length) console.log(`  [复播] 揭示 ${reveals.length} 条，最大 animated=${maxAnimated}，前 4 条: ${JSON.stringify(reveals.slice(0, 4))}`);

      // 核心（用户原话「进来就在哪里」）
      h.check("重进旧会话首帧正文 ≥ 离开时的 80%（进来就在实时进度）", first >= Math.floor(stock * 0.8), `first=${first} stock=${stock}`);
      h.check("重进后正文没有变短过（最低采样 ≥ 离开时的 80%）", min >= Math.floor(stock * 0.8), `min=${min} stock=${stock}`);
      // 存量复播的权威信号 = 一次「补播≈存量大小」的揭示（修复前实测 animated=334）
      h.check("重进后没有「一次性补播存量」的揭示（最大 animated < 100）", maxAnimated < 100, `maxAnimated=${maxAnimated} stock=${stock}`);
      h.check("各消息揭示位置不回退（同一 key 的 from 单调不降）", regressions.length === 0, JSON.stringify(regressions.slice(0, 3)));
      await h.screenshot("旧会话来回切");
    },
  },

  {
    id: "greet-once",
    name: "④ 身份引导：存量用户不得再被引导（扫已有 rollout，不新建会话）",
    run: async (h) => {
      const files = h._rolloutFiles();
      h.check("[前置] profile 里有历史 rollout", files.length > 0, `files=${files.length}`);
      // 权威判据见 lib/rollout-inspect.mjs（只看 role === "developer" 的消息；
      // 对整份文本 includes("初次见面") 会撞上项目 AGENTS.md 的文档文本 → 恒定假红）
      const injected = files.filter((f) => {
        try { return greetingInjected(readFileSync(f, "utf8")); } catch { return false; }
      });
      console.log(`  [引导] 历史 rollout ${files.length} 个；带初次见面引导的 ${injected.length} 个`);
      const p = join(h.userDataDir, "personalization.json");
      let config = null;
      try { config = JSON.parse(readFileSync(p, "utf8")); } catch { /* 没落盘 */ }
      h.check("档案 greeted=true（此后新会话不再引导）", config?.greeted === true, JSON.stringify(config));
      // 修复生效后产生的 rollout（mtime ≥ 本次启动）不许再带引导
      const fresh = files.filter((f) => { try { return statSync(f).mtimeMs >= h.launchedAt; } catch { return false; } });
      const freshInjected = fresh.filter((f) => {
        try { return greetingInjected(readFileSync(f, "utf8")); } catch { return false; }
      });
      h.check("本轮产生的会话没有注入初次见面引导", freshInjected.length === 0, `fresh=${fresh.length} injected=${freshInjected.length}`);
    },
  },

  {
    id: "concurrency",
    name: "⑤ 旧会话之间来回切：主进程全程不被拖住",
    run: async (h) => {
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 有可切的旧会话（≥3）", rows >= 3, `thread-row=${rows}`);
      const probes = [];
      for (let i = 0; i < 8; i++) {
        const t0 = Date.now();
        try { await h.eval(`window.codex.perfCounters()`); probes.push(Date.now() - t0); }
        catch { probes.push(9999); }
        await clickRow(h, i % Math.min(3, rows));
        await wait(400);
      }
      const max = Math.max(...probes);
      const c = await h.eval(`window.codex.perfCounters()`);
      console.log(`  [并发] 切旧会话期间主进程探测 ${probes.join(", ")} ms（最大 ${max}）`);
      console.log(`  [计数] ${JSON.stringify(c)}`);
      h.check("切旧会话期间主进程每次都及时回话（最大 < 800ms）", max < 800, `max=${max}ms`);
      h.check("渲染层仍可响应（perfCounters 可读）", !!c && typeof c.resumeCount === "number", JSON.stringify(c));
    },
  },

  {
    id: "clean",
    name: "⑥ 渲染层无 console.error",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 脚手架（通常不用动）
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
  for (const c of CHECKS) console.log(`  ${c.id.padEnd(18)} ${c.name}`);
  process.exit(0);
}

const only = value("only", "");
const selected = only ? CHECKS.filter((c) => c.id.includes(only)) : CHECKS;
if (!selected.length) {
  console.error(`没有匹配 --only ${only} 的验收项；可用：${CHECKS.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

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
  // 跨轮次复用的持久 profile（首次会把真实配置 + 真实会话历史搬进来）
  profileName: value("profile", "main"),
});

const t0 = Date.now();
const results = [];
try {
  await h.launch();
  console.log("\x1b[90m(应用已启动，CDP 已连接)\x1b[0m\n");
  await enterMain(h);
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
  console.log(`  ${r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${r.id.padEnd(18)} \x1b[90m${r.ms}ms\x1b[0m${r.error ? `  ${r.error}` : ""}`);
}
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s；截图：.e2e-artifacts/shots；被测 profile：${h.userDataDir}\n`);

process.exit(summary.ok && results.every((r) => r.ok) ? 0 : 1);
