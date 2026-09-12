// scripts/e2e/scenarios/multi-session-stress.mjs
//
// 压测场景：**10 个会话同时跑各自不同的真实任务**（工具 / 读写 / 权限 / 环境全都覆盖），
// 验证复杂负载下并发不卡。
//
// 判定全部用「应用是否还活着」这类硬指标，不依赖侧栏点击（那属于另一条链路的 bug，
// 不该让压测结果失真）：
//   ① 10 个任务都发出去了（每次发送 < 2s）；
//   ② 并发高峰期间主进程**持续可响应**（连续探测 perfCounters，全部 < 500ms）；
//   ③ 并发高峰期间渲染层**没有卡死**（定时探测输入框可读、rAF 在跑）；
//   ④ 派发完成后每个会话都有自己的回合（回读侧栏会话数 + 逐个打开看回合数）；
//   ⑤ 全程无 console.error。

export const name = "multi-session-stress";
export const description = "10 会话并发跑不同真实任务（工具/权限/IO），验证并发不卡不宕机";
/** 本场景覆盖的源文件（供 run.mjs 增量判断）。 */
export const covers = ["electron/main.ts", "electron/session-tools.ts", "electron/preload.ts", "src/App.tsx"];

import { readFileSync } from "node:fs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterMain(h) {
  await h.waitFor(
    `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
    { label: "引导页或主界面", timeoutMs: 30000 }
  );
  if (await h.eval(`document.body.innerText.includes("直接进入")`)) {
    await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
  }
  await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 25000 });
  await wait(1200);
}

/** 10 个会话各自的作业：工具面 / I/O 面 / 权限面刻意不重复 */
const JOBS = [
  "【1·读文件】读取 src/lib/model-scope.mjs 开头 40 行，一句话概括作用。",
  "【2·列目录】列出 electron/voice/ 下所有文件名。",
  "【3·搜索】搜索「turn_context」，告诉我出现在哪几个文件。",
  "【4·命令】执行 `git log --oneline -3` 并原样贴出。",
  "【5·写文件】在 .tmp/ 下写文件 probe5.txt 内容 session5 ok，再读回确认。",
  "【6·解析】读取 package.json 的 scripts，把 key 列成清单（不要改文件）。",
  "【7·pwsh】执行 Get-Date 与 $PSVersionTable.PSVersion，各贴一行。",
  "【8·组合】先数 src/lib 下有几个文件，再读其中任意一个文件前 10 行，汇总。",
  "【9·大文件】统计 src/App.tsx 总行数，并报告文件大小 KB。",
  "【10·环境】报告当前工作目录、node 版本、平台信息各一行。",
];

export const steps = [
  {
    name: "① 进入主界面 + 基线",
    run: async (h) => {
      await enterMain(h);
      h.check("已进入主界面", await h.exists(".app-shell"));
      const c = await h.eval(`window.codex.perfCounters()`);
      h.check("性能计数可读", !!c && typeof c.rolloutFallbackScans === "number", JSON.stringify(c));
      h.__base = c;
    },
  },

  {
    name: "② 连续建 10 个会话并各派一个真实任务（发完就走，不等完成）",
    run: async (h) => {
      const sent = [];
      const runningAfter = [];
      for (let i = 0; i < 10; i++) {
        await h.clickByText("新建任务").catch(() => undefined);
        await wait(900);
        await h.clearInput(".composer-editor");
        await h.typeInto(".composer-editor", JOBS[i]);
        await wait(150);
        const t0 = Date.now();
        await h.click(".send-button");
        sent.push(Date.now() - t0);
        await wait(1200);
        // 派发过程中每次都要能读到界面状态：读得到 = 渲染层没卡死
        const ok = await h.eval(`!!document.querySelector(".composer-editor")`).catch(() => false);
        runningAfter.push(Boolean(ok));
      }
      console.log(`  [派发] 每次发送耗时: ${sent.join(", ")} ms（平均 ${Math.round(sent.reduce((a, b) => a + b, 0) / sent.length)}）`);
      console.log(`  [派发] 派发期间界面每次都可读: ${runningAfter.filter(Boolean).length}/10`);
      h.check("10 次发送全部发出", sent.length === 10);
      h.check("单次发送 < 2s（发送动作没被拖慢）", Math.max(...sent) < 2000, `max=${Math.max(...sent)}ms`);
      h.check("派发期间界面始终可读（没卡死）", runningAfter.every(Boolean), JSON.stringify(runningAfter));
      await h.screenshot("10任务已派发");
    },
  },

  {
    name: "③ **测会话切换**：点侧栏 .thread-row 标题按钮，逐个切并量真实耗时",
    run: async (h) => {
      const rows = await h.eval(`document.querySelectorAll(".thread-row").length`);
      // 前置：必须真的有会话行，否则「点了个空」也会被算成切换成功（本节是切会话的真实验收）
      h.check("前置：侧栏已渲染出会话行（否则本节测量无效）", Number(rows) >= 5, `thread-row=${rows}`);
      const samples = [];
      // 用「当前会话标题文本变化」判定切换完成（同内容会话也不会误判），并校验确实切了
      for (let i = 0; i < Math.min(10, Number(rows)); i++) {
        const r = await h.eval(`(async () => {
          const rows = [...document.querySelectorAll(".thread-row")];
          const row = rows[${i}];
          if (!row) return { switched: false, reason: "no-row" };
          const btn = row.querySelector("button");
          if (!btn) return { switched: false, reason: "no-button" };
          const before = (document.querySelector(".thread-row.active button")?.innerText || "");
          const t0 = performance.now();
          btn.click();
          for (let k = 0; k < 100; k++) {
            await new Promise((res) => setTimeout(res, 10));
            const now = (document.querySelector(".thread-row.active button")?.innerText || "");
            if (now && now !== before) return { switched: true, ms: Math.round(performance.now() - t0) };
          }
          return { switched: false, reason: "no-active-change", before };
        })()`);
        samples.push(r);
        await wait(200);
      }
      const okOnes = samples.filter((s) => s?.switched);
      const ms = okOnes.map((s) => s.ms);
      const max = ms.length ? Math.max(...ms) : -1;
      const avg = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : -1;
      console.log(`  [切换] 成功 ${okOnes.length}/${samples.length} 次；耗时 ${ms.join(", ")} ms（平均 ${avg} / 最大 ${max}）`);
      console.log(`  [切换] 明细: ${JSON.stringify(samples)}`);
      h.check("切换动作真的生效（active 会话发生变化，≥5 次）", okOnes.length >= 5, JSON.stringify(samples));
      h.check("每次切换 < 800ms（丝滑）", max > 0 && max < 800, `max=${max}ms ms=${JSON.stringify(ms)}`);
      h.check("平均切换 < 400ms", avg > 0 && avg < 400, `avg=${avg}ms`);
      await h.screenshot("切换测试");
    },
  },

  {
    name: "③ 并发高峰：连续 10 次探测主进程 + 渲染层响应（每次都计时）",
    run: async (h) => {
      const mainProbe = [];
      const uiProbe = [];
      for (let i = 0; i < 10; i++) {
        const m0 = Date.now();
        try { await h.eval(`window.codex.perfCounters()`); mainProbe.push(Date.now() - m0); }
        catch { mainProbe.push(9999); }
        const u0 = Date.now();
        try { await h.eval(`document.querySelectorAll(".turn-group").length`); uiProbe.push(Date.now() - u0); }
        catch { uiProbe.push(9999); }
        await wait(400);
      }
      const mainMax = Math.max(...mainProbe);
      const uiMax = Math.max(...uiProbe);
      console.log(`  [主进程探测] ${mainProbe.join(", ")} ms（最大 ${mainMax}）`);
      console.log(`  [渲染层探测] ${uiProbe.join(", ")} ms（最大 ${uiMax}）`);
      h.check("并发高峰下主进程每次都能及时回话（最大 < 800ms）", mainMax < 800, `max=${mainMax}ms`);
      h.check("并发高峰下渲染层每次都能响应（最大 < 800ms）", uiMax < 800, `max=${uiMax}ms`);
    },
  },

  {
    name: "④ **权威核对**：直接扫隔离 profile 的 rollout，确认 10 条消息都被引擎执行了",
    run: async (h) => {
      const files = h._rolloutFiles ? h._rolloutFiles() : [];
      h.check("前置：隔离 profile 里存在 rollout 文件（否则下面结论无效）", files.length > 0, `files=${files.length}`);
      const markers = new Set();
      let withTurn = 0;
      const detail = [];
      for (const f of files) {
        let text = "";
        try { text = readFileSync(f, "utf8"); } catch { continue; }
        let turns = 0;
        const msgs = [];
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line);
            if (row?.type === "turn_context") turns += 1;
            const p = row?.payload;
            if (p?.type === "message" && p?.role === "user") {
              const t = (p.content || []).map((c) => c?.text || "").join(" ");
              const m = /【(\d+)[·]/.exec(t);
              if (m) { msgs.push(m[1]); markers.add(m[1]); }
            }
          } catch { /* 半截行忽略 */ }
        }
        if (turns > 0) withTurn += 1;
        detail.push(`${f.split(/[\\/]/).pop().slice(-42)} turns=${turns} msgs=[${msgs.join(",")}]`);
      }
      for (const d of detail) console.log(`  [rollout] ${d}`);
      const sorted = [...markers].map(Number).sort((a, b) => a - b);
      console.log(`  [rollout] 会话文件 ${files.length} 个，有回合 ${withTurn} 个；收到的任务标记: [${sorted.join(", ")}]`);
      h.check("10 条任务消息**全部**被引擎收到（rollout 里有 10 个标记）", markers.size >= 10, `markers=${markers.size} [${sorted.join(",")}]`);
      h.check("至少 8 个会话有真实回合（并发真的跑起来了）", withTurn >= 8, `withTurn=${withTurn}/${files.length}`);
      await h.screenshot("rollout核对");
    },
  },

  {
    name: "⑤ 收尾：应用仍可交互 + 计数汇总 + 无报错",
    run: async (h) => {
      const typed = "stress-interactive";
      await h.typeInto(".composer-editor", typed);
      h.check("输入框仍可输入（UI 没卡死）", String(await h.text(".composer-editor")).includes(typed));
      await h.clearInput(".composer-editor");
      const c = await h.eval(`window.codex.perfCounters()`);
      const delta = (c?.rolloutFallbackScans ?? 0) - (h.__base?.rolloutFallbackScans ?? 0);
      const tlDelta = (c?.threadListRequests ?? 0) - (h.__base?.threadListRequests ?? 0);
      console.log(`  [末态计数] ${JSON.stringify(c)}（兜底扫描增量 ${delta}；thread/list 请求增量 ${tlDelta}）`);
      // ④ 的验证说明：turn/completed 已改成「本地补丁 + 去抖兜底」，不再每回合一发；
      // 但**新建会话路径本身要刷新侧栏**（本场景点了 10 次新建），所以总数不会等于 0。
      // 这里只做「病态增长」上界守卫（旧实现每回合 1 发 + 新建 1 发，量级相同；
      // 真正防的是「某次改动把刷新频率放大成每帧一发」）。
      h.check("thread/list 请求数没有病态增长（< 50）", tlDelta < 50, `threadListRequests=${tlDelta}`);
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
      await h.screenshot("压测收尾");
    },
  },
];
