/**
 * 预检守卫组：17-scheduled-tasks —— **定时任务与排队定时**的四条生命线。
 *
 * ⛔ 立此组的事故（2026-09-28 用户四问，逐条对应）：
 *   ① 会话里建不了定时任务 —— 模型侧**没有**任何 scheduler 工具（内置调度 MCP 只暴露
 *      agent_invoke / agent_archive_sessions）。这是**设计现状**，不是 bug，但必须钉住：
 *      一旦有人把 scheduler 通道塞进 MCP 工具面，安全闸（canDispatchFrom 一族的判定）
 *      得跟着走 —— 那是"给了工具"的语义变更。
 *   ② 排队消息定时形同虚设（用户原话「排队消息定时功能没有。agent 回复完成，排队消息就
 *      自动发出去了」）—— 回合结束的「自动启动队头」只拦手动停止（wasManualStop），
 *      **不拦未到点的定时消息** ⇒ 定时一到就被提前发出。这是本组最重要的一条。
 *   ③ 一次性任务跑完不结束序列 —— advanceNextRunAt 漏传 lastRunAt ⇒ computeOnceNextRunAt
 *      的「已跑过」判定失效，跑完还留一个过去的 nextRunAt（离线冒烟实测）。
 *   ④ 调度器必须真的被启动（boot 里 await scheduler.start()）—— 与 video-gen 的
 *      「注册函数没人调」同类：**实例建了、启动没调** ⇒ 30s tick 从不发生 ⇒ 任务永不触发。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, join, ok, fail, readFileSync, codeOnly } from "./_ctx.mjs";

export async function run() {
  console.log(C.bold("\n【196】定时任务与排队定时的生命线"));

  const settle = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "event-router", "07-turn-completed-settle.tsx"), "utf8");
  const queueSeg = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "03-seg", "02-browser-queue-settings.tsx"), "utf8");
  const sched = codeOnly(readFileSync(join(ROOT, "electron", "scheduler.ts"), "utf8"));
  const boot = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
  const mrp = readFileSync(join(ROOT, "electron", "features", "memory-rpa-ipc.ts"), "utf8");
  const dispatch = codeOnly(readFileSync(join(ROOT, "electron", "features", "dispatch-core.ts"), "utf8"));

  /* ① 回合结束自动启动队头之前，必须先看「这条是不是未到点的定时消息」 */
  {
    const startIdx = settle.indexOf('"thread/queue/start"');
    const guardIdx = settle.indexOf("bag.queueTimers?.[params.threadId]?.[head.id]");
    const guardBeforeStart = guardIdx >= 0 && startIdx >= 0 && guardIdx < startIdx;
    (guardBeforeStart && /timerAt > Date\.now\(\)/.test(settle) ? ok : fail)(
      "【196】回合结束自动启动前先跳过「未到点的定时消息」（否则定时消息会被 agent 回复完成的那一刻提前发出 —— 用户现场）"
    );
  }

  /* ② 到点释放链路：主进程定时器广播 → 渲染层订阅 → 真正启动 */
  (queueSeg.includes("onQueueTimerDue") && queueSeg.includes("releaseQueuedTimerDue") ? ok : fail)(
    "【196】渲染层订阅主进程 queue-timer:due 并有到点释放函数"
  );
  (/bag\.releaseQueuedTimerDue = releaseQueuedTimerDue/.test(queueSeg) ? ok : fail)(
    "【196】释放函数已挂到 bag（bag 家族每个名字必须有赋值行）"
  );
  (/queueTimerSet|queueTimerCancel/.test(queueSeg) ? ok : fail)(
    "【196】设/取消定时走主进程通道（渲染层 setTimeout 会被 Chromium 节流）"
  );

  /* ③ 一次性任务跑完必须结束序列 */
  (/computeNextRunAt\(task, base, task\.lastRunAt\)/.test(sched) ? ok : fail)(
    "【196】advanceNextRunAt 把 lastRunAt 传给 computeNextRunAt（漏传 ⇒ 一次性任务跑完不结束序列，nextRunAt 留一个过去时刻）"
  );

  /* ④ 调度器必须被真正启动 */
  (/await scheduler\.start\(\)/.test(boot) ? ok : fail)(
    "【196】boot 里 await scheduler.start()（实例建了不启动 ⇒ 30s tick 从不发生 ⇒ 任务永不触发）"
  );
  const handlers = ["scheduler:list", "scheduler:save", "scheduler:delete", "scheduler:run"].filter((ch) => mrp.includes(`"${ch}"`));
  (handlers.length === 4 ? ok : fail)(
    `【196】scheduler 四通道 handler 全在（缺 ${4 - handlers.length} 个：list/save/delete/run）`
  );

  /* ⑤ 负向：调度 MCP 的工具面里**不许**混进 scheduler 通道 —— 要加必须同时把安全闸一起改 */
  {
    const tools = [...dispatch.matchAll(/name:\s*"(agent_invoke|agent_archive_sessions|[a-z_]+)"/g)].map((m) => m[1]);
    const leaked = tools.filter((t) => /scheduler/i.test(t));
    (leaked.length === 0 ? ok : fail)(
      `【196】调度 MCP 工具面不含 scheduler（模型侧没有建任务入口是**设计现状**；要放开得同步改安全闸）：多出 ${leaked.join(", ") || "无"}`
    );
  }
}
