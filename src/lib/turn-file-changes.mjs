// 回合文件变更报告的渲染层仓库（模块级单例，不进 bag——同 stream.ts 的 buffered 前例）。
// 主进程广播两类 harness:event（都经 window.codex.onHarnessEvent 以裸 payload 递进来）：
//   · turn-file-changes      —— 回合收尾的最终汇报（「已更改 N 个文件」卡）
//   · turn-file-changes-live —— 运行中每 ~2.5s 的累计改动（「正在编辑文件」板块，实时 +N -M）
// ⛔ turnId 是**回合 id**（渲染层按 `turn.id` / DOM `#turn-<uuid>` 取报告），不是线程 id。
// ⛔ 收件通道 = `window.codex.onHarnessEvent`；不走 `window.addEventListener("message")`
//   （全仓没有任何地方向 window 派发带 channel 的 MessageEvent，10-06 实证是死信道）。
/* ⛔⛔ 11-08 用户实测（「一发消息就界面报渲染错误」）：这三个 getter 被 useSyncExternalStore 当快照用，
   空的时候每次 new [] ⇒ React 判定快照不稳定 ⇒ 无限重渲染（Maximum update depth / getSnapshot should be cached）。
   ⇒ 空列表返回**同一个**冻结常量。 */
const EMPTY_FILES = Object.freeze([]);
const reports = new Map();
const liveReports = new Map();
/* 11-21 用户实测「生图插件出的图，汇总下面没有缩略图」：
   生图/修图是**宿主行为**（image-lab 直接写盘），引擎不会为它发 fileChange，
   回合文件追踪自然看不到 ⇒ 这里单独登记「本回合宿主生成的文件」，与最终报告合并。 */
const generatedByTurn = new Map();

/* ⛔⛔ 11-24 用户实测（「刷新一下或者重启一下，汇总消息下面的图片缩略图就不见了」）：
   `generatedByTurn` 只是内存 Map —— 刷新/重启即清空，于是 11-21 那条修复只对**当轮**有效：
   重启后回放，图片缩略图全没了（引擎那边不会补 fileChange，宿主也不重发事件）。
   落一份 localStorage：只存「回合 id → 宿主生成的文件路径」，每条几十字节，量很小。
   上限按回合数截断（只留最近的），⛔ 不做「永不清理」——那会变成第二个日志库。 */
const PERSIST_KEY = "harness.turn-generated-files.v1";
const PERSIST_LIMIT = 200;
const canPersist = typeof localStorage !== "undefined";

/** 读持久化表（坏数据/隐私模式一律当空表，不抛）。 */
function readPersistedGenerated() {
  if (!canPersist) return new Map();
  try {
    const parsed = JSON.parse(localStorage.getItem(PERSIST_KEY) || "{}");
    const map = new Map();
    for (const [turnId, paths] of Object.entries(parsed ?? {})) {
      if (!Array.isArray(paths)) continue;
      const clean = paths.map((value) => String(value ?? "").trim()).filter(Boolean);
      if (clean.length) map.set(String(turnId), clean);
    }
    return map;
  } catch { return new Map(); }
}

/** 写回持久化表（读-改-写；超上限丢最旧的回合）。 */
function writePersistedGenerated(turnId, paths) {
  if (!canPersist || !paths.length) return;
  try {
    const all = readPersistedGenerated();
    all.set(String(turnId), paths);
    while (all.size > PERSIST_LIMIT) all.delete(all.keys().next().value);
    localStorage.setItem(PERSIST_KEY, JSON.stringify(Object.fromEntries(all)));
  } catch { /* 隐私模式 / 配额满：放弃持久化，不影响本轮 */ }
}

/** 从持久化恢复：一起写回 generatedByTurn（合并口径）与 reports（汇总卡读的是它）。 */
function restorePersistedGenerated() {
  for (const [turnId, paths] of readPersistedGenerated()) {
    const map = new Map();
    for (const path of paths) map.set(path, { path, added: 0, deleted: 0, status: "added", generated: true });
    generatedByTurn.set(turnId, map);
    reports.set(turnId, mergeGenerated(turnId, reports.get(turnId) ?? []));
  }
}

function mergeGenerated(turnId, files) {
  const extra = generatedByTurn.get(String(turnId ?? ""));
  if (!extra?.size) return files;
  const byPath = new Map();
  for (const file of Array.isArray(files) ? files : []) byPath.set(String(file?.path ?? ""), file);
  for (const [path, entry] of extra) if (!byPath.has(path)) byPath.set(path, entry);
  return [...byPath.values()];
}
/* ⛔ 11-08：群聊流式卡按**线程**取实时编辑明细（群视图不知道回合 id）——
   同一条 turn-file-changes-live 同时记两份，收尾报告到达时按线程清场。 */
const liveByThread = new Map();
const listeners = new Set();

function notify(turnId) {
  for (const fn of listeners) { try { fn(turnId); } catch { /* 订阅者异常互不影响 */ } }
}

/* 模块加载即回填（重启/刷新后的第一次渲染就能看到上一轮的缩略图）。 */
restorePersistedGenerated();

if (typeof window !== "undefined" && typeof window.codex?.onHarnessEvent === "function") {
  window.codex.onHarnessEvent((payload) => {
    const type = payload?.type;
    if (type !== "turn-file-changes" && type !== "turn-file-changes-live") return;
    const turnId = String(payload.turnId ?? "");
    const threadId = String(payload.threadId ?? "");
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (type === "turn-file-changes") {
      reports.set(turnId, mergeGenerated(turnId, files));
      liveReports.delete(turnId); // 最终报告落地 = 收尾，live 清场（避免两卡并存）
      if (threadId) liveByThread.delete(threadId);
    } else if (files.length) {
      liveReports.set(turnId, files);
      if (threadId) liveByThread.set(threadId, files);
    } else {
      liveReports.delete(turnId);
    }
    notify(turnId);
  });
}

/** 某回合的宿主追踪文件变更**最终报告**（没有 = 空数组） */
export function getTurnFileChanges(turnId) {
  return reports.get(String(turnId ?? "")) ?? EMPTY_FILES;
}

/** 某回合**运行中**的实时累计改动（没有 = 空数组；回合收尾会被最终报告清场） */
export function getTurnLiveFileChanges(turnId) {
  return liveReports.get(String(turnId ?? "")) ?? EMPTY_FILES;
}

/** 某线程**运行中**的实时累计改动（群聊流式卡用；收尾报告到达即清场） */
export function getThreadLiveFileChanges(threadId) {
  return liveByThread.get(String(threadId ?? "")) ?? EMPTY_FILES;
}

/** 登记「宿主工具直接生成的文件」（生图 / 修图）：引擎不会为宿主写盘发 fileChange，
 *  不进这里的话「本轮产物」与已更改文件永远看不到这些图。
 *  ⛔ 只在渲染层记（路径来自宿主返回值）；重复登记按路径去重；最终报告到达时会与之合并。 */
export function noteGeneratedFiles(turnId, paths) {
  const id = String(turnId ?? "");
  if (!id) return;
  const list = Array.isArray(paths) ? paths.map((p) => String(p ?? "").trim()).filter(Boolean) : [];
  if (!list.length) return;
  const map = generatedByTurn.get(id) ?? new Map();
  for (const path of list) map.set(path, { path, added: 0, deleted: 0, status: "added", generated: true });
  generatedByTurn.set(id, map);
  reports.set(id, mergeGenerated(id, reports.get(id) ?? []));
  /* 11-24：同轮回写持久化 —— 否则重启后这张图就只剩正文里的一行路径。 */
  writePersistedGenerated(id, [...map.keys()]);
  notify(id);
}

/** 两类事件任一到达都会通知（订阅方自己决定读哪个 getter） */
export function subscribeTurnFileChanges(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
