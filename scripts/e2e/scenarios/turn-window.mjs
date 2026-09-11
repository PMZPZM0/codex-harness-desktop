// scripts/e2e/scenarios/turn-window.mjs
//
// 回归场景：长会话窗口化 + 增量加载（ZCode 式会话切换，09-12）。
//
// 改动前：「显示更早」一键全展开（最多 20 页 × 200 回合一次性挂载）且无滚动联动。
// 改造后（App.tsx）：
//   ① 首屏只挂最近 TURN_WINDOW(40) 回合，切换成本与历史长度无关（openThread 重置窗口）；
//   ② loadEarlierTurns 增量化：内存还有未渲染的 → 只扩窗口（零网络）；内存耗尽且有游标
//      → thread/turns/list 拉**一页**拼到最前，按 scrollHeight 增量补偿 scrollTop；
//   ③ 时间线滚动近顶（<480px）自动续载；刻度尺跳转先把窗口扩到覆盖目标回合。
//
// 种子方式：向隔离 profile 的 codex-home/sessions 写一个**合成 rollout**（260 回合，
// 形状对齐引擎真实落盘格式——task_started/turn_context/item_completed/response_item/
// task_complete，ordinal 连续）。引擎 thread/resume + turns/list 分页能正常解析。
// 模型/供应商取自本机真实 config.toml（同 model-scope：种子必须贴真实配置，resume 才能
// 过 provider 校验）；探针回合不发起任何模型调用，零额度消耗。

export const name = "turn-window";
export const description = "长会话窗口化：首屏 40 回合秒开，按钮/滚动近顶增量加载，切回重置";

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { realUserDataDir } from "../lib/harness.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TURN_SEED = 260; // > 200：覆盖「本地扩窗」与「游标拉页」两条路径
const TURN_WINDOW = 40; // 与 App.tsx 的 TURN_WINDOW 一致（渲染首屏窗口）

// 种出来的会话 id（seeder 运行时填上，供步骤里注入 last-thread）
let seededThreadId = "";

/** 读真实 config.toml 的当前生效 provider/model（合成会话引用它，resume 才过 provider 校验） */
function realProviderModel() {
  let provider = "e2e-probe";
  let model = "e2e-probe-model";
  try {
    const cfg = readFileSync(join(realUserDataDir(), "codex-home", "config.toml"), "utf8");
    provider = cfg.match(/^model_provider\s*=\s*"(.+)"\s*$/m)?.[1]
      || cfg.match(/\[model_providers\.([^\]]+)\]/)?.[1]
      || provider;
    model = cfg.match(/^model\s*=\s*"(.+)"\s*$/m)?.[1] || model;
  } catch { /* 无真实配置时用占位（turns/list 不调模型，不受影响） */ }
  return { provider, model };
}

/** 合成一个 N 回合的 rollout 写进隔离 profile。形状对齐引擎真实落盘格式（探针已实证：
 *  task_started → turn_context → item_completed(User/Agent) + response_item(message) →
 *  task_complete，ordinal 全局连续）。返回 threadId。 */
export function seedLongThreadRollout(userDataDir, turnCount = TURN_SEED) {
  const { provider, model } = realProviderModel();
  const cwd = process.cwd();
  const sessionId = randomUUID();
  const day = new Date().toISOString().slice(0, 10); // UTC 日期目录（引擎递归扫描）
  const dir = join(userDataDir, "codex-home", "sessions", ...day.split("-"));
  mkdirSync(dir, { recursive: true });

  let ordinal = 0;
  const lines = [];
  const push = (type, payload) => {
    lines.push(JSON.stringify({ timestamp: new Date(Date.now() - (turnCount * 60 - ordinal) * 1000).toISOString(), ordinal, type, payload }));
    ordinal += 1;
  };

  push("session_meta", {
    session_id: sessionId,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd,
    originator: "codex_harness_desktop",
    cli_version: "0.153.4",
    source: "vscode",
    model_provider: provider,
    base_instructions: { text: "", provenance: { type: "model", model } },
    // 必须声明分页模式：缺了它引擎不走 turns/list 分页索引，回合 items 重建不出来
    history_mode: "paginated",
    context_window: { window_id: randomUUID() },
  });

  const startedBase = Math.floor(Date.now() / 1000) - turnCount * 60;
  for (let i = 1; i <= turnCount; i++) {
    const turnId = randomUUID();
    const userItem = randomUUID();
    const agentItem = randomUUID();
    const msgUser = `msg_${randomUUID()}`;
    const msgAgent = `msg_${randomUUID()}`;
    const userText = `e2e user turn ${i}`;
    const agentText = `e2e agent turn ${i}`;
    const startedAt = startedBase + i * 60;
    push("event_msg", { type: "task_started", turn_id: turnId, started_at: startedAt, model_context_window: 1000000, collaboration_mode_kind: "default" });
    push("turn_context", {
      turn_id: turnId, root_turn_id: turnId, cwd, workspace_roots: [cwd],
      current_date: new Date().toISOString().slice(0, 10), timezone: "Asia/Shanghai",
      approval_policy: "never", approvals_reviewer: "user",
      sandbox_policy: { type: "danger-full-access" }, permission_profile: { type: "disabled" },
      model, personality: "none", collaboration_mode: { mode: "default" },
    });
    push("event_msg", { type: "item_completed", thread_id: sessionId, turn_id: turnId, item: { type: "UserMessage", id: userItem, content: [{ type: "text", text: userText }] } });
    push("response_item", { type: "message", id: msgUser, role: "user", content: [{ type: "input_text", text: userText }] });
    push("event_msg", { type: "item_completed", thread_id: sessionId, turn_id: turnId, item: { type: "AgentMessage", id: agentItem, content: [{ type: "Text", text: agentText }] } });
    push("response_item", { type: "message", id: msgAgent, role: "assistant", content: [{ type: "output_text", text: agentText }], internal_chat_message_metadata_passthrough: { turn_id: turnId, create_time: startedAt, content_item_kinds: ["unknown"] } });
    push("event_msg", { type: "task_complete", turn_id: turnId, last_agent_message: agentText, started_at: startedAt, completed_at: startedAt + 1, duration_ms: 1000 });
  }

  // canonical 文件名格式必须是 rollout-<ISO日期T时间>-<sessionUUID>.jsonl（带 T，
  // 缺了会报 "does not have a canonical rollout filename"）
  const file = join(dir, `rollout-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${sessionId}.jsonl`);
  writeFileSync(file, lines.join("\n") + "\n");
  seededThreadId = sessionId;
  return sessionId;
}

export const harnessOpts = {
  seedProfile(userDataDir) {
    seedLongThreadRollout(userDataDir, TURN_SEED);
  },
};

const mountedTurnCount = () => `document.querySelectorAll('[id^="turn-"]').length`;

export const steps = [
  {
    name: "① 主界面就绪后注入 last-thread 并重载（启动恢复打开合成会话）",
    run: async (h) => {
      h.check("前置：种子已生成 260 回合 rollout", seededThreadId.length > 0, seededThreadId.slice(0, 8));
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "主界面挂载", timeoutMs: 30000 });
      await wait(800);
      await h.eval(`localStorage.setItem("last-thread", ${JSON.stringify(seededThreadId)})`);
      await h.reload();
      // 等会话真正打开：首屏窗口化的回合元素出现（ TURN_WINDOW 个）
      await h.waitFor(`(() => { const n = ${mountedTurnCount()}; return n >= 20 && n <= ${TURN_WINDOW}; })()`, {
        label: `合成会话打开且首屏 ≤ ${TURN_WINDOW} 回合`,
        timeoutMs: 30000,
      });
      h.check("① 会话已打开且首屏挂载 ≤ 40 回合", true);
      await h.screenshot("01-首屏窗口化");
    },
  },

  {
    name: "② 首屏窗口化：恰好 40 回合 + 最新内容可见 + 「显示更早」按钮存在",
    run: async (h) => {
      await wait(1200); // 等 openThread 的 resume 与 settled 流程完全落定
      const n = Number(await h.eval(mountedTurnCount()));
      h.check("首屏挂载 = 40 回合", n === TURN_WINDOW, `mounted=${n}`);
      h.check("「显示更早」按钮存在", await h.exists(".load-earlier-turns"));
      const latestVisible = await h.eval(`document.body.innerText.includes("e2e agent turn ${TURN_SEED}")`);
      h.check(`最新回合内容可见（turn ${TURN_SEED}）`, latestVisible === true);
      const oldHidden = await h.eval(`document.body.innerText.includes("e2e agent turn 60")`);
      h.check("更早的回合未渲染（turn 60 不可见）", oldHidden === false, `oldVisible=${oldHidden}`);
    },
  },

  {
    name: "③ 点按钮第一次：内存扩窗（100 → 全渲染，不产生拉取）",
    run: async (h) => {
      // resumeThreadLight 拉了一页（引擎单页上限 100）→ 内存 100 回合，hidden=60。
      // 第一次点击走「本地扩窗」分支：mounted 应恰为 100。若走了拉取分支会是 200 → 断言红。
      await h.eval(`document.querySelector(".load-earlier-turns")?.click()`);
      await h.waitFor(`${mountedTurnCount()} === 100`, { label: "扩窗到 100 回合", timeoutMs: 15000 });
      h.check("本地扩窗：100 回合全部渲染（未拉取）", true);
      await h.screenshot("03-本地扩窗100");
    },
  },

  {
    name: "④ 点按钮第二次：游标拉一页（turns 200，窗口跟随）",
    run: async (h) => {
      await h.eval(`document.querySelector(".load-earlier-turns")?.click()`);
      await h.waitFor(`${mountedTurnCount()} === 200`, { label: "拉页后 200 回合", timeoutMs: 20000 });
      h.check("游标拉页：200 回合渲染", true);
    },
  },

  {
    name: "⑤ 点按钮第三次：拉完剩余页 + 按钮消失",
    run: async (h) => {
      await h.eval(`document.querySelector(".load-earlier-turns")?.click()`);
      await h.waitFor(`${mountedTurnCount()} === ${TURN_SEED}`, { label: `全部 ${TURN_SEED} 回合`, timeoutMs: 20000 });
      await wait(400);
      h.check(`全部 ${TURN_SEED} 回合渲染`, true);
      h.check("加载完后按钮消失", !(await h.exists(".load-earlier-turns")));
      const firstVisible = await h.eval(`document.body.innerText.includes("e2e user turn 1")`);
      h.check("最早回合（turn 1）可见", firstVisible === true);
      await h.screenshot("05-全量渲染");
    },
  },

  {
    name: "⑥ 重载后窗口重置 + 滚动近顶自动续载（ZCode 式）",
    run: async (h) => {
      await h.reload();
      await h.waitFor(`(() => { const n = ${mountedTurnCount()}; return n >= 20 && n <= ${TURN_WINDOW}; })()`, {
        label: "重载后首屏回到 40 回合",
        timeoutMs: 30000,
      });
      await wait(1200);
      const afterReopen = Number(await h.eval(mountedTurnCount()));
      h.check("切回会话窗口重置为 40（切换成本恒定）", afterReopen === TURN_WINDOW, `mounted=${afterReopen}`);
      // 滚动到顶部 → onTimelineScroll 自动触发 loadEarlierTurns（本地扩窗 60 → 100）
      await h.eval(`(() => { const el = document.querySelector(".timeline"); el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); return el.scrollTop; })()`);
      await h.waitFor(`${mountedTurnCount()} === 100`, { label: "滚动近顶自动扩窗到 100", timeoutMs: 15000 });
      h.check("滚动近顶自动续载生效（无点击）", true);
      await h.screenshot("06-滚动自动续载");
    },
  },

  {
    name: "⑦ 渲染层无 console.error",
    run: async (h) => {
      h.check(
        "渲染层无 console.error",
        h.consoleLog.length === 0,
        h.consoleLog.slice(0, 3).join(" ｜ ")
      );
    },
  },
];
