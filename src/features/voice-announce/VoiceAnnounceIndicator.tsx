/**
 * VoiceAnnounceIndicator —— 「语音播报中」的实时状态条（10-09 用户：「增加播报进行中的实时反馈」+「支持随时停止」）。
 *
 * ⛔ 为什么必须有一条看得见的反馈：非通话播报是「只听不说」的链路 —— 它**不开麦克风**，
 *    用户喊「行了」没有用；而 TTS 队列可能排到几十秒以后。没有这条，用户既不知道它在念、
 *    也不知道排队多长、更不知道去哪儿按停 —— 三件事全靠猜。
 *
 * ⛔ 位置：与 VoiceWaveform（实时语音舞台）同一套做法 —— `position: fixed` + 按 composer
 *    的实际矩形写**行内** left/bottom/width。⛔ 不要改回流式布局：`.composer-wrap` 被 ResizeObserver
 *    盯着（高度一变就重申贴底），插一个会伸缩的兄弟节点会让它来回抖（本项目早踩过）。
 *    ⛔ 只在 has(announce) 时渲染 ⇒ 平时 DOM 里什么都没有。
 *
 * ⛔ 数据来源：`announce-bus` 的状态广播（执行端推过来的**事实**），这里不做任何"是不是在念"的推断。
 */
import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { getAnnounceStatus, requestAnnounceStop, subscribeAnnounceStatus, type AnnounceStatus } from "../../voice/announce-bus";

const SOURCE_LABEL: Record<string, string> = {
  live: "正在念正文",
  summary: "正在念小结",
  tool: "Codex 插播",
};

export function VoiceAnnounceIndicator() {
  const [status, setStatus] = useState<AnnounceStatus>(getAnnounceStatus());
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeAnnounceStatus(setStatus), []);

  // 贴合输入框（同 VoiceWaveform：量 composer 矩形 → 写自己的行内几何）
  useEffect(() => {
    if (!status.active && !status.stopped) return;
    const el = rootRef.current;
    if (!el) return;
    const anchor = (el.closest(".composer-wrap") ?? el.parentElement) as HTMLElement | null;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      if (!rect.width) return;
      const width = Math.max(280, Math.min(rect.width, window.innerWidth - 32));
      el.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
      el.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`;
      el.style.width = `${Math.round(width)}px`;
    };
    place();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    observer?.observe(anchor);
    window.addEventListener("resize", place);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); };
  }, [status.active, status.stopped]);

  if (!status.active && !status.stopped) return null;

  const current = String(status.current ?? "").trim();
  return (
    <div className={`voice-announce-bar${status.active ? " is-active" : ""}`} ref={rootRef} role="status" aria-live="polite">
      {status.active ? (
        <>
          <span className="voice-announce-dot" aria-hidden="true" />
          <Volume2 size={13} className="voice-announce-icon" />
          <span className="voice-announce-mode">{SOURCE_LABEL[status.source ?? ""] ?? "语音播报中"}</span>
          {current && <span className="voice-announce-text" title={current}>{current}</span>}
          {status.pending > 0 && <span className="voice-announce-pending">待播 {status.pending} 句</span>}
          <button type="button" className="voice-announce-stop" onClick={() => requestAnnounceStop()} title="立即停止播报（清掉排队的内容）">
            <Square size={11} />停止
          </button>
        </>
      ) : (
        <span className="voice-announce-mode">播报已停止</span>
      )}
    </div>
  );
}
