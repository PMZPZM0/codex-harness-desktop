/**
 * 手机前端UI（`ui-sketch` 域，展示名 10-05 夜从「界面草图」改来）· 宿主 ↔ 桥的会话单例（跨源 iframe 的收发中枢）
 *
 * 草图站跑在 `sketch://app` 源里、嵌在 iframe 中，宿主**只有** postMessage 一条路。
 * 模态窗自己持有一条消息流（取回画布 / 复制 JSON / 更新「N 屏 / M 部件」），
 * Codex 的工具调用（`mobile_ui_get_doc` / `mobile_ui_apply_doc`）是**另一个入口** ——
 * 两个入口若各持一份状态，就会出现"窗口里看着是 A、工具读到的是 B"。
 * ⇒ 本模块是**唯一**的就绪态与在飞请求表：模态负责 attach / feed（它持有 iframe），
 *   工具只发请求。模态自己的展示仍走它原有的监听，两者共用同一份消息源。
 *
 * 典型时序（一次写入从发起到落定）：
 *   attachSketchFrame → 桥 `ready`/`doc` → waitSketchReady 通过 → applySketchDoc
 *   → 桥设分享哈希 → 上游 hashchange → arrive() → 桥 `load-doc-result` → resolve。
 * ⛔ 全是**跨源盲飞**：拿不到对端的 DOM 与异常，一切以桥回传的消息为准；
 *   超时即失败，绝无"乐观成功"（跨源里发出去的消息没有回执，乐观 = 假绿源头）。
 * ⛔ 本文件必须能在 node 里 import（守卫【283】真跑它）：顶层不许碰 window / document。
 */
import { SKETCH_BRIDGE_SOURCE } from "./sketch-doc.mjs";

/** 就绪等待上限：本地协议加载 4.2MB 产物一般 <1s，15s 是"慢盘 + 冷启动"的宽裕值。 */
export const SKETCH_READY_TIMEOUT_MS = 15000;
/** 单次请求回执上限：桥最坏路径 = 编码 + 20×150ms 轮询 ≈ 4s，10s 留一倍余量。 */
export const SKETCH_REPLY_TIMEOUT_MS = 10000;

let frameWindow = null;   // 当前 iframe 的 contentWindow（attached 才有）
let lastWindow = null;    // 上一次 attach 的窗口对象 —— 用来区分"真重开"与 React StrictMode 重挂载
let ready = false;        // 桥至少回过一次 ready / doc
const readyWaiters = [];  // { resolve, reject, timer }
const pending = [];       // { type: "doc" | "load-doc-result", resolve, reject, timer }

/** 串行队列：load-doc 与 get-doc 不许相交（两次 hash 写入会互相踩，轮询会读到对方的中间态）。 */
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function postToFrame(message) {
  if (!frameWindow) return false;
  try {
    frameWindow.postMessage({ ...message, source: SKETCH_BRIDGE_SOURCE }, "*");
    return true;
  } catch (error) {
    return false;
  }
}

/** 模态挂载时调用（持有 iframe 的组件负责）。传同一个窗口 = 重挂载，不重置就绪态。 */
export function attachSketchFrame(win) {
  if (!win) return;
  frameWindow = win;
  if (win !== lastWindow) {
    /* 新的窗口 = iframe 真的重建过：上一次会话的就绪态作废，等桥重新 ready。
       ⛔ StrictMode（dev）会把 effect 的清理与再挂载放在同一提交里跑 —— 同一个
       contentWindow 对象会再 attach 一次，这里认出来后**不能**把 ready 打回 false：
       桥只在加载时 post 一次 ready，重置了就再也等不到（表现为工具调用超时）。 */
    ready = false;
    lastWindow = win;
  }
}

/** 模态卸载时调用。就绪态**不在这里清**（见 attach 注释：StrictMode 会紧跟着再 attach）。 */
export function detachSketchFrame() {
  frameWindow = null;
  /* ⛔ 延迟一拍再判"真关闭"：StrictMode 的 清理→再挂载 是同一提交内同步完成的，
     同步拒绝会把马上要重挂载的在飞请求误杀。0ms 后窗口还没回来才算真关。 */
  setTimeout(() => {
    if (frameWindow) return;
    const why = new Error("手机前端UI窗口被关掉了");
    for (const waiter of readyWaiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(why); }
    for (const entry of pending.splice(0)) { clearTimeout(entry.timer); entry.reject(why); }
  }, 0);
}

/** 模态的消息监听把每条**桥的**消息原样转进来（入站校验仍由模态做一次、这里再做一次）。 */
export function feedSketchMessage(data) {
  if (!data || data.source !== SKETCH_BRIDGE_SOURCE) return;
  if (data.type === "ready" || data.type === "doc") {
    ready = true;
    for (const waiter of readyWaiters.splice(0)) { clearTimeout(waiter.timer); waiter.resolve(); }
  }
  const reply = pending[0];
  if (!reply || reply.type !== data.type) return;
  pending.shift();
  clearTimeout(reply.timer);
  if (data.type === "doc") reply.resolve({ doc: data.doc ?? null, diag: data.diag ?? null });
  else reply.resolve({ ok: data.ok === true, doc: data.doc ?? null, error: typeof data.error === "string" ? data.error : "" });
}

/** 窗口已挂且桥答过话。工具入口在发请求前先过这里 + waitSketchReady。 */
export function isSketchReady() {
  return !!(frameWindow && ready);
}

/** 等到桥就绪（工具调用自动开窗后用它；已就绪时同步通过）。 */
export function waitSketchReady(timeoutMs = SKETCH_READY_TIMEOUT_MS) {
  if (isSketchReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      const index = readyWaiters.indexOf(waiter);
      if (index >= 0) readyWaiters.splice(index, 1);
      reject(new Error(`手机前端UI 在 ${Math.round(timeoutMs / 1000)} 秒内没有就绪 —— 多半是 dist/sketch 产物缺失（跑 npm run build），或 iframe 没打开`));
    }, timeoutMs);
    readyWaiters.push(waiter);
  });
}

function expectReply(type, post, timeoutMessage) {
  if (!isSketchReady()) return Promise.reject(new Error("「手机前端UI」还没就绪 —— 先打开它等画布加载完"));
  return new Promise((resolve, reject) => {
    const entry = { type, resolve, reject, timer: null };
    entry.timer = setTimeout(() => {
      const index = pending.indexOf(entry);
      if (index >= 0) pending.splice(index, 1);
      reject(new Error(timeoutMessage));
    }, SKETCH_REPLY_TIMEOUT_MS);
    pending.push(entry);
    post();
  });
}

/** 读回当前画布（原样的 m3e:doc 文档 + 桥诊断）。 */
export function requestSketchDoc() {
  return enqueue(() => expectReply("doc", () => { postToFrame({ type: "get-doc" }); },
    "手机前端UI没有在 " + Math.round(SKETCH_REPLY_TIMEOUT_MS / 1000) + " 秒内回传画布"));
}

/** 把文档写回画布 —— 只经上游自己的分享哈希导入，成功与否以桥的 load-doc-result 为准。 */
export function applySketchDoc(doc) {
  return enqueue(() => expectReply("load-doc-result", () => { postToFrame({ type: "load-doc", doc }); },
    "手机前端UI没有在 " + Math.round(SKETCH_REPLY_TIMEOUT_MS / 1000) + " 秒内回报写入结果"));
}
