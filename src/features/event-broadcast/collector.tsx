/**
 * 悬浮播报 · 采集器（把各处的「播报源」变成 store 里的条目）
 *
 * 用户令（10-31）：「群事件重构为悬浮播报；**排查当前还有哪些对话框播报类型可以接入，一并接入**」。
 * 目前接入五类（各自的触发点都在本文件，加新类型只加一段 effect + 一个 kind）：
 *
 *   ① group    群事件广播 —— 对话流里的 `[群事件]` userMessage（成员进群/交活/审查结论/群提示）
 *   ② system   应用级系统提示 —— bag 的 `systemEvents`（成功/警告/错误）
 *   ③ turn     回合异常结束 —— `describeTurnStop(turn)` 有 label 的（出错/中断/超限）
 *   ④ approval 等待你确认 —— 运行状态文案进入"等待确认"
 *   ⑤ voice    语音播报 —— 见 `voice-bridge.ts`（订阅 announce-bus，独立一条，因为它有自己的开关）
 *
 * ⛔⛔ 首屏静默：切会话/冷启动时对话流里**已经有**一堆历史群事件与历史异常。若直接推，
 *   用户一开会话就被几十条播报糊一脸（还会把语音念出来）。所以每一类都有一套「先对齐一次
 *   基线、之后只播增量」的处理：group 用 `markBroadcastSeen` 登记，system 记 id 集合，
 *   turn 记「上一帧最后一个回合的 running 态」。
 */
import { useEffect, useRef } from "react";
import type { GroupEventBlock } from "../../lib/group-event-text.mjs";
import { itemText } from "../../lib/item-text";
import { parseUserRefs } from "../../lib/user-refs";
import { isHiddenNoticeBlock } from "../../lib/visible-group-blocks.mjs";
import { isTurnRunning } from "../../lib/turn-fold";
import { describeTurnStop } from "../../lib/turn-stop-reason.mjs";
import type { Turn } from "../../lib/turn";
import type { SystemEvent } from "../app-view/types";
import { markBroadcastSeen, pushBroadcast, type BroadcastItem } from "./store";

/** 只扫最近几个回合：群事件总是紧邻当前（更早的已经播过，且历史里也有）。 */
const GROUP_SCAN_TURNS = 3;

export function BroadcastCollector({ thread, systemEvents, activityLabel }: {
  thread?: { id?: string; turns?: Turn[] } | null;
  systemEvents?: SystemEvent[];
  activityLabel?: string;
}) {
  /* ── ① 群事件 ─────────────────────────────────────────────────────────── */
  const primedThreadRef = useRef<string>("");
  const primedRef = useRef(false);

  useEffect(() => {
    const id = String(thread?.id ?? "");
    if (!id) return;
    if (primedThreadRef.current !== id) {
      primedThreadRef.current = id;
      primedRef.current = false;   // 新会话：先静默对齐基线
    }
    const turns = thread?.turns ?? [];
    if (!turns.length) return;     // 历史还没加载完 —— 这时判"增量"会把整段历史当新事件

    const found: BroadcastItem[] = [];
    for (const turn of turns.slice(-GROUP_SCAN_TURNS)) {
      for (const item of turn.items ?? []) {
        if (item?.type !== "userMessage") continue;
        const raw = itemText(item);
        if (!raw.includes("[群事件]")) continue;   // 快速过滤：绝大多数字符串在这里就出局
        const blocks = (parseUserRefs(raw).groupEvents ?? []).filter((block) => !isHiddenNoticeBlock(block));
        blocks.forEach((block, index) => {
          const entry = toBroadcast(id, String(item.id ?? ""), index, block);
          if (entry) found.push(entry);
        });
      }
    }

    if (!primedRef.current) {
      primedRef.current = true;
      markBroadcastSeen(found.map((entry) => entry.id));
      return;
    }
    for (const entry of found) pushBroadcast(entry);
  }, [thread]);

  /* ── ② 系统提示 ─────────────────────────────────────────────────────── */
  const seenSystemRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const list = systemEvents ?? [];
    if (seenSystemRef.current === null) {
      seenSystemRef.current = new Set(list.map((event) => String(event.id)));
      return;
    }
    for (const event of list) {
      const key = String(event.id ?? "");
      if (!key || seenSystemRef.current.has(key)) continue;
      seenSystemRef.current.add(key);
      pushBroadcast({
        id: `s:${key}`,
        kind: "system",
        title: String(event.title ?? "").trim() || "系统提示",
        text: String(event.text ?? "").trim() || undefined,
        tone: event.tone === "success" ? "ok" : event.tone === "error" ? "error" : event.tone === "warning" ? "warn" : "info",
        threadId: String(thread?.id ?? "") || undefined,
      });
    }
  }, [systemEvents, thread?.id]);

  /* ── ③ 回合异常结束 ─────────────────────────────────────────────────── */
  const prevTurnRef = useRef<{ id: string; running: boolean } | null>(null);
  useEffect(() => {
    const turns = thread?.turns ?? [];
    const last = turns[turns.length - 1];
    if (!last) return;
    const running = isTurnRunning(last);
    const prev = prevTurnRef.current;
    prevTurnRef.current = { id: String(last.id), running };
    /* 只在「同一个回合由跑到停」这一刻播：切会话首帧（prev 为空）、换回合、本来就没跑 —— 全部跳过 */
    if (!prev || prev.id !== String(last.id) || !prev.running || running) return;
    const stop = describeTurnStop(last);
    if (!stop?.label) return;
    pushBroadcast({
      id: `t:${String(last.id)}:${stop.kind}`,
      kind: "turn",
      title: stop.label,
      text: String(stop.detail ?? "").split("\n")[0] || undefined,
      tone: stop.kind === "interrupted" ? "warn" : "error",
      threadId: String(thread?.id ?? "") || undefined,
    });
  }, [thread?.turns, thread?.id]);

  /* ── ④ 等待你确认 ───────────────────────────────────────────────────── */
  const prevActivityRef = useRef("");
  useEffect(() => {
    const label = String(activityLabel ?? "");
    const isWaiting = /等待你确认|等待确认|待审批/.test(label);
    const wasWaiting = /等待你确认|等待确认|待审批/.test(prevActivityRef.current);
    prevActivityRef.current = label;
    if (!isWaiting || wasWaiting) return;
    pushBroadcast({
      /* 按「分钟」去重：同一个等待确认被反复刷新时不会刷屏（它本来会随心跳变化重发） */
      id: `ap:${String(thread?.id ?? "")}:${label}:${Math.floor(Date.now() / 60000)}`,
      kind: "approval",
      title: label,
      text: "回合在等你确认后才能继续（去输入框上方的确认卡处理）",
      tone: "warn",
      threadId: String(thread?.id ?? "") || undefined,
    });
  }, [activityLabel, thread?.id]);

  return null;
}

/* ── 群事件块 → 播报条目（纯函数，便于单测/守卫） ───────────────────────── */

function toBroadcast(threadId: string, itemId: string, index: number, block: GroupEventBlock): BroadcastItem | null {
  const base = { id: `g:${itemId}:${index}`, threadId, at: Date.now() };
  if (block.type === "notice") {
    const text = String(block.text ?? "").trim();
    if (!text) return null;
    return { ...base, kind: "group", title: headOf(text, 48), text, tone: "info" };
  }
  if (block.type === "deliverable") {
    const title = booked(block.title);
    return {
      ...base,
      kind: "group",
      title: `${block.who} 交活 ${title}`,
      text: [block.body ? excerpt(block.body, 400) : "", block.file ? `成品：${block.file}` : ""].filter(Boolean).join("\n") || undefined,
      tone: "ok",
      tags: block.file ? [fileNameOf(block.file)] : undefined,
    };
  }
  if (block.type === "batch") {
    return {
      ...base,
      kind: "group",
      title: `本轮交活 ${block.count} 份`,
      text: block.items.map((entry) => `· ${entry.who} ${booked(entry.title)}${entry.summary ? `：${excerpt(entry.summary, 80)}` : ""}`).join("\n"),
      tone: "ok",
    };
  }
  if (block.type === "verdict") {
    return {
      ...base,
      kind: "group",
      title: `${block.who} ${block.passed ? "通过" : "打回"} ${booked(block.title)}${block.reviewer ? ` · ${block.reviewer}判定` : ""}`,
      text: block.reasons ? excerpt(block.reasons, 400) : undefined,
      tone: block.passed ? "ok" : "warn",
    };
  }
  /* review：中枢评审请求（含验收标准），主体是给中枢的机器指令 ⇒ 只播摘要 */
  const titles = Array.isArray(block.titles) ? block.titles.filter(Boolean) : [];
  return {
    ...base,
    kind: "group",
    title: block.count > 1 ? `${block.count} 条任务待评审` : `待评审 ${booked(titles[0])}`,
    text: block.output ? excerpt(block.output, 400) : undefined,
    tone: "info",
  };
}

/** 书名号包裹（幂等）：标题常自带《》，再包一层就成《出《…》》 —— 与群汇报卡同一口径。 */
function booked(title: string | undefined | null): string {
  const text = String(title ?? "").trim() || "任务";
  return /《[^》]+》/.test(text) ? text : `《${text}》`;
}

function headOf(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function excerpt(text: string, max: number): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function fileNameOf(path: string): string {
  const parts = String(path ?? "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
