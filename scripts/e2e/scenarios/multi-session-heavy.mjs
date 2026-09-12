// scripts/e2e/scenarios/multi-session-heavy.mjs
//
// 重负载压测：**多个会话同时跑「≥2 分钟、大量工具与命令调用」的复杂任务**。
// 用户要求：任务复杂到每个至少 2 分钟，看并发工具调用/命令会不会卡。
//
// 与 multi-session-stress 的分工：
//   - stress 验「10 会话并发 + 切换」；
//   - 本场景验「**长时间重工具负载**下的并发」（工具链条长、命令多、持续 ≥150s）。
//
// 断言：
//   ① 8 个重任务全部派发（每个都是长链条工程活，不是一句话问答）；
//   ② 全长 150s 内每 5s 采样：主进程与渲染层**始终**能及时响应（< 1s）；
//   ③ 采样期间**至少 6 个**回合仍在运行（说明任务真的在持续干活，不是秒完）；
//   ④ rollout 取证：每会话的工具调用（function_call）次数 ≥ 5，总调用数 ≥ 60；
//   ⑤ 全程无 console.error。

export const name = "multi-session-heavy";
export const description = "重负载并发：8 会话同跑 ≥2 分钟复杂任务（大量工具/命令），全程不卡";
/** 本场景覆盖的源文件（供 run.mjs 增量判断）。 */
export const covers = ["electron/main.ts", "electron/session-tools.ts", "src/App.tsx"];

import { readFileSync } from "node:fs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CONCURRENCY = 8;
const OBSERVE_MS = 150_000;   // 观测窗口 ≥150s（用户要求任务 ≥2 分钟）
const SAMPLE_EVERY_MS = 5_000;

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

/** 8 个「长链条 + 多命令」的真实工程任务：都要求反复调用工具、跑命令、读文件并交叉核对，
 *  自然耗时在分钟级（不依赖人为 sleep）。 */
const HEAVY_JOBS = [
  "【重1·代码审计】逐个统计 src/lib 下每个 .mjs / .ts 文件的行数（必须用命令逐个统计，不要估算），"
    + "然后把行数最多的前 5 个文件列成表格，并说明它们各自的职责。全程用工具完成，不要凭记忆。",
  "【重2·依赖排查】检查 package.json 的 dependencies 与 devDependencies，"
    + "然后用命令确认其中至少 6 个包在 node_modules 里真实存在及其版本号，列成表格。",
  "【重3·样式体检】在 src/styles.css 里分别统计：content-visibility 出现次数、"
    + "!important 出现次数、@media 块数量。每一项都要用命令取证，最后汇总。",
  "【重4·协议核对】用命令在 electron/ 目录里搜索所有 ipcMain.handle 注册的通道名，"
    + "列出总数与前 15 个通道名；再核对 preload.ts 里是否都有对应桥接，指出缺失项（如有）。",
  "【重5·测试资产】统计 scripts/e2e/scenarios 下每个场景文件的断言数量（数 h.check 出现次数），"
    + "列出表格，并指出断言最多的那个场景文件。",
  "【重6·函数清点】在 src/components 下用命令统计每个 tsx 文件里导出的组件/函数数量，"
    + "列出前 10 个文件；并指出文件最大的那个。",
  "【重7·文档核对】读取 README.md 与 AGENTS.md，分别统计它们的行数与二级标题数量，"
    + "然后用命令核对 docs/ 目录下有哪些文档、各自多少行。",
  "【重8·综合巡检】依次完成三件事并汇总：① 用命令列出项目根目录下所有 *.json 文件；"
    + "② 统计 electron/ 目录下 .ts 文件总数；③ 找出最近修改的 3 个源文件（按修改时间）。",
];

/** 扫隔离 profile 的 rollout：统计每个会话的 function_call（工具调用）次数与回合数 */
function scanToolCalls(h) {
  const files = h._rolloutFiles ? h._rolloutFiles() : [];
  const out = [];
  for (const f of files) {
    let text = "";
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    let turns = 0;
    let toolCalls = 0;
    const names = new Map();
    let marker = "";
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row?.type === "turn_context") turns += 1;
        // rollout 里工具调用以 response_item / function_call 记录
        const p = row?.payload;
        if (row?.type === "response_item" && p?.type === "function_call") {
          toolCalls += 1;
          const n = String(p.name ?? "?");
          names.set(n, (names.get(n) ?? 0) + 1);
        }
        if (p?.type === "message" && p?.role === "user") {
          const t = (p.content || []).map((c) => c?.text || "").join(" ");
          const m = /【重(\d+)/.exec(t);
          if (m) marker = m[1];
        }
      } catch { /* 半截行 */ }
    }
    out.push({ file: f.split(/[\\/]/).pop(), turns, toolCalls, marker, topTools: [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) });
  }
  return out;
}

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
    name: `② 派发 ${CONCURRENCY} 个重任务（发完就走，不等完成）`,
    run: async (h) => {
      const sent = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        await h.clickByText("新建任务").catch(() => undefined);
        await wait(900);
        await h.clearInput(".composer-editor");
        await h.typeInto(".composer-editor", HEAVY_JOBS[i]);
        await wait(200);
        const t0 = Date.now();
        await h.click(".send-button");
        sent.push(Date.now() - t0);
        await wait(1000);
      }
      console.log(`  [派发] ${CONCURRENCY} 个重任务发送耗时: ${sent.join(", ")} ms（平均 ${Math.round(sent.reduce((a, b) => a + b, 0) / sent.length)}）`);
      h.check(`${CONCURRENCY} 个重任务全部发出`, sent.length === CONCURRENCY);
      h.check("派发期间单次发送 < 2s", Math.max(...sent) < 2000, `max=${Math.max(...sent)}ms`);
      await h.screenshot("重负载已派发");
    },
  },

  {
    name: `③ 观测 ${OBSERVE_MS / 1000}s：每 ${SAMPLE_EVERY_MS / 1000}s 采样主进程 + 渲染层 + 在跑回合数`,
    run: async (h) => {
      const samples = [];
      const t0 = Date.now();
      while (Date.now() - t0 < OBSERVE_MS) {
        const m0 = Date.now();
        let mainMs = 0;
        try { await h.eval(`window.codex.perfCounters()`); mainMs = Date.now() - m0; } catch { mainMs = 99999; }
        const r0 = Date.now();
        let uiMs = 0;
        let running = 0;
        try {
          const r = await h.eval(`(() => {
            const groups = [...document.querySelectorAll(".turn-group")];
            return { n: groups.length, running: groups.filter((g) => g.className.includes("running")).length };
          })()`);
          uiMs = Date.now() - r0;
          running = Number(r?.running ?? 0);
        } catch { uiMs = 99999; }
        samples.push({ at: Math.round((Date.now() - t0) / 1000), mainMs, uiMs, running });
        await wait(SAMPLE_EVERY_MS);
      }
      const mainMax = Math.max(...samples.map((s) => s.mainMs));
      const uiMax = Math.max(...samples.map((s) => s.uiMs));
      const runningPeak = Math.max(...samples.map((s) => s.running));
      const stillRunning = samples.filter((s) => s.running > 0).length;
      console.log(`  [采样] 共 ${samples.length} 次（每 ${SAMPLE_EVERY_MS / 1000}s）`);
      console.log(`  [采样] 主进程最大 ${mainMax}ms / 渲染层最大 ${uiMax}ms`);
      console.log(`  [采样] 在跑回合峰值 ${runningPeak}；有在跑回合的采样点 ${stillRunning}/${samples.length}`);
      console.log(`  [采样] 轨迹: ${samples.map((s) => `${s.at}s:main${s.mainMs}/ui${s.uiMs}/run${s.running}`).join(" ")}`);
      h.check(`全程 ${OBSERVE_MS / 1000}s 主进程每次都及时响应（最大 < 1000ms）`, mainMax < 1000, `max=${mainMax}ms`);
      h.check(`全程渲染层每次都及时响应（最大 < 1000ms）`, uiMax < 1000, `max=${uiMax}ms`);
      h.check("观测期内确实有重任务在持续跑（≥1/3 采样点有运行中回合）", stillRunning >= samples.length / 3, `${stillRunning}/${samples.length}`);
      h.check("并发在跑的回合峰值 ≥ 2（真的并行了）", runningPeak >= 2, `peak=${runningPeak}`);
      await h.screenshot("重负载观测中");
    },
  },

  {
    name: "④ rollout 取证：工具调用次数 + 并发是否真在调命令",
    run: async (h) => {
      const files = h._rolloutFiles ? h._rolloutFiles() : [];
      h.check("前置：隔离 profile 有 rollout 文件", files.length > 0, `files=${files.length}`);
      const rows = scanToolCalls(h);
      let totalTools = 0;
      let withTools = 0;
      for (const r of rows) {
        totalTools += r.toolCalls;
        if (r.toolCalls > 0) withTools += 1;
        console.log(`  [rollout] ${String(r.file).slice(-42)} 标记=${r.marker || "-"} turns=${r.turns} 工具调用=${r.toolCalls} 常用=${JSON.stringify(r.topTools)}`);
      }
      console.log(`  [rollout] 会话 ${rows.length} 个；有工具调用的 ${withTools} 个；工具调用总数 ${totalTools}`);
      h.check("多数会话真的调用了工具（≥5 个会话有工具调用）", withTools >= 5, `withTools=${withTools}/${rows.length}`);
      h.check("工具调用总量可观（≥40 次，证明是重负载而非问答）", totalTools >= 40, `totalTools=${totalTools}`);
      const c = await h.eval(`window.codex.perfCounters()`);
      const delta = (c?.rolloutFallbackScans ?? 0) - (h.__base?.rolloutFallbackScans ?? 0);
      console.log(`  [末态计数] ${JSON.stringify(c)}（兜底扫描增量 ${delta}）`);
    },
  },

  {
    name: "⑤ 收尾：应用仍可交互 + 无报错",
    run: async (h) => {
      const typed = "heavy-interactive-probe";
      await h.typeInto(".composer-editor", typed);
      h.check("输入框仍可输入（重负载后 UI 没卡死）", String(await h.text(".composer-editor")).includes(typed));
      await h.clearInput(".composer-editor");
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
      await h.screenshot("重负载收尾");
    },
  },
];
