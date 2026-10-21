/**
 * registerVoiceIpc4 —— **播报归属裁决**（10-21 新增，多窗口唯一播报窗口）。
 *
 * 背景（用户令「当多个对话同时运行时，仅应向用户当前所在的会话窗口播报」）：
 *   `codex:event` 是 `broadcastToAll`（主窗口 + 所有独立会话弹窗都收），每个窗口的
 *   AppView 都挂 `VoiceAnnounceBridge`、各自有 AudioContext 与播放队列 ⇒ 现状有两类冲突：
 *     ① 两窗口看**不同会话**且同时有输出 ⇒ 两段语音同时出声（叠加）；
 *     ② 同一会话开主窗口 + 弹窗（`?popout=<threadId>`）⇒ 同一句念两遍（回声）。
 *   会话闸（`engine-bridge` 的 threadId 比对）只能挡住「别的会话」，挡不住「同一会话的另一个窗口」。
 *
 * 裁决规则（`pickAnnounceOwner`，纯函数可真跑）：
 *   焦点窗口 → 最后活跃窗口 → 主窗口回退。
 *   ⛔ 为什么「无焦点」不用「全部静音」：用户切到浏览器/编辑器时应用整体失焦，
 *      此时若静音，等于「一离开窗口就听不到」——与「播报是给耳朵的」这个前提冲突。
 *      语义定为「最后活跃的那个窗口继续替你念」。
 *   ⛔ 单窗口时恒为该窗口（reason=single-window）⇒ **零行为变化**，不给单窗口用户引入任何新判定。
 *
 * 静音闩锁**全局**（`voice:announce-set-muted`）：一个扬声器、一个用户 —— 在任一窗口按
 * 「停止播报」就该全窗口安静，否则另一窗口继续念 = 用户体感「按钮是假的」。
 *
 * 广播方式：`voice:announce-owner-changed` 与 `voice:announce-muted` 都是**逐窗口定制发送**
 * （owner 是布尔，各窗口答案不同）；⛔ 不能用 `broadcastToAll` 发同一个 payload ——
 * 渲染层拿不到自己的 `webContents.id`，没法自己比对。
 */
import { app, type BrowserWindow } from "electron";
import { allBusWindows, broadcastToAll, onBusWindowListChanged } from "../window-bus";
import type { registerVoiceIpc1 } from "./01-voice-hotkey-models";

/** 裁决候选（纯数据；只取「现在真的能出声」的窗口所需字段，便于真跑测试）。 */
export type OwnerCandidate = {
  id: number;
  focused: boolean;
  visible: boolean;
  minimized: boolean;
};

/** 主进程侧的播报全局状态（进程内单例）。 */
type AnnounceOwnerState = {
  lastFocusedId: number | null;
  mutedAll: boolean;
};

/** 模块级单例：`registerVoiceIpc4` 可能被重复调用（热重载 / 测试），状态不能每次重建。 */
const state: AnnounceOwnerState = { lastFocusedId: null, mutedAll: false };
let wired = false;

/**
 * **owner 裁决（纯函数）**。
 *
 * 顺序：可见且未最小化的窗口 → 焦点命中 → `lastFocusedId` 命中 → 列表首个（主窗口）。
 * ⛔ 排除最小化窗口：最小化时用户看不见任何内容，让它念等于「对着空气说话」。
 * ⛔ `lastFocusedId` 指向的窗口可能已关闭/最小化 ⇒ 逐个校验，校验不过才回退主窗口。
 */
export function pickAnnounceOwner(
  candidates: OwnerCandidate[],
  lastFocusedId: number | null,
): { ownerId: number | null; reason: string } {
  const live = candidates.filter((c) => c.visible && !c.minimized);
  if (!live.length) return { ownerId: null, reason: "no-window" };
  if (live.length === 1) return { ownerId: live[0].id, reason: "single-window" };
  const focused = live.find((c) => c.focused);
  if (focused) return { ownerId: focused.id, reason: "focused" };
  const last = lastFocusedId == null ? undefined : live.find((c) => c.id === lastFocusedId);
  if (last) return { ownerId: last.id, reason: "last-focused" };
  return { ownerId: live[0].id, reason: "primary-fallback" };
}

function candidateOf(win: BrowserWindow): OwnerCandidate | null {
  try {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
    return {
      id: win.webContents.id,
      focused: win.webContents.isFocused(),
      visible: win.isVisible(),
      minimized: win.isMinimized(),
    };
  } catch {
    return null;
  }
}

/** 当前 owner（实时计算，不缓存 —— `isFocused()` 直查比维护状态更不容易漂）。 */
export function resolveAnnounceOwner(): { ownerId: number | null; reason: string } {
  const candidates = allBusWindows()
    .map(candidateOf)
    .filter((c): c is OwnerCandidate => Boolean(c));
  return pickAnnounceOwner(candidates, state.lastFocusedId);
}

/** 逐窗口定制发送 owner 布尔；关窗竞态吞掉。 */
function broadcastOwner() {
  const { ownerId, reason } = resolveAnnounceOwner();
  for (const win of allBusWindows()) {
    try {
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send("voice:announce-owner-changed", { owner: win.webContents.id === ownerId, reason });
    } catch { /* 窗口正在关闭 */ }
  }
}

function broadcastMuted() {
  broadcastToAll("voice:announce-muted", { muted: state.mutedAll });
}

export function registerVoiceIpc4(a: ReturnType<typeof registerVoiceIpc1>) {
  const { ipcHost } = a;

  /* ① 我是播报窗口吗 —— 只回**本窗口的答案**（渲染层拿不到自己的 webContents.id，
     所以比对必须在主进程做）。⛔ 取不到窗口信息时 owner=null ⇒ 返回 owner:true 保底：
     宁可多念一次，也不能因为一次算不出来就让用户永久听不到（与「取不到就静音」相反）。 */
  ipcHost.handle("voice:announce-owner", (event) => {
    const { ownerId, reason } = resolveAnnounceOwner();
    /* ⛔ 必须把**全局静音态**一起带回去（10-21 自查发现的真漏洞）：新开的窗口挂载时若只拿
       owner、不拿 muted，它会以为自己没被静音 ⇒ 用户已经在别的窗口按过「停止播报」，
       新窗口照念 —— 静态判定「我是不是 owner」不等于「现在该不该出声」。 */
    const muted = state.mutedAll;
    /* ⛔ 通话态也要一起回（与 muted 同一个理由）：弹窗启动时若主窗口**已经在通话**，
       它收不到那次状态广播（广播只在**变化**时发）⇒ 会开口播报，与通话 TTS 抢扬声器。
       ⛔ 启动早期 service 还没注入会抛错 —— 按「未通话」处理，不要因此让整个查询失败。 */
    let callActive = false;
    try { callActive = a.svc().status().active; } catch { /* 未注入：按未通话处理 */ }
    if (ownerId == null) return { owner: true, ownerWebContentsId: null, reason, muted, callActive };
    /* ⛔ `ipcHost.handle` 的 event 是 unknown（不是 ipcMain.handle 的 IpcMainInvokeEvent）——
       必须显式收窄，否则 tsc 报 TS18046。 */
    const senderId = (event as { sender?: { id?: number } } | undefined)?.sender?.id;
    return { owner: senderId === ownerId, ownerWebContentsId: ownerId, reason, muted, callActive };
  });

  /* ② 全局静音闩锁（任一窗口按「停止播报」⇒ 全窗口安静）。 */
  ipcHost.handle("voice:announce-set-muted", (_event, input?: { muted?: boolean }) => {
    state.mutedAll = input?.muted === true;
    broadcastMuted();
    return { muted: state.mutedAll };
  });

  /* ③ 焦点跟踪：**只有焦点变化才影响 owner**（blur 不动 owner —— 见文件头「无焦点」的口径）。 */
  if (!wired) {
    wired = true;
    app.on("browser-window-focus", (_event, win) => {
      try {
        const id = win?.webContents?.id;
        if (typeof id === "number") state.lastFocusedId = id;
      } catch { /* 关窗竞态 */ }
      broadcastOwner();
    });
    /* 窗口增减（开/关独立弹窗）也要重算 —— 新窗口可能立刻成为 owner，
       旧 owner 关闭后必须有人接棒（否则播报静默到下次焦点变化）。 */
    onBusWindowListChanged(() => broadcastOwner());
  }

  return { state, broadcastOwner, broadcastMuted };
}
