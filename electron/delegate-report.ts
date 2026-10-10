/**
 * delegate-report —— 「转后台」的委派 / 团队成员**真正完成**时，把结果自动投回发起会话（10-10）。
 *
 * ── 为什么必须是"宿主代投"，被委派会话自己说不出口 ─────────────────────────────
 * 它与主会话一样是**回合制**：回合一结束（不管同步跑完还是被宿主放手）它就停了，
 * 没有任何"待机等结果"的形态 ⇒ 结果回来时它早已停，没法再开口。
 * ⇒ 那句回报只能是宿主以它的名义投递（`[后台回报]「X」已完成…`）。
 *
 * ── 载体为什么是**引擎队列**（thread/queue/add → start）────────────────────────
 * · queue 是**带 threadId** 的 ⇒ 可以对任意会话投（不只当前窗口正看着的那个）；
 * · 发起会话**空闲** ⇒ 投完它自己就跑起来；**正在跑** ⇒ 排队等这一轮结束再启动；
 *   ⇒ 不用判断忙闲；⛔ 绝不能用 `thread/start` + `turn/start`（那会打断正在跑的回合）。
 *
 * ── 去重（⛔ 不做必翻车）────────────────────────────────────────────────────
 * 同步跑通的委派，结果**已经**通过 `agent_invoke` 的返回值交回主会话了 ⇒ 再投一次就是两份。
 * ⇒ 只对打了 `pendingReport` 标记（= 走过"转后台"分支）的那次投递（标记在调用方判，
 *   见 delegate-settle.ts / delegate-registry.ts）。
 *
 * ── 防循环（⛔ 不做必烧钱）──────────────────────────────────────────────────
 * 主会话收到回报 → 又派活 → 又超时 → 又回报 …… 同一会话在窗口内最多 N 次，到上限静默停手。
 */
import { randomUUID } from "node:crypto";
import { server } from "./runtime-refs";

/** 同一发起会话在多少毫秒内最多自动回投几次（防「回报 → 又派活 → 又超时 → 又回报」滚雪球）。 */
export const DELEGATE_REPORT_WINDOW_MS = 15 * 60 * 1000;
export const DELEGATE_REPORT_MAX_PER_WINDOW = 3;

const reportLog = new Map<string, { count: number; firstAt: number }>();

function quotaAllows(originThreadId: string): boolean {
  const key = String(originThreadId ?? "");
  if (!key) return false;
  const now = Date.now();
  const rec = reportLog.get(key);
  if (!rec || now - rec.firstAt > DELEGATE_REPORT_WINDOW_MS) {
    reportLog.set(key, { count: 1, firstAt: now });
    return true;
  }
  if (rec.count >= DELEGATE_REPORT_MAX_PER_WINDOW) return false;
  rec.count += 1;
  return true;
}

/** 回报正文：把**产出**带上，让主会话接着干（不是重做一遍）。 */
export function backgroundReportText(label: string, output: string): string {
  const body = String(output ?? "").trim() || "（任务已结束，但没有留下文本产出 —— 详情看它的会话。）";
  return `[后台回报] 你之前派出去的「${label}」已经完成（它之前因耗时超过同步等待上限被转到了后台）。`
    + `\n\n${body}\n\n请基于这个结果继续你之前的工作；如果这件事已经全部做完，用一句话向用户汇报结论即可；`
    + `⛔ 不要为同一件事再派一次同样的任务。`;
}

/**
 * 把一份已完成的"转后台"结果投回发起会话。返回 true = 已投递。
 * ⛔ 调用方只应在 **pendingReport === true** 时调它（去重闸在调用方，见 delegate-settle.ts）。
 */
export async function reportBackgroundResult(input: {
  originThreadId: string;
  label: string;
  output: string;
}): Promise<boolean> {
  const origin = String(input?.originThreadId ?? "");
  if (!origin) return false;
  if (!quotaAllows(origin)) return false;
  const text = backgroundReportText(String(input?.label ?? "任务"), input?.output ?? "");
  try {
    /* ① 先 resume：发起会话的回合可能早已结束、线程已被引擎卸载（不加载就投不进队列）。
       失败不致命（catch 掉继续试投）。 */
    await server.request("thread/resume", { threadId: origin, excludeTurns: false }).catch(() => undefined);
    /* ② 排队（⛔ 不用 turn/start —— 那会打断发起会话正在跑的回合）。 */
    await server.request("thread/queue/add", {
      threadId: origin,
      input: [{ type: "text", text }],
      clientUserMessageId: randomUUID(),
    });
    /* ③ 启动队头：发起会话早已空闲 ⇒ 不 start 它就一直躺在队列里没人管。
       ⛔ 「找不到 / 已被引擎自己启动」是**伪失败**（引擎在回合结束后 ~9ms 就自己清队列，
       与渲染层 auto-continue 的同一口径，见 lib/queue-errors.mjs）⇒ 静默吞掉，不重试。 */
    const list: any = await server.request("thread/queue/list", { threadId: origin, limit: 1 }).catch(() => null);
    const head = list?.data?.[0];
    if (head?.id) {
      await server.request("thread/queue/start", { threadId: origin, queuedSubmissionId: head.id }).catch(() => undefined);
    }
    return true;
  } catch {
    /* 投递失败不抛：这次回报丢了，但产出仍完整落在被委派会话里（用户可手动查看） */
    return false;
  }
}
