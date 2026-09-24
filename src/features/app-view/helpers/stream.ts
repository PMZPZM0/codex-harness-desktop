/**
 * app-view/helpers/stream（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：流式事件归约与线程对象合并（delta / merge / buffered reveal）
 * 符号（15）：reasoningStart / deltaMethods / isDeltaMethod / mergeItem / threadContentChanged / mergeLongerStreams / mergeTurn / markBufferedAgentReveal / markBufferedTurnReveal / stableItem / hydrateTurnUserMessage / appendDelta / appendIndexedDelta / threadStreamMethods / applyThreadEvent
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 */
import { mergeTurnListsById } from "../../../lib/turn-order.mjs";
import { Turn } from "../../../lib/turn";
import { ThreadItem } from "../../../lib/thread-item";
import { truncateTailLines } from "../../../lib/truncate-tail-lines";
import { bufferedToolRevealStarts } from "../../../lib/buffered-tool-reveal-starts";
import { reasoningDuration } from "../../../lib/reasoning-duration";
import { bufferedAgentRevealStarts } from "../../../lib/buffered-agent-reveal-starts";
import { reasoningTextOf } from "../../../lib/reasoning-text-of";
import { bufferedReasoningRevealStarts } from "../../../lib/buffered-reasoning-reveal-starts";
import { itemText } from "../../../lib/item-text";
import { mergeReasoningPartIndex } from "../../../lib/reasoning-part-merge.mjs";
import { adoptUnknownTurn } from "../../../lib/turn-item-merge.mjs";
import type { Thread } from "../types";

/** 思考 summary 段的"碎片"判定线：新段首片到达时，最近非空段短于此值就并入（防中转网关
 *  逐 delta 递增 summaryIndex 把思考卡碎成 2~4 字短行 —— 09-22 用户群反馈）。 */
export const REASONING_MIN_PART_CHARS = 30;



export /** 看着像文件路径：要么含盘符/分隔符，要么以 .<1-5 字符后缀 结尾 */

/** 从 assistant markdown 中抽出可疑文件路径（围栏代码块外；同路径去重） */


/** 用户消息引用行：文件卡片 / 技能胶囊 / 上下文引用卡 */

/** 排队消息列表：位于输入框上方，长条布局，新消息往上叠加（最新的在最顶部、紧贴输入框）。
 *  含 2 条及以上时提供折叠/展开开关（默认展开，由用户手动折叠）；拖动排序由每条左侧手柄支持。 */


const reasoningStart = new Map<string, number>();

export const deltaMethods = new Set(["item/agentMessage/delta", "item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded", "item/reasoning/textDelta", "item/commandExecution/outputDelta"]);

export const isDeltaMethod = (method: string) => deltaMethods.has(method);

export function mergeItem(thread: Thread | null, turnId: string, item: ThreadItem) {
  if (!thread) return thread;
  // ⛔⛔ 未知回合的 userMessage 必须用它把回合**建出来**，不能静默丢弃（09-23 用户实测：
  //   「排队消息自动发出时对话框里不出现那条消息，agent 只短暂显示正在回复然后就结束」）。
  //   实证（真实 app-server + mock 上游，09-23）：turn/started 的回合快照 items=[]、
  //   turn/completed 的 items 只有 agentMessage —— 引擎**从不**在这两处带用户消息，它只走
  //   item/started / item/completed；而排队消息由**引擎自己**启动成新回合（队列随即清空），
  //   应用侧 thread/queue/list 拿到空数组 ⇒ 没人建回合。此时若 userMessage 事件比 turn/started
  //   早到（同一 tick 连投一串事件、顺序会抖），旧实现会把它连同该回合的流式内容一起丢掉，
  //   之后再无补救机会。判据与取舍见 src/lib/turn-item-merge.mjs（守卫【111】真跑）。
  const adopted = adoptUnknownTurn(thread.turns, turnId, item);
  if (adopted) return { ...thread, turns: [...thread.turns, adopted] };
  return {
    ...thread,
    turns: thread.turns.map((turn) =>
      turn.id !== turnId
        ? turn
        : { ...turn, items: turn.items.some((entry) => entry.id === item.id) ? turn.items.map((entry) => (entry.id === item.id ? stableItem(entry, item) : entry)) : [...turn.items, item] },
    ),
  };
}

export function threadContentChanged(a: Thread | null, b: Thread | null): boolean {
  if (!a || !b) return true;
  if (a.turns.length !== b.turns.length) return true;
  const lastA = a.turns[a.turns.length - 1]?.id;
  const lastB = b.turns[b.turns.length - 1]?.id;
  if (lastA !== lastB) return true;
  return a.updatedAt !== b.updatedAt;
}

export /** 运行中会话切回时的 resume 合并：快照可能落后于本地流式积累（切走期间 delta 仍在更新内存）。
 *  逐 item 取文本更长的一方（agentMessage 正文 / reasoning 摘要与内容），避免正文回退后
 *  delta 从快照点重新追加 = 已渲染内容「重新走一遍出字动画」（09-08 反馈）。
 *  ⛔ 并且必须做**并集**：resume 快照常常只带部分 items（运行中的回合尤其明显），
 *  早期实现只遍历快照的 items，于是"缓存里有、快照里没有"的条目**整条消失** ——
 *  用户实测「运行中切出去、切回来整个不展示」（同一时间线 textContent 39341 → 6107，
 *  而最长的那条正文还在，正因为丢的是"快照没带回来的那部分"）。
 *  以**缓存的顺序**为骨架（缓存是本地一直累积的那份，最全），快照里新增的追加到末尾。 */
function mergeLongerStreams(cached: Thread, loaded: Thread): Thread {
  const mergeItems = (oldItems: ThreadItem[], newItems: ThreadItem[]): ThreadItem[] => {
    const newById = new Map(newItems.map((entry) => [entry.id, entry] as const));
    const oldById = new Map(oldItems.map((entry) => [entry.id, entry] as const));
    const pick = (item: ThreadItem): ThreadItem => {
      const prev = oldById.get(item.id);
      if (!prev) return item;
      if (item.type === "agentMessage" && typeof item.text === "string" && typeof prev.text === "string" && prev.text.length > item.text.length) {
        return { ...item, text: prev.text };
      }
      if (item.type === "reasoning") {
        const longer = (arr: any[] | undefined, cur: any[] | undefined) => (Array.isArray(arr) && (cur?.length ?? 0) < arr.length ? arr : cur);
        const summary = longer(prev.summary as any[], item.summary as any[]);
        const content = longer(prev.content as any[], item.content as any[]);
        if (summary !== item.summary || content !== item.content) return { ...item, summary, content };
      }
      return item;
    };
    const out = oldItems.map((item) => pick(newById.get(item.id) ?? item));
    for (const item of newItems) if (!oldById.has(item.id)) out.push(item);
    return out;
  };
  const mergedTurns = loaded.turns.map((turn) => {
    const oldTurn = cached.turns.find((entry) => entry.id === turn.id);
    if (!oldTurn) return turn;
    return { ...turn, items: mergeItems(oldTurn.items, turn.items) };
  });
  // 快照整段没带回来的回合同样不能丢
  const loadedIds = new Set(loaded.turns.map((turn) => turn.id));
  const extraTurns = cached.turns.filter((turn) => !loadedIds.has(turn.id));
  // ⛔ 09-15 修复「回合顺序错乱/更早按钮对不上」：extraTurns 原来**盲目前插**——某次 resume
  // 快照只带回部分回合（如最旧的 [1,2]）时，状态变成 [3..8,1,2]：最旧的贴到末尾、中间回合
  // 看似失踪、「显示更早的 N 条」与渲染对不上（用户实测截图）。现在按 id 去重合并 + 按回合
  // startedAt 时序规范化，乱序输入在唯一出口处被修正（纯逻辑在 src/lib/turn-order.mjs，预检有行为断言）。
  return { ...loaded, turns: mergeTurnListsById(mergedTurns, extraTurns) };
}

export function mergeTurn(thread: Thread | null, nextTurn: Turn) {
  if (!thread) return thread;
  const current = thread.turns.find((turn) => turn.id === nextTurn.id);
  const items = current ? [...current.items] : [];
  for (const item of nextTurn.items) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index === -1) { items.push(item); continue; }
    // 引用保持：内容没变的 item 沿用旧引用，memo 才能跳过未变化消息；
    // turn/completed 整回合替换时不再引发全树重渲染（闪烁根源）
    items[index] = stableItem(items[index], item);
  }
  // 保留回合级 usage（引擎在 turn/completed 时附带，旧消息也能展示 token / 缓存）
  const turn = current ? { ...current, ...nextTurn, items, usage: nextTurn.usage ?? current.usage } : nextTurn;
  return { ...thread, turns: current ? thread.turns.map((entry) => entry.id === turn.id ? turn : entry) : [...thread.turns, turn] };
}

export function markBufferedAgentReveal(thread: Thread | null, turnId: string, item: ThreadItem) {
  // reasoning 完成快照一次性交付思考全文：同样标记起点，渲染层渐进揭示
  if (item.type === "reasoning") {
    const nextText = reasoningTextOf(item);
    if (nextText.length < 40) return;
    const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
    const currentText = reasoningTextOf(current as ThreadItem);
    const jump = nextText.length - currentText.length;
    if (jump >= 40 && nextText.startsWith(currentText)) bufferedReasoningRevealStarts.set(item.id, currentText);
    return;
  }
  if (item.type === "commandExecution") {
    const nextText = truncateTailLines(String(item.aggregatedOutput ?? "").trim(), 500).text;
    if (nextText.length < 48) return;
    const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
    const currentText = truncateTailLines(String(current?.aggregatedOutput ?? "").trim(), 500).text;
    if (nextText.length - currentText.length >= 48) bufferedToolRevealStarts.set(String(item.id), nextText.startsWith(currentText) ? currentText : "");
    return;
  }
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    const payload = (entry: ThreadItem | undefined) => String(entry?.progress || JSON.stringify(entry?.result ?? entry?.arguments ?? entry?.contentItems, null, 2) || "");
    const nextText = payload(item);
    if (nextText.length < 48) return;
    const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
    const currentText = payload(current);
    if (nextText.length - currentText.length >= 48) bufferedToolRevealStarts.set(`${item.id}-payload`, nextText.startsWith(currentText) ? currentText : "");
    return;
  }
  if (item.type === "fileChange") {
    const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
    for (const [index, change] of (item.changes ?? []).entries()) {
      const nextText = String(change?.diff ?? "");
      const currentText = String(current?.changes?.[index]?.diff ?? "");
      if (nextText.length >= 48 && nextText.length - currentText.length >= 48) {
        bufferedToolRevealStarts.set(`${item.id}-diff-${index}`, nextText.startsWith(currentText) ? currentText : "");
      }
    }
    return;
  }
  if (item.type !== "agentMessage") return;
  const nextText = String(item.text ?? "");
  if (nextText.length < 40) return;
  const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
  const currentText = String(current?.text ?? "");
  const jump = nextText.length - currentText.length;
  if (jump >= 40 && nextText.startsWith(currentText)) bufferedAgentRevealStarts.set(item.id, currentText);
}

export function markBufferedTurnReveal(thread: Thread | null, turn: Turn) {
  for (const item of turn.items ?? []) markBufferedAgentReveal(thread, turn.id, item);
}

export /** 服务端快照 vs 本地流式状态：所有字段深比较等值则保留旧引用（memo 命中） */
function stableItem(existing: ThreadItem, next: ThreadItem): ThreadItem {
  // 服务端快照缺 summary/content/text（reasoning/agentMessage 完成事件经常只回 id+status），
  // 直接用 next 会把本地流式积累的内容清空——思考卡“完成后消失”的根源。缺字段时本地优先。
  // 另：服务端完成快照的 summary/content 是对象数组 [{type:"summary_text",text}]，本地流式存的是
  // 字符串数组 ["..."]，结构不同不该覆盖本地（否则思考内容会变成 "[object Object]"）。
  const sparse = (next.type === "reasoning" || next.type === "agentMessage") && next.summary == null && next.content == null && next.text == null;
  const serverObjectArray = (next.type === "reasoning") && Array.isArray(next.summary) && next.summary.some((entry: any) => entry && typeof entry === "object");
  if (sparse || serverObjectArray) return { ...next, summary: existing.summary ?? next.summary, content: existing.content ?? next.content, text: existing.text ?? next.text };
  // turn/started、item/completed、turn/completed 都可能返回同 ID 但 content 为空的 userMessage。
  // 空快照只能更新状态，绝不能抹掉已经落地的用户正文。
  if (next.type === "userMessage" && itemText(existing).trim() && !itemText(next).trim()) {
    return { ...next, content: existing.content };
  }
  // agentMessage 文本回退保护：切换回运行中会话时，引擎 resume 会重放 item/started 等
  // 快照事件，其 text 为空或短于本地流式积累的内容——用快照覆盖会让已渲染的正文被清短，
  // 随后 delta 从头继续追加 = 整段正文「重新走一遍出字动画」（09-08 反馈）。
  // 快照文本是本地文本的前缀（或等长）时保留本地长文本；本地为空/快照是新内容时正常采用。
  if (next.type === "agentMessage" && typeof next.text === "string" && typeof existing.text === "string" && existing.text.length > 0) {
    if (next.text.length <= existing.text.length && existing.text.startsWith(next.text)) {
      return { ...next, text: existing.text };
    }
  }
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
  for (const key of keys) {
    const a = (existing as any)[key];
    const b = (next as any)[key];
    if (a === b) continue;                       // 引用/值相同：先短路（绝大多数 key 走这条）
    // ⛔ 大字符串字段**不做 JSON.stringify**（09-13 性能）：agentMessage 每来一条 delta 都会
    // 拿累计正文（可达数万字）走这里，stringify 两次 = 每条 delta 白烧几十万字符的拷贝与临时串
    // （2 万字回复 ≈ 2000 条 delta ≈ 4000 万字符），主线程被占住就是「出字卡顿」。
    // 长度不同 → 一定变了；长度相同 → 再比一次内容（字符串比较是 O(n) 但**不分配**，比 stringify 便宜得多）。
    if (typeof a === "string" && typeof b === "string") {
      if (a.length !== b.length || a !== b) return next;
      continue;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) return next;   // 其它字段（数组/对象）保持原语义
  }
  return existing;
}

export /** turn/start 的同步响应有时包含空 userMessage；用本次真实 input 补齐后再进入本地状态。 */
function hydrateTurnUserMessage(turn: Turn, input: any[]): Turn {
  let hydrated = false;
  const items = turn.items.map((item) => {
    if (item.type !== "userMessage" || itemText(item).trim()) return item;
    hydrated = true;
    return { ...item, content: input };
  });
  return hydrated ? { ...turn, items } : turn;
}

export function appendDelta(thread: Thread | null, turnId: string, itemId: string, type: string, field: string, delta: string) {
  if (!thread) return thread;
  const turn = thread.turns.find((entry) => entry.id === turnId);
  const current = turn?.items.find((entry) => entry.id === itemId) ?? { id: itemId, type };
  return mergeItem(thread, turnId, { ...current, [field]: `${current[field] ?? ""}${delta}` });
}

export function appendIndexedDelta(thread: Thread | null, turnId: string, itemId: string, field: "summary" | "content", index: number, delta: string) {
  if (!thread) return thread;
  const turn = thread.turns.find((entry) => entry.id === turnId);
  const current = turn?.items.find((entry) => entry.id === itemId) ?? { id: itemId, type: "reasoning", summary: [], content: [] };
  const parts = [...(current[field] ?? [])];
  /* 09-22 用户群反馈：思考卡碎成 2~4 字短行（中转网关逐 delta 递增 summaryIndex）。
   * 防御逻辑在 src/lib/reasoning-part-merge.mjs（纯函数，守卫【109】直接真跑）；这里只接线。 */
  index = mergeReasoningPartIndex(parts, index, field, delta, REASONING_MIN_PART_CHARS);
  parts[index] = `${parts[index] ?? ""}${delta}`;
  // 深度思考很长时引擎可能在思考真正结束前就推 item/completed（实测：codex_core
  // 报 "ReasoningSummaryDelta without active item" / "OutputTextDelta without active item"，
  // 即提前完结的 item 仍持续收到后续 delta）。若此刻仍收到 reasoning 增量，说明思考还没完：
  // 清掉过早落下的 duration / 恢复 running，否则 reasoningActive 判定会断 → 运行状态
  // 莫名中断但内容还在涨（用户实测连续两次：深度思考很久后运行状态断了）。
  const merged = mergeItem(thread, turnId, { ...current, [field]: parts });
  const fresh = merged?.turns.find((entry) => entry.id === turnId)?.items.find((entry) => entry.id === itemId);
  if (fresh && fresh.type === "reasoning") {
    if (fresh.status !== "inProgress" && fresh.status !== "running") {
      reasoningDuration.delete(itemId);
      if (!reasoningStart.has(itemId)) reasoningStart.set(itemId, Date.now());
      return mergeItem(merged!, turnId, { ...fresh, status: "inProgress", durationMs: undefined });
    }
    if (reasoningDuration.has(itemId)) reasoningDuration.delete(itemId);
  }
  return merged!;
}

export const threadStreamMethods = new Set([
  "turn/started", "turn/completed", "item/started", "item/completed",
  "item/agentMessage/delta", "item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded", "item/reasoning/textDelta",
  "item/commandExecution/outputDelta", "item/plan/delta", "turn/plan/updated",
  "item/fileChange/patchUpdated", "item/mcpToolCall/progress", "item/commandExecution/terminalInteraction",
  "thread/name/updated", "thread/status/changed",
]);

export function applyThreadEvent(thread: Thread | null, method: string, params: any): Thread | null {
  switch (method) {
    case "turn/started":
      return mergeTurn(thread, params.turn);
    case "turn/completed":
      markBufferedTurnReveal(thread, params.turn);
      return mergeTurn(thread, params.turn);
    case "item/started":
      return mergeItem(thread, params.turnId, params.item);
    case "item/completed":
      markBufferedAgentReveal(thread, params.turnId, params.item);
      return mergeItem(thread, params.turnId, params.item);
    case "item/agentMessage/delta":
      return appendDelta(thread, params.turnId, params.itemId, "agentMessage", "text", params.delta);
    case "item/reasoning/summaryTextDelta":
      return appendIndexedDelta(thread, params.turnId, params.itemId, "summary", params.summaryIndex ?? 0, params.delta ?? params.text ?? "");
    case "item/reasoning/summaryPartAdded":
      return appendIndexedDelta(thread, params.turnId, params.itemId, "summary", params.summaryIndex ?? params.index ?? 0, params.part?.text ?? params.text ?? params.delta ?? "");
    case "item/reasoning/textDelta":
      return appendIndexedDelta(thread, params.turnId, params.itemId, "content", params.contentIndex ?? 0, params.delta ?? params.text ?? "");
    case "item/commandExecution/outputDelta":
      return appendDelta(thread, params.turnId, params.itemId, "commandExecution", "aggregatedOutput", params.delta);
    case "item/plan/delta":
      return appendDelta(thread, params.turnId, params.itemId, "plan", "text", params.delta);
    case "turn/plan/updated": {
      const text = `${params.explanation ? `${params.explanation}\n\n` : ""}${(params.plan ?? []).map((step: any) => `- [${step.status === "completed" ? "x" : " "}] ${step.step}`).join("\n")}`;
      return mergeItem(thread, params.turnId, { id: `plan-${params.turnId}`, type: "plan", text });
    }
    case "item/fileChange/patchUpdated": {
      const turn = thread?.turns.find((entry) => entry.id === params.turnId);
      const item = turn?.items.find((entry) => entry.id === params.itemId) ?? { id: params.itemId, type: "fileChange", status: "inProgress" };
      return mergeItem(thread, params.turnId, { ...item, changes: params.changes });
    }
    case "item/mcpToolCall/progress":
      return appendDelta(thread, params.turnId, params.itemId, "mcpToolCall", "progress", `${params.message}\n`);
    case "item/commandExecution/terminalInteraction":
      return appendDelta(thread, params.turnId, params.itemId, "commandExecution", "terminalInput", params.stdin);
    case "thread/name/updated":
      return thread ? { ...thread, name: params.threadName ?? null } : thread;
    case "thread/status/changed":
      return thread && thread.id === params.threadId ? { ...thread, status: params.status } : thread;
    default:
      return thread;
  }
}