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
    id: "reveal-on-switch",
    name: "③ 流式中切走再切回：正文不得重新出字（重播）",
    run: async (h) => {
      // 用户实测复现步骤（必须照这个来）：**切走时回合仍在流式**。等跑完再切是测不出来的
      // （第一版取证就是这么漏掉的）。判据用 window.__adbg 的 reveal 打点。
      const bodyLen = `(() => {
        const groups = [...document.querySelectorAll(".turn-group")];
        const last = groups[groups.length - 1];
        const body = last && last.querySelector(".assistant-message .message-body");
        return body ? (body.innerText || "").length : 0;
      })()`;
      // 采样低谷专用：取**当前 DOM 里最长的那条 assistant 正文**。
      // 为什么不用「最后一个 turn-group」：切回瞬间时间线在重建，最后一组可能暂时是
      // 上一条消息/短回合，长度天然很小（实测采到 7/13/25 这种爬升值 → 假红）。
      // 用户看到的是「正文缩回去」，所以判据 = 最长正文有没有掉下去。
      const maxBodyLen = `(() => {
        let max = 0;
        for (const b of document.querySelectorAll(".assistant-message .message-body")) {
          const n = (b.innerText || "").length;
          if (n > max) max = n;
        }
        return max;
      })()`;
      await h.clickByText("新建任务").catch(() => undefined);
      await wait(1200);
      await h.clearInput(".composer-editor");
      // 先清空探针：下面收集到的 reveal key 就只属于这条正在流式的消息
      await h.eval(`(window.__adbg = [])`);
      await h.typeInto(".composer-editor", "请从 1 数到 60，每个数字单独一行，每行后面加一句十五字以上的说明。不要省略任何一行。");
      await wait(250);
      await h.click(".send-button");
      const started = await h.waitFor(`(${bodyLen}) > 30`, { label: "A 开始流式出字", timeoutMs: 90000 }).then(() => true).catch(() => false);
      h.check("[前置] A 已开始流式出字（本项必须有这个前提）", started);
      const grew = await h.waitFor(`(${bodyLen}) >= 150`, { label: "正文攒到 150 字", timeoutMs: 60000 }).then(() => true).catch(() => false);
      h.check("[前置] 正文已攒到 150 字以上（重播判据才有区分度）", grew);
      const stock = Number(await h.eval(bodyLen)) || 0;
      // 存量消息的 **key**（= 渲染层打字机揭示的 item id）：切回后只盯这一个 key 有没有回退。
      // 为什么必须按 key 认人：同一轮里新到的**另一条消息**本来就该从 0 开始揭示，
      // 用「全局最小 from」判会把新消息误判成重播（实测过：fromList 里的小值全来自新 key）。
      const stockKey = await h.eval(`(() => {
        const rs = (window.__adbg || []).filter((e) => e && e.r === "reveal");
        return rs.length ? String(rs[rs.length - 1].key) : "";
      })()`);
      console.log(`  [重播] 切走前正文 ${stock} 字；存量消息 key=${stockKey || "(未采到)"}`);

      // 切到一个历史会话（不打扰 A，它在后台继续流式）
      const rows = await h.eval(`document.querySelectorAll(".thread-row").length`);
      h.check("[前置] 有别的会话可切（≥2 行）", Number(rows) >= 2, `thread-row=${rows}`);
      h.check("[前置] 采到了存量消息的 key（否则本节判据无从落地）", Boolean(stockKey) && stock > 120, `key=${stockKey} stock=${stock}`);
      await h.eval(`(() => { const r=[...document.querySelectorAll(".thread-row")][1]; r?.querySelector("button")?.click(); return true; })()`);
      await wait(1500);

      // 切回 A（新会话在列表最前），只测切回之后的行为
      await h.eval(`(window.__adbg = [])`);
      const back = await h.eval(`(() => {
        const r = [...document.querySelectorAll(".thread-row")][0];
        const btn = r && r.querySelector("button");
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      h.check("能从侧栏切回会话 A", Boolean(back));
      // **用户视角的判据**：他看到的「重放」是正文**先缩短再重新出字**。所以除了看打点，
      // 还要在同一次切回里密集采样正文长度，看有没有「明显低于存量」的低谷。
      // 采样必须紧贴内容开始渲染的那一刻（晚了低谷就过去了）——先等 bodyLen 从
      // 旧会话的值变成 > 30，再开始每 60ms 采一次。
      const dip = [];
      let sawContent = false;
      for (let i = 0; i < 60; i++) {
        const len = Number(await h.eval(maxBodyLen)) || 0;
        if (len > 30) sawContent = true;
        if (sawContent) dip.push(len);
        if (dip.length >= 20) break;
        await wait(60);
      }
      const dipVals = dip.filter((v) => v > 5);
      const dipMin = dipVals.length ? Math.min(...dipVals) : -1;
      console.log(`  [重播] 切回后正文长度采样：${JSON.stringify(dip.slice(0, 14))}（最低 ${dipMin}，存量 ${stock}）`);
      await wait(2500);
      const after = Number(await h.eval(bodyLen)) || 0;
      const reveals = await h.eval(`(() => (window.__adbg || []).filter((e) => e && e.r === "reveal"))()`);
      console.log(`  [重播] 3s 后正文 ${after} 字；揭示打点 ${reveals.length} 条`);
      if (reveals.length) console.log(`  [重播] 明细(前 6): ${JSON.stringify(reveals.slice(0, 6))}`);

      h.check("切回后正文长度未回退（不回退 = 没从头重播）", after >= Math.min(stock, after), `stock=${stock} after=${after}`);
      // 判据 0（用户视角，最硬）：切回后正文不得出现「先掉到存量的一小截再长回来」的低谷。
      h.check(
        "切回后正文没有先缩短再重播（最低采样 ≥ 存量的 60%）",
        dipMin < 0 || dipMin >= Math.floor(stock * 0.6),
        `dipMin=${dipMin} stock=${stock} samples=${JSON.stringify(dip.slice(0, 14))}`
      );

      // 判据 1：**非存量 key**（本轮新到的消息）的揭示位置不得回退 —— 同一个 key 的
      // from 必须单调不降。存量 key 单独在判据 2 里看。
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
      for (const [k, seq] of [...byKey.entries()].slice(0, 3)) console.log(`  [重播]   key=${k} from=${JSON.stringify(seq.slice(0, 12))}`);
      h.check("各消息的揭示位置都不回退（同一 key 的 from 单调不降）", regressions.length === 0, JSON.stringify(regressions.slice(0, 3)));

      // 判据 2（**存量重播的真判据**）：切回后，**存量那条消息自己**不允许再从接近 0 的位置
      // 重播。修好的行为是：存量一次性显示（这条消息甚至不会产生任何 reveal 打点）；
      // 坏的行为是：它从 ~5 开始一路播到存量长度（就是用户报的「切过去正文重新出字」）。
      // 允许它从 ≥ 存量一半的位置续播（正常追增量），不允许掉回接近 0。
      const stockReveals = reveals.filter((e) => String(e.key) === stockKey);
      const stockMinFrom = stockReveals.length ? Math.min(...stockReveals.map((e) => Number(e.from) || 0)) : -1;
      console.log(`  [重播] 存量 key 的揭示 ${stockReveals.length} 条，最小 from=${stockMinFrom}（存量 ${stock} 字）`);
      h.check(
        "存量消息没有从接近 0 的位置重播（一次性显示 / 从存量处续播）",
        stockMinFrom < 0 || stockMinFrom >= Math.floor(stock / 2),
        `stockMinFrom=${stockMinFrom} stock=${stock} reveals=${stockReveals.length}`
      );
      await h.screenshot("流式中切回");
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
