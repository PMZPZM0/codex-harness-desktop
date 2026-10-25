import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getAnnounceGlobalEnabled,
  getAnnounceStatus,
  isAnnounceMutedForThread,
  requestAnnounceResume,
  requestAnnounceStop,
  subscribeAnnounceGlobalEnabled,
  subscribeAnnounceStatus,
  subscribeAnnounceThreadMuted,
} from "../../voice/announce-bus";

/** 喇叭图标：实心扬声器 + 两道声波；播放时声波依次扩散（10-22 用户「做个好看一点的图标和喇叭播放特效」）。
 *  ⛔ 用内联 SVG 而不是 lucide 的 Megaphone：那个图标是小喇叭剪影，放在 24px 按钮里发灰、也不便做分层动画。
 *  ⛔ 不用 SVG `<linearGradient id>`（同页多实例共用 id，content-visibility 跳过的子树会解析失败）。 */
function AnnounceIcon({ muted, playing }: { muted: boolean; playing: boolean }) {
  return (
    <svg className="turn-head-announce-icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path className="announce-speaker" d="M3.4 9.2h3.3l5.2-4v13.6l-5.2-4H3.4z" />
      {muted ? (
        <path className="announce-slash" d="M15.4 9.4l5.2 5.2m0-5.2l-5.2 5.2" />
      ) : (
        <g className={playing ? "announce-waves is-playing" : "announce-waves"}>
          <path className="announce-wave wave-1" d="M14.9 9a4.4 4.4 0 0 1 0 6" />
          <path className="announce-wave wave-2" d="M18 6.5a8.3 8.3 0 0 1 0 11" />
        </g>
      )}
    </svg>
  );
}

/** 回合头 Codex 名字后的 📢 开关：只控制**当前会话**的语音播报，
 *  与悬浮球右键「停止播报 / 恢复播报」共用 announce-bus 的同一份会话状态。
 *  开关翻转时就地弹一个 2 秒的小提示（10-22 用户：「语音播报开启关闭做一个弹窗提醒」）。 */
export function SessionAnnounceToggle({ threadId }: { threadId: string }) {
  const muted = useSyncExternalStore(
    subscribeAnnounceThreadMuted,
    () => isAnnounceMutedForThread(threadId),
    () => false,
  );
  /* 10-25 用户：「明明开着，还说关的」——总开关关着时，会话头 📢 只反映 muted 会**
     看起来是开的**，但实际不会出声。这里把「总开关 ∧ 未静音」作为图标状态：
     总开关关 ⇒ 直接显示划掉，点击去设置打开（⛔ 不是继续切会话静音）。 */
  const globalOn = useSyncExternalStore(
    subscribeAnnounceGlobalEnabled,
    () => getAnnounceGlobalEnabled() !== false,
    () => true,
  );
  const status = useSyncExternalStore(subscribeAnnounceStatus, getAnnounceStatus, getAnnounceStatus);
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  if (!threadId) return null;
  const enabled = globalOn && !muted;
  const playing = enabled && status.active;
  const action = !globalOn ? "去打开" : muted ? "开启" : "关闭";

  function toggle() {
    if (!globalOn) return; /* 图标已 disabled，不会走到这里；保留防御 */
    if (muted) {
      requestAnnounceResume(threadId);
      setNotice({ text: "已开启当前会话语音播报", key: Date.now() });
    } else {
      requestAnnounceStop(threadId);
      setNotice({ text: "已关闭当前会话语音播报", key: Date.now() });
    }
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setNotice(null), 2000);
  }

  return (
    <span className="turn-head-announce-wrap">
      <button
        type="button"
        className={`turn-head-announce${!globalOn ? " is-off" : muted ? " muted" : ""}${playing ? " is-playing" : ""}`}
        aria-pressed={enabled}
        aria-disabled={!globalOn}
        disabled={!globalOn}
        aria-label={`${action}当前会话语音播报${playing ? "（正在播报）" : ""}`}
        title={!globalOn ? "语音播报总开关已关闭 —— 去「设置 → 语音通话 → 语音播报」打开" : muted ? "开启当前会话语音播报（与悬浮球的恢复播报同步）" : playing ? "正在播报 · 点击停止当前会话" : "关闭当前会话语音播报（与悬浮球的停止播报同步）"}
        onClick={toggle}
      >
        <AnnounceIcon muted={!enabled} playing={playing} />
      </button>
      {notice ? (
        <span className="turn-head-announce-toast" role="status" aria-live="polite" key={notice.key}>
          {notice.text}
        </span>
      ) : null}
    </span>
  );
}
