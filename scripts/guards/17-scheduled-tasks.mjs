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
  const mrp = readFileSync(join(ROOT, "electron", "features", "scheduler-ipc.ts"), "utf8");
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
  /* ⑤ 09-28 设计变更：模型侧**必须有** scheduler 四件套。
     原话「codex 还是调用不了这个工具还没做好吗」——此前 scheduler 只有界面 IPC，agent 没有桥
     ⇒ 会话里建不了定时任务，模型还引导用户「resume 刷新工具面」（工具不存在，resume 无用）。
     现在：内置调度 MCP（覆盖所有会话，含老会话）暴露四件套，执行端在 dispatch-rpc.ts。
     ⛔ schema（dispatch-core）与执行端（dispatch-rpc）**两边都要有** —— 只加 schema 不加
     执行 case = 工具出现在清单里但调用报「未知工具」，比没有更糟。 */
  {
    const rpc = codeOnly(readFileSync(join(ROOT, "electron", "features", "dispatch-rpc.ts"), "utf8"));
    for (const tool of ["scheduler_save", "scheduler_list", "scheduler_run", "scheduler_delete"]) {
      (dispatch.includes(`name: "${tool}"`) && rpc.includes(`name === "${tool}"`) ? ok : fail)(
        `【196】调度 MCP 含 ${tool}（schema + 执行端都要有 —— 分离 = 工具在清单里但调不动）`
      );
    }
    (rpc.includes("不允许创建定时任务") ? ok : fail)(
      "【196】scheduler_save 走 restrictedThreadRole 同源闸（专家/被调度会话不许建 —— 防套娃）"
    );
    /* ⑤.1 会话目标 + 微信收信人（09-28 用户追加：「能不能再把会话选择也加上…机器人给用户发消息也加上」）。
       schema 与执行端**两侧同步**断言：threadId 支持 "current"（调用者会话，模型不用猜 id）；
       deliverTo 指定收信人（缺省 = 最近对话用户）。 */
    for (const [label, inSchema, inExec] of [
      ["threadId（会话目标，\"current\"=调用者会话）", 'threadId: { type: "string"', 'rawThreadId === "current" ? callerThreadId'],
      ["deliverTo（微信收信人，缺省最近对话用户）", 'deliverTo: { type: "string"', 'to: deliverTo'],
    ]) {
      (dispatch.includes(inSchema) && rpc.includes(inExec) ? ok : fail)(
        `【196】scheduler_save 含 ${label}（schema 与执行端都要在 —— 分离 = 参数被静默丢弃）`
      );
    }
    // 执行端对 threadId 的安全语义：不认识原样透传可以，但 "current" 必须解析成调用者会话 id（不许让模型自报）
    (rpc.includes('rawThreadId === "current" ? callerThreadId : rawThreadId || undefined') ? ok : fail)(
      "【196】\"current\" 必须解析成引擎认定的调用者会话 id（模型自报 threadId 不可信）"
    );
  }
  }
}
