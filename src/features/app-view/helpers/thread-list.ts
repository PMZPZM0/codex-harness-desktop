/**
 * app-view/helpers/thread-list（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：会话列表分组 / 消息检索 / 会话回合续接
 * 符号（5）：parseTeamMemberTitle / groupThreadsByTime / collectMessageTexts / locateMatchEl / resumeThreadWithTurns
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 */
import type { Thread } from "../types";
import { itemText } from "../../../lib/item-text";



export /** 会话列表按本地日历日分组（WorkBuddy conversation-section 风格） */
/** 按「具体日期」对对话分组（今天 / 昨天用口语，其余用具体月日），每组一个可折叠 section */
/** 识别「历史成员会话」：早期后台调度（team_member_invoke）没登记映射，也没设线程名，
 *  标题就是首条用户消息里的 `[专家团「X」成员 Y（Z）]` 角色头（09-14 用户实测截图）。
 *  渲染层据此把它们归回所属团队的簇、并把标题清洗成职能名，避免散落在外面「看起来重复」。 */
function parseTeamMemberTitle(name: string): { teamName: string; memberName: string; profession: string } | null {
  const m = String(name ?? "").match(/\[专家团「(.+?)」\s*(?:主理人|成员)\s+(.+?)（(.+?)）\]/);
  return m ? { teamName: m[1], memberName: m[2], profession: m[3] } : null;
}

/** ⛔ **当前无调用方**（2026-09-25 起）：它是侧栏「分组（按时间）」视图的归组函数，而那个视图
 *  已按用户要求删除（「分组可以删了」）⇒ 只剩导出、没有调用点。
 *
 *  ⛔ 为什么不单独删它：它只是**搬迁遗留的整体模式**里的一个 —— 实测 31 个 part 文件都从
 *  `app-view/helpers` 批量 import 一个 40+ 符号的巨长列表，而**1478 个符号里 92.5% 从未被引用**；
 *  删这一个名字要同步改约 50 处 import 列表，收益（静态体积，且 build 后 tree-shaken 为 0）
 *  远小于风险。**要清就整体清**（一次重写这 31 个文件的 import），别单摘一个。
 *  ⛔ 若将来「按时间分组」视图回归：本函数可直接复用（口径不变），别另写一份。 */
export function groupThreadsByTime(threads: Thread[]): { key: string; label: string; items: Thread[] }[] {
  const groups = new Map<string, { key: string; label: string; items: Thread[] }>();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const dayMs = 86400;
  const pad = (value: number) => String(value).padStart(2, "0");
  for (const t of threads) {
    const ts = t.updatedAt;
    // 分组键必须用「本地日历日零点」时间戳，不能用 floor(ts/86400)（按 UTC 日切分）——
    // UTC+8 下今天 0~8 点的会话会落进上一个 UTC 日，被拆成另一组但标签同为「今天」→ 重复分组。
    const d = new Date(ts * 1000);
    const key = String(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
    let label: string;
    if (ts >= startOfToday) label = "今天";
    else if (ts >= startOfToday - dayMs) label = "昨天";
    else {
      const d = new Date(ts * 1000);
      const nowD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffDays = Math.round((nowD.getTime() / 1000 - ts) / dayMs);
      if (diffDays < 7) {
        const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
        label = weekdays[d.getDay()];
      } else {
        label = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
    }
    let group = groups.get(key);
    if (!group) { group = { key: `day-${key}`, label, items: [] }; groups.set(key, group); }
    group.items.push(t);
  }
  return [...groups.values()].sort((a, b) => Number(b.key.replace("day-", "")) - Number(a.key.replace("day-", "")));
}

export /** 收集对话消息文本供内容搜索（user/agent 正文、推理、工具 content/title） */
function collectMessageTexts(thread: Thread | null): { turnId: string; itemId: string; type: string; text: string }[] {
  if (!thread) return [];
  const out: { turnId: string; itemId: string; type: string; text: string }[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      // ⛔ 09-24 修（用户实测「搜索只搜到一半」）：**用户消息的正文在 `content` 数组里**
      //   （`item.text` 是空的），原先只读 item.text ⇒ **用户自己发的消息一律搜不到**。
      //   实测症状：DOM 上明明显示「请严格按顺序做三件事…」，搜它 0 命中；而搜助手消息里的
      //   「的」能命中 5 处 —— 一半内容搜不到，正是这个字段判断漏的。
      //   统一交给 itemText（它按 item.type 取正确字段：agentMessage→text、userMessage→content[]）。
      let text = itemText(item as never);
      if (!text.trim()) {
        if (item.type === "reasoning") text = typeof item.text === "string" ? item.text : "";
        else if (typeof item.content === "string") text = item.content;
        else if (typeof item.title === "string") text = item.title;
        else if (typeof item.summary === "string") text = item.summary;
      }
      if (text.trim()) out.push({ turnId: turn.id, itemId: item.id, type: item.type, text });
    }
  }
  return out;
}

export /** 在滚动容器里定位匹配消息元素（优先精确 item，退化同 turn 首条）。
 *
 *  ⛔⛔ **只找得到「已渲染」的元素** —— 消息区是**懒加载**的（窗口化渲染，默认只挂最近
 *  TURN_WINDOW 个回合，更早的靠「显示更早的 N 条」/滚到顶增量加载）。而搜索结果 /
 *  会话内搜索的命中来自**内存里的 thread.turns（含未渲染的更早页）** ⇒ 命中项完全可能
 *  还没有对应 DOM。此时本函数返回 **null**。
 *  ⛔ 所以调用方**不能**写成 `locateMatchEl(scroller, m)?.scrollIntoView(...)` 就完事 ——
 *  未渲染时它会**静默无操作**（用户 09-24 反馈「搜到但不跳」的真因）。
 *  正确做法：先扩渲染窗口覆盖目标回合，等 React 提交 DOM（双 rAF）后再调本函数
 *  —— 现成实现见 part07/03-seg.tsx 的 `jumpToTurnInWindow(turnId, itemId?)`。 */
function locateMatchEl(scroller: HTMLElement, m: { turnId: string; itemId: string }): HTMLElement | null {
  const all = Array.from(scroller.querySelectorAll<HTMLElement>("[data-turn-id]"));
  const exact = all.find((n) => n.dataset.turnId === m.turnId && n.dataset.itemId === m.itemId);
  if (exact) return exact;
  return all.find((n) => n.dataset.turnId === m.turnId) ?? null;
}

export /** 调度头像轨（09-16 用户要求「跟专家团那个展示一样」）：本会话派出去的专家 / 专家团 / 子智能体，
 *  运行中在消息区右侧亮头像 + 呼吸环（点击看实时工作内容），**跑完即从轨上消失**。
 *  复用 team-rail 的样式与锚点定位（弹窗也复用 team-run-popup），但数据源是调度登记表（delegate-run 广播），
 *  与专家团那条互不相干。 */

/** 调度工作内容弹窗：被调度会话的实时产出流（主进程转发该线程的文本增量），
 *  调用结束自动收起（phase=finished 时上层清掉 popupId）。底部跟随与 TeamRunPopup 同款。 */




/** 全局搜索命中预览弹窗：会话全文由主进程读 rollout 提供；记忆/任务/技能就地展示全文与详情。
 * 只读预览——不影响当前会话；底部按钮跳转到真正管理该内容的位置。 */

/** 会话全量恢复（含分页兜底）：引擎已弃用大线程的「全量水合」（deprecationNotice：
 * "Full-history hydration is deprecated for paginated threads; use excludeTurns: true,
 * then page with thread/turns/list"）——大线程 resume 可能只回元数据、turns 为空，
 * 表现就是「切会话后上个会话的回答没了」。因此 resume 后 turns 为空时改用
 * thread/turns/list 分页（asc + itemsView:full）拉齐全部回合再返回。
 * excludeTurns:true 的调用（权限推送等元数据场景）原样透传，不做额外请求。 */
async function resumeThreadWithTurns(params: { threadId: string; excludeTurns?: boolean } & Record<string, unknown>): Promise<any> {
  const result = await window.codex.request("thread/resume", params);
  const thread = result?.thread;
  if (params.excludeTurns || !thread || (Array.isArray(thread.turns) && thread.turns.length > 0)) return result;
  try {
    // 从最新往回取（desc）：小会话第一页就到头（正常取全量）；大会话取最近几页立即渲染，
    // 不再从最老的历史一页页爬——旧策略 asc 全量分页是「切会话要等十几秒」的主因。
    // 最新内容优先到达 = 用户点开即见最新消息；更早的历史按需（翻上去时 resume 补全）。
    const turns: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const pageResult: any = await window.codex.request("thread/turns/list", { threadId: params.threadId, limit: 200, sortDirection: "desc", itemsView: "full", ...(cursor ? { cursor } : {}) });
      const data = Array.isArray(pageResult?.data) ? pageResult.data : [];
      turns.push(...data);
      cursor = pageResult?.nextCursor ?? null;
      if (!cursor) break; // 到底了 = 全量取完（绝大多数会话在此结束）
    }
    turns.reverse(); // desc 取的倒序翻回时间正序
    if (turns.length) thread.turns = turns;
    // ⛔ 游标必须带出去：本函数是模块级的、拿不到组件的 turnsCursorRef，故挂在线程对象上
    // 作兜底（loadEarlierTurns 读 ref 未命中时用它）。否则「往上滚到底」会用空游标重拉
    // 最新一页 → 界面出现重复回合、游标原地打转。
    (thread as any).__turnsCursor = cursor;
  } catch { /* 分页失败维持原结果，不影响会话打开 */ }
  return result;
}