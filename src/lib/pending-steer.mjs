/**
 * 插队消息的「待并入」登记（11-05 用户令）：
 *   「只有在运行过程中，模型还在处理个消息的时候，可以撤，一旦模型开始处理插队消息后，就不能撤回了」
 *   「可以撤回的时候，在用户消息下面加一个可以撤回图标；不能撤回[的时候]自己就不显示了」
 *
 * ⛔ 为什么必须**先不交给引擎**：引擎的 `turn/steer` 一旦收到就没有撤回接口（协议里只有 turn/steer /
 *    turn/interrupt，没有"取消已投递输入"）。要支持撤回，唯一诚实的做法是**用户点「立即」时先留在队列里**，
 *    等当前这一步跑完（回合内已无进行中的 item）再真正 steer —— 那段等待就是可撤回窗口。
 *
 * 两态（决定界面上那条「撤回」图标在不在）：
 *   · `armed`   —— 已登记、还没交给引擎 ⇒ 消息以用户气泡出现在对话里 + 下面挂「撤回」图标；
 *   · `sending` —— 边界到了、steer 正在飞 ⇒ 气泡继续留着（⛔ 不能提前消失，否则 RPC 那几百毫秒
 *                  消息凭空没了），但撤回图标消失（引擎已经收到，撤回不了）。
 *   交付落定（成功 / 失败 / 已被引擎启动）⇒ `settlePendingSteers` 摘掉，真实回声接管原位渲染。
 *
 * 状态放模块级 Map + 订阅（不持久化）：排队消息本身就在引擎内存里，应用退出即一并失效，两者生命周期一致。
 */
import { useSyncExternalStore } from "react";

const EMPTY = [];
const pending = new Map(); // threadId -> Map(queuedSubmissionId -> { threadId, id, entry, state, armedAt })
const listeners = new Set();

function notify() { for (const listener of [...listeners]) listener(); }

/** React 订阅：登记表的任何变化（登记 / 撤回 / 起飞 / 落定）都要让界面当场重画。 */
export function subscribePendingSteers(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 登记（或把 sending 退回 armed）一条待并入的插队消息（`payload.entry` 是引擎队列里的 QueueItem，
 *  派发时要用它的 input / clientUserMessageId）。 */
export function armPendingSteer(payload) {
  const threadId = String(payload?.threadId ?? "");
  const id = String(payload?.id ?? "");
  if (!threadId || !id) return false;
  let map = pending.get(threadId);
  if (!map) {
    map = new Map();
    pending.set(threadId, map);
  }
  map.set(id, { threadId, id, entry: payload.entry, state: "armed", armedAt: Date.now() });
  notify();
  return true;
}

/** 撤回：用户删除这条排队消息时一并取消（⛔ 只撤 armed —— sending 已经交给引擎，撤不了；
 *  没登记过也无害）。 */
export function cancelPendingSteer(threadId, id) {
  const key = String(threadId ?? "");
  const map = pending.get(key);
  if (!map) return false;
  const record = map.get(String(id ?? ""));
  if (!record || record.state !== "armed") return false;
  map.delete(String(id ?? ""));
  if (!map.size) dropThread(key);
  notify();
  return true;
}

export function isPendingSteer(threadId, id) {
  return mapOf(threadId)?.get(String(id ?? ""))?.state === "armed";
}

function mapOf(threadId) {
  return pending.get(String(threadId ?? ""));
}

function idsOf(threadId, state) {
  const map = mapOf(threadId);
  if (!map) return EMPTY;
  const out = [];
  for (const [id, record] of map) if (!state || record.state === state) out.push(id);
  return out;
}

/** 仍可撤回（armed）的消息 id —— 排队面板的「撤回」与对话里的撤回图标都以此为准。 */
export function pendingSteerIds(threadId) {
  return idsOf(threadId, "armed");
}

/** 界面上已经作为用户气泡现身的消息 id（armed + sending）：排队面板要**隐藏**它们，
 *  否则同一条消息在对话和排队面板各出现一次（用户点过「两处重复」这类问题）。 */
export function pendingSteerVisibleIds(threadId) {
  return idsOf(threadId);
}

/** 界面上要画的气泡（含 input 原文）：armed 在前、sending 在后，按登记顺序。 */
export function pendingSteerEntries(threadId) {
  const map = mapOf(threadId);
  if (!map) return EMPTY;
  return [...map.values()].map((record) => record.entry);
}

export function hasPendingSteers(threadId) {
  return idsOf(threadId, "armed").length > 0;
}

/** 到边界了：把 armed 翻成 sending（气泡留着、撤回图标消失）并交还条目给调用方真正 steer。 */
export function takePendingSteers(threadId) {
  const map = mapOf(threadId);
  if (!map || !map.size) return [];
  const entries = [];
  for (const record of map.values()) {
    if (record.state !== "armed") continue;
    record.state = "sending";
    entries.push(record.entry);
  }
  if (entries.length) notify();
  return entries;
}

/** 交付落定（成功、失败、或引擎已经自己启动）⇒ 这条从界面上摘掉，交给引擎的真实回声。 */
export function settlePendingSteers(threadId, ids) {
  const key = String(threadId ?? "");
  const map = pending.get(key);
  if (!map) return;
  let changed = false;
  for (const id of ids ?? []) if (map.delete(String(id))) changed = true;
  if (!map.size) dropThread(key);
  if (changed) notify();
}

/* 会话空了就把三份表一起摘掉：切走/删掉的会话不许在模块级 Map 里越积越多。 */
function dropThread(key) {
  pending.delete(key);
  snapshots.delete(key);
  visibleSnapshots.delete(key);
}

/** 本会话界面上可见的插队条目（订阅登记表 ⇒ 登记/撤回/派发当场重画）。 */
export function usePendingSteerEntries(threadId) {
  return useSyncExternalStore(subscribePendingSteers, () => pendingSteerSnapshot(String(threadId ?? "")));
}

/** 排队面板要隐藏的 id 名单（armed + sending）。⛔ 必须走订阅：不订阅直接读的话，
 *  面板的隐藏名单会比气泡慢一拍 ⇒ 同一条消息在面板和对话里各出现一次。 */
export function usePendingSteerVisibleIds(threadId) {
  const key = String(threadId ?? "");
  return useSyncExternalStore(subscribePendingSteers, () => {
    const ids = pendingSteerVisibleIds(key);
    const signature = ids.join(",");
    const cached = visibleSnapshots.get(key);
    if (cached && cached.signature === signature) return cached.value;
    visibleSnapshots.set(key, { signature, value: ids });
    return ids;
  });
}
const visibleSnapshots = new Map();

/* useSyncExternalStore 的 getSnapshot 必须返回**同一引用**（每次新数组会让 React 无限重渲染），
   所以按「id:state 序列」做签名，签名没变就交还上次那个数组。 */
const snapshots = new Map(); // threadId -> { signature, value }
export function pendingSteerSnapshot(threadId) {
  const map = mapOf(threadId);
  const signature = map ? [...map.values()].map((record) => `${record.id}:${record.state}`).join(",") : "";
  const cached = snapshots.get(threadId);
  if (cached && cached.signature === signature) return cached.value;
  const value = map ? [...map.values()].map((record) => record.entry) : EMPTY;
  snapshots.set(threadId, { signature, value });
  return value;
}

/**
 * 回合「当前这一步」还在处理中吗 —— 派发边界的判据（可撤回窗口是否还开着）。
 * · 任一项 inProgress/running ⇒ 在忙；
 * · 最后一项没有 status 也没有 durationMs ⇒ 流式中的 item 常常先建后补状态，按在忙算（口径与运行状态行同源）；
 * · **一步都还没有 ⇒ 也算在忙**：否则刚 `turn/start` 那一帧就是边界，用户点完「立即」还没反应过来就已派发，
 *   可撤回窗口宽度为 0，等于没有这个功能。
 */
export function turnStepBusy(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  if (!items.length) return true;
  return items.some((item, index) =>
    item?.status === "inProgress" || item?.status === "running"
    || (!item?.status && !item?.durationMs && index === items.length - 1));
}
