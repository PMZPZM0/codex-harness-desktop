/**
 * 群成员的**实时状态**（渲染层共享 store）。
 *
 * ⛔⛔ 10-26 用户令：「成员和轨道头像显示的状态，联动起来」
 *   —— 原实现里，顶栏「群成员」面板自己每 5 秒轮询一次 `bossGroupStatus`，
 *   别的组件（将来的右侧成员轨道）要显示成员状态就得**再轮询一遍**
 *   ⇒ 两处状态会**不一致**（面板说"正在做"、轨道说"空闲"），用户看着就是"联动性差"。
 *   ⇒ 这里做**唯一一份**群成员快照：谁在什么时候拉、拉到的结果广播给所有订阅方。
 *
 * ⛔ 真相源仍是**主进程**（`boss-groups:status` → boss-groups.json）；
 *   这个 store 只是渲染层的一份缓存 + 订阅中枢（不新增真相源）。
 *
 * 用法：
 *   const snap = useGroupMembers(groupId);   // { members, loading, error }
 *   invalidateGroupMembers();                // 拉人/移人后主动失效
 */
import { useEffect, useState, useSyncExternalStore } from "react";

export type GroupMemberLive = {
  id: string;
  name: string;
  role: string;
  status: string;
  lockedTaskIds: string[];
  source?: string;
  threadId?: string;
};

/** ⛔ 10-27 用户令：「办公室预览没有同步刷新员工数量，现在就剩三个，他还显示有删除过的员工」
 *  ⇒ 成员快照里带着 `removed`（那是有意的：成员面板要单列「已移出」），
 *    但**办公室 / 成员轨 / 人数统计**只该看在群的人 ⇒ 统一用这个口径过滤，别各处自己写 filter。 */
export function activeMembersOf(members: GroupMemberLive[]): GroupMemberLive[] {
  return (members ?? []).filter((m) => String(m?.status ?? "") !== "removed");
}

export type GroupLiveSnapshot = {
  groupId: string;
  name: string;
  members: GroupMemberLive[];
  paused?: boolean;
};

type Entry = { snapshot: GroupLiveSnapshot | null; updatedAt: number; loading: boolean };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** 正在拉的群（避免并发重复请求）。 */
const inflight = new Map<string, Promise<void>>();

function emit() { for (const fn of listeners) fn(); }
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** 某群的最新快照（没拉过 ⇒ null）。 */
export function groupSnapshotOf(groupId: string): GroupLiveSnapshot | null {
  return cache.get(String(groupId ?? ""))?.snapshot ?? null;
}

/** 标记某群的数据已过期（拉人/移人/成员状态变化后调用）。 */
export function invalidateGroupMembers(groupId = "") {
  const key = String(groupId ?? "");
  if (!key) { cache.clear(); emit(); return; }
  cache.delete(key);
  emit();
}

/** 拉取某群状态并广播（幂等：并发同群只发一次请求）。 */
export async function refreshGroupMembers(groupId: string): Promise<void> {
  const key = String(groupId ?? "");
  if (!key) return;
  const running = inflight.get(key);
  if (running) return running;
  const task = (async () => {
    try {
      const snap: any = await window.codex.bossGroupStatus(key);
      cache.set(key, {
        snapshot: {
          groupId: key,
          name: String(snap?.group?.name ?? ""),
          members: Array.isArray(snap?.group?.members) ? snap.group.members : [],
          paused: Boolean(snap?.group?.paused),
        },
        updatedAt: Date.now(),
        loading: false,
      });
    } catch {
      cache.set(key, { snapshot: cache.get(key)?.snapshot ?? null, updatedAt: Date.now(), loading: false });
    } finally {
      inflight.delete(key);
      emit();
    }
  })();
  inflight.set(key, task);
  return task;
}

/* ── React 绑定 ─────────────────────────────────────────────────────────── */

const EMPTY: GroupLiveSnapshot = { groupId: "", name: "", members: [] };

/**
 * 订阅某群的成员快照。
 * ⛔ 没有 groupId ⇒ 返回空快照（不请求）。
 * ⛔ 轮询间隔 4 秒（比面板原来的 5 秒略快：轨道要即时反馈"谁在干活"）。
 */
export function useGroupMembers(groupId: string): { snapshot: GroupLiveSnapshot; loading: boolean } {
  const key = String(groupId ?? "");
  const entry = useSyncExternalStore(subscribe, () => cache.get(key) ?? null, () => null);
  useEffect(() => {
    if (!key) return;
    void refreshGroupMembers(key);
    const timer = setInterval(() => { void refreshGroupMembers(key); }, 4000);
    const off = window.codex.onEvent((event: any) => {
      /* 群事件（派活/交活/拉人/移人）⇒ 立刻重拉（不等下一个轮询周期）。 */
      if (event?.type === "boss-group") void refreshGroupMembers(key);
    });
    return () => { clearInterval(timer); off?.(); };
  }, [key]);
  return {
    snapshot: entry?.snapshot ?? EMPTY,
    loading: entry?.loading ?? false,
  };
}
