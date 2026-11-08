/**
 * 团队模式 · 排队消息（11-08 用户令：「排队消息，插队消息，看看跟主对话框还差哪些，没同步过来，都完成一下」）
 *
 * 两条铁律（照主对话）：
 *   ① **卡片本体不重写** —— 直接复用 `features/session-queue` 的 `QueuedMessageList`
 *      （折叠 / 拖排序 / 定时 / 编辑 / 立即 / 删除全部同一套），这里只做**按成员分组**；
 *   ② **载体是引擎队列**（`thread/queue/*`）—— 每个伙伴各跑各的子会话，队列天然按 threadId 分开，
 *      「回合结束自动消费」由引擎负责，宿主不写调度。
 *
 * 「立即」= 插队：交给主进程 `harness-team:queue-start`（它才有活动回合表的真相，
 * 能拿到 `expectedTurnId` 做 `turn/steer`；插不了再退回按新回合启动）。见
 * `electron/features/harness-team-queue.ts`。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueuedMessageList } from "../session-queue";
import { inputText } from "../../lib/input-text";
import type { QueueItem } from "../../lib/queue-item";
import type { HarnessAppApi } from "../app-state";

export type TeamQueueThread = { threadId: string; name: string };

type Entry = { threadId: string; item: QueueItem };

const newClientId = () => `teamq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** 往某个成员会话的引擎队列里塞一条（运行中发消息走这里；空闲时仍走派活）。 */
export async function queueTeamMessage(threadId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const id = String(threadId ?? "").trim();
  const body = String(text ?? "").trim();
  if (!id || !body) return { ok: false, error: "缺会话或正文" };
  try {
    /* ⛔ 用 queue/add 而不是 turn/start：turn/start 会打断那个成员正在跑的回合
       （主进程 codex:request 对「仍有活动回合」的 turn/start 直接抛错）。 */
    await window.codex.request("thread/queue/add", {
      threadId: id,
      input: [{ type: "text", text: body }],
      clientUserMessageId: newClientId(),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function TeamQueueStack({ app, threads, reloadKey, onNotice }: {
  app?: HarnessAppApi;
  threads: TeamQueueThread[];
  /** 变化即重拉（发完消息 / 有回合结束 / 点过动作） */
  reloadKey?: string;
  onNotice?: (text: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const alive = useRef(true);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const refresh = useCallback(async () => {
    const list = threadsRef.current;
    if (!list.length) { if (alive.current) setEntries([]); return; }
    const results = await Promise.all(list.map((thread) =>
      (window.codex.request("thread/queue/list", { threadId: thread.threadId, limit: 50 }) as Promise<{ data?: unknown[] } | null>)
        .catch(() => null)));
    if (!alive.current) return;
    const next: Entry[] = [];
    results.forEach((res, index) => {
      const items = Array.isArray(res?.data) ? res!.data! : [];
      for (const raw of items) {
        const item = raw as { id?: unknown; input?: unknown; clientUserMessageId?: unknown };
        const id = String(item?.id ?? "").trim();
        if (!id) continue;
        next.push({
          threadId: list[index].threadId,
          item: { id, input: Array.isArray(item.input) ? item.input as never[] : [], clientUserMessageId: String(item.clientUserMessageId ?? "") },
        });
      }
    });
    setEntries(next);
  }, []);

  const signature = useMemo(() => threads.map((t) => `${t.threadId}:${t.name}`).join("|"), [threads]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
  }, [refresh, signature, reloadKey]);

  /* 队列是引擎侧状态：没有推送就往回捞（只在有成员会话时才跑；6s 一次，代价很小） */
  useEffect(() => {
    if (!threads.length) return;
    const timer = setInterval(() => { void refresh(); }, 6000);
    return () => clearInterval(timer);
  }, [refresh, threads.length]);

  const byThread = useMemo(() => {
    const map = new Map<string, QueueItem[]>();
    for (const entry of entries) {
      const bucket = map.get(entry.threadId) ?? [];
      bucket.push(entry.item);
      map.set(entry.threadId, bucket);
    }
    return map;
  }, [entries]);

  const threadOf = useCallback((id: string) => entries.find((entry) => entry.item.id === id)?.threadId ?? "", [entries]);

  const remove = useCallback(async (id: string) => {
    const threadId = threadOf(id);
    if (!threadId) return;
    try {
      await window.codex.request("thread/queue/delete", { threadId, queuedSubmissionId: id });
      onNotice?.("已删除这条排队消息");
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "删除失败");
    }
    void refresh();
  }, [refresh, threadOf, onNotice]);

  const start = useCallback(async (id?: string) => {
    const target = id ? threadOf(id) : "";
    if (!id || !target) return;
    const res = await window.codex.harnessTeamQueueStart({ threadId: target, queuedSubmissionId: id });
    onNotice?.(res?.ok
      ? (res.mode === "steer" ? "插队消息已并入（模型下一步就会看到它）" : "排队消息已开始执行")
      : (res?.error || "启动失败"));
    void refresh();
  }, [refresh, threadOf, onNotice]);

  const save = useCallback(async (entry: QueueItem, text: string) => {
    const threadId = threadOf(entry.id);
    const body = String(text ?? "").trim();
    if (!threadId) return;
    if (!body) return;
    try {
      await window.codex.request("thread/queue/delete", { threadId, queuedSubmissionId: entry.id });
      await window.codex.request("thread/queue/add", { threadId, input: [{ type: "text", text: body }], clientUserMessageId: newClientId() });
      onNotice?.("排队消息已更新");
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "更新失败");
    }
    void refresh();
  }, [refresh, threadOf, onNotice]);

  const reorder = useCallback(async (from: number, to: number) => {
    if (from === to) return;
    const moved = entries[from];
    if (!moved) return;
    const ids = byThread.get(moved.threadId)?.map((item) => item.id) ?? [];
    const fromInThread = ids.indexOf(moved.item.id);
    if (fromInThread < 0) return;
    const target = entries[to];
    const toInThread = target && target.threadId === moved.threadId ? ids.indexOf(target.item.id) : ids.length - 1;
    if (toInThread < 0) return;
    const next = [...ids];
    next.splice(fromInThread, 1);
    next.splice(toInThread, 0, moved.item.id);
    try {
      await window.codex.request("thread/queue/reorder", { threadId: moved.threadId, queuedSubmissionIds: next });
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "排序失败");
    }
    void refresh();
  }, [entries, byThread, refresh, onNotice]);

  const setTimer = useCallback(async (entry: QueueItem, runAt: number | null) => {
    const threadId = threadOf(entry.id);
    if (!threadId) return;
    try {
      if (runAt == null) {
        await window.codex.queueTimerCancel({ queuedSubmissionId: entry.id });
        setTimers((prev) => { const next = { ...prev }; delete next[entry.id]; return next; });
      } else {
        await window.codex.queueTimerSet({ threadId, queuedSubmissionId: entry.id, runAt });
        setTimers((prev) => ({ ...prev, [entry.id]: runAt }));
      }
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "定时设置失败");
    }
  }, [threadOf, onNotice]);

  const quote = useCallback((text: string) => {
    /* 引用 = 把那段原文塞回群输入框（主对话也是把引用挂到输入框，不新造一个面板） */
    const body = String(text ?? "").trim();
    if (!body) return;
    onNotice?.(body);
  }, [onNotice]);

  if (!entries.length) return null;

  return (
    <div className="team-queue" aria-label="排队消息">
      {threads.map((thread) => {
        const items = byThread.get(thread.threadId) ?? [];
        if (!items.length) return null;
        return (
          <div className="team-queue__group" key={thread.threadId}>
            <span className="team-queue__who" title={`发给 ${thread.name}`}>@{thread.name}</span>
            <QueuedMessageList
              entries={items}
              timers={timers}
              onSetTimer={(entry, runAt) => void setTimer(entry, runAt)}
              onOpenFile={(path) => void app?.openFile?.(path)}
              onQuote={quote}
              onDelete={(id) => void remove(id)}
              onStart={(id) => void start(id)}
              onSave={(entry, text) => void save(entry, text)}
              onReorder={(from, to) => void reorder(from, to)}
              dragIndex={dragIndex}
              setDragIndex={setDragIndex}
            />
          </div>
        );
      })}
    </div>
  );
}

/** 给视图用的口径：这条排队消息的正文（主对话同一函数，⛔ 别自己拼 part 数组）。 */
export const queueTextOf = (item: QueueItem) => inputText(item.input);
