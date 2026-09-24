// ── 渲染层事件裁剪 / 熔断（09-12 P1 多会话性能域）──
// 从 electron/main.ts 按域搬出（纯搬迁，零行为改动）。判定语义、计数器名、注释均与原文一致。
//
// 职责：在主进程将引擎事件发给渲染层**之前**就按会话裁掉高频无用事件。
//
// 边界（改这个文件前必读）：
//   · 跨域**读**：main 的 popoutThreadIds（独立弹窗锁定会话的登记表）—— 活绑定，运行时才读；
//     本模块**顶层不读** main 的任何值，因此与 main 的循环 import 是安全的。
//   · 跨域**写**：rendererActiveByWindow 由 engine-ipc 在渲染层上报活跃会话时写入；
//     rendererDroppedEventCount 在本模块内自增，由 main 的 enrichScanCountSnapshot 读取（app:perf-counters）。
//     ⇒ 这两个符号的 export **不是**死代码，别顺手删。

import { popoutThreadIds } from "../runtime-refs";

/** 渲染层当前正在查看的会话（由渲染层在切换会话时上报）。
    多会话性能（09-12 P1）：引擎事件原本**全量广播**给渲染层，渲染层到
    `App.tsx` 的 threadId 过滤才丢弃——序列化 + 跨进程拷贝的成本已经付过却白付，
    N 个后台会话同时流式就是 N 倍的冤枉开销。这里在**发给渲染层之前**就按会话裁掉。 */
/** 诊断计数：被按会话过滤掉的事件数（e2e 用它证明过滤真的生效，而非「碰巧没事件」）。 */
export let rendererDroppedEventCount = 0;

/** 跨会话也必须送达渲染层的**轻量**事件白名单。
    依据是渲染层真实依赖：侧栏转圈/运行指示（markThreadRunning 系）靠
    thread/status/changed + turn/started + turn/completed；排队角标靠 thread/queue/changed；
    后台新建会话（渠道机器人）要靠 thread/started 触发侧栏刷新。
    **其余事件（各种 delta / item 全文 / outputDelta）只有当前会话需要。** */
const RENDERER_CROSS_SESSION_METHODS = new Set([
  "thread/started",
  "thread/status/changed",
  "thread/name/updated",
  "thread/queue/changed",
  "thread/closed",
  "thread/archived",
  "thread/unarchived",
  "thread/deleted",
  "turn/started",
  "turn/completed",
  // ⛔ 09-20 补齐：渲染层的**跨会话区**要处理 aborted/failed/interrupted（熄灭运行指示 / 点后台绿点）
  //   与 error（后台会话的 429 排重试），漏发等于后台会话状态永久卡住（转圈不消失 / 重试链不启动）。
  //   这些都是低频生命周期事件，放行成本可忽略。
  "turn/aborted",
  "turn/failed",
  "turn/interrupted",
  "error",
]);

/** 会话 id 提取：不同事件把归属放在不同字段上，逐个兜。取不到就不敢裁（放行）。 */
export function eventThreadId(params: any): string {
  if (!params || typeof params !== "object") return "";
  return String(params.threadId ?? params.thread_id ?? params.conversationId ?? "");
}

/** 每个窗口各自上报的「我在看哪个会话」——**必须按窗口分别记**。
 *  09-12 那次事故的根因就在这里：主窗口与独立弹窗共用同一个全局变量，
 *  后上报的窗口会覆盖前一个 → 另一个窗口正在看的会话被裁掉事件 → 永久转圈。 */
export const rendererActiveByWindow = new Map<number, { threadId: string; at: number }>();
/** 上报新鲜度窗口：超过这个时间没再上报，就认为「不知道它在看什么」，一律放行（宁多不漏）。 */
const ACTIVE_THREAD_FRESH_MS = 30_000;
/** 逃生阀：HARNESS_EVENT_FILTER=off 一键回到全量放行（改代码之外的回退路径）。 */
export const EVENT_FILTER_ENABLED = process.env.HARNESS_EVENT_FILTER !== "off";

/** 当前「必须收到事件」的会话集合 = 各窗口新鲜的活跃会话 ∪ 独立弹窗锁定的会话。
 *  返回 null 表示「信息不可信」——此时调用方必须全量放行。
 *  ⛔ 09-20 修「两个会话窗口一起跑，前台会话只显示正在回复、过程不出内容」（用户截图 + rollout 实证：
 *  引擎 49 秒里稳定产出工具事件，是渲染层没收到）：
 *  旧实现只把**新鲜**（30s 内）的上报并进集合，而**过期**的上报被静默忽略 —— 等价于判定
 *  「那个窗口不知道在看什么」，可它照样返回集合 ⇒ 过期窗口正在看的会话的 item/delta 被裁掉，
 *  只剩 turn/started（白名单）把运行态点亮，用户看到的就是「一直转圈 + 内容不出来」。
 *  规则收紧：**任何窗口的上报过期都视为整体不可信 → 放行**（宁可多发，不可漏发）；
 *  渲染层侧另加 15s 心跳（见 App.tsx setActiveThread），正常情况下不会走到放行。 */
function watchedThreadIds(): Set<string> | null {
  const now = Date.now();
  const ids = new Set<string>();
  let anyStale = false;
  let anyFresh = false;
  for (const entry of rendererActiveByWindow.values()) {
    if (now - entry.at <= ACTIVE_THREAD_FRESH_MS) {
      anyFresh = true;
      if (entry.threadId) ids.add(entry.threadId);
    } else {
      anyStale = true;
    }
  }
  // 弹窗锁定的会话：即使主窗口已经切走，也必须继续收到它自己的流式事件
  for (const tid of popoutThreadIds.values()) if (tid) { ids.add(tid); anyFresh = true; }
  if (!anyFresh || anyStale) return null;
  return ids;
}

export function filterForRenderer(event: any) {
  if (!EVENT_FILTER_ENABLED) return event;
  if (event?.kind !== "notification") return event;
  const method = String(event?.method ?? "");
  if (RENDERER_CROSS_SESSION_METHODS.has(method)) return event;
  const tid = eventThreadId(event?.params);
  if (!tid) return event;
  const watched = watchedThreadIds();
  if (!watched) return event;          // 不知道任何窗口在看什么 → 放行
  if (watched.has(tid)) return event;  // 正在被看着 → 放行
  // 真的可以裁掉：只有渲染层当前不看的会话的高频事件（各种 delta / item 全文 / outputDelta）。
  rendererDroppedEventCount += 1;
  return null;
}
