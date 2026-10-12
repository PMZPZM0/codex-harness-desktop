/**
 * VoiceAnnounceIndicator —— 「语音播报中」的实时状态条（10-09 立，10-12 重做视觉 + 补恢复出口）。
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
 * ── 10-12 用户反馈三连，逐一对应到本组件 ─────────────────────────────────────
 *   「停止都停止不了，一直播报」⇒ 真正的修复在执行端（静音闩锁，`use-voice-announce.ts`）；
 *     本组件负责**让停止看起来可信、也让恢复找得到**：按停后条子不再自动消失，
 *     换成「已停止 · 恢复播报」，手指刚离开的地方就是恢复的地方。
 *   「语音播报有点丑」        ⇒ 见下方标记的几处：宽度改为**贴合内容**（不再强制 280px 起
 *     把正文挤成省略号）、按钮补 `appearance:none`（本项目铁律：暗色下原生 `<button>`
 *     按浅色 UA 绘制，不重置就是一块突兀的浅底）、点击区抬到 32px、字号到 12px。
 *
 * ⛔ 数据来源：`announce-bus` 的状态广播（执行端推过来的**事实**），这里不做任何"是不是在念"的推断。
 */
import { useEffect, useRef, useState } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import {
  getAnnounceStatus,
  requestAnnounceResume,
  requestAnnounceStop,
  subscribeAnnounceStatus,
  type AnnounceStatus,
} from "../../voice/announce-bus";

const SOURCE_LABEL: Record<string, string> = {
  /* 来源三种：`live` = Codex 逐条决定念的正文；`summary` = 回合结束那段播报稿（键名沿用旧名，
     语义是"念 Codex 写的播报稿"）；`tool` = 主动插播。 */
  live: "念正文",
  summary: "播报",
  tool: "插播",
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
      /* ⛔ 宽度改为「按内容自适应、但不超过输入框宽度」（10-12「有点丑」）：
         原来固定 `max(280, min(...))` ⇒ 没有正文时条子也是 280px 宽，一颗图标孤零零在中间。
         现在上限跟着输入框走，实际宽度交给 CSS 的 `max-width` + `width: max-content` 决定。 */
      const width = Math.min(rect.width, window.innerWidth - 32);
      el.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
      el.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`;
      el.style.maxWidth = `${Math.round(width)}px`;
    };
    place();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    observer?.observe(anchor);
    window.addEventListener("resize", place);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); };
  }, [status.active, status.stopped]);

  if (!status.active && !status.stopped) return null;

  const current = String(status.current ?? "").trim();
  /* ⛔ 静音优先于"已停止"回执的显示：两者都由 `stopped` 触发，但只有 `muted` 才有恢复出口
     —— 分开渲染才能保证"条子上一定有办法恢复"（用户看不到出口就等于永久失去播报）。 */
  if (status.stopped) {
    return (
      <div className="voice-announce-bar is-stopped" ref={rootRef} role="status" aria-live="polite">
        <Volume2 size={13} className="voice-announce-icon" aria-hidden="true" />
        <span className="voice-announce-mode">已停止播报</span>
        <button
          type="button"
          className="voice-announce-stop"
          onClick={() => requestAnnounceResume()}
          title="恢复语音播报（下次播报照常念出来）"
        >
          <Play size={11} />恢复
        </button>
      </div>
    );
  }

  return (
    <div className="voice-announce-bar is-active" ref={rootRef} role="status" aria-live="polite">
      <span className="voice-announce-dot" aria-hidden="true" />
      <Volume2 size={13} className="voice-announce-icon" aria-hidden="true" />
      <span className="voice-announce-mode">{SOURCE_LABEL[status.source ?? ""] ?? "语音播报中"}</span>
      {current && <span className="voice-announce-text" title={current}>{current}</span>}
      {status.pending > 0 && <span className="voice-announce-pending">待播 {status.pending} 句</span>}
      <button
        type="button"
        className="voice-announce-stop"
        onClick={() => requestAnnounceStop()}
        title="立即停止播报（清掉排队的内容，并停到你说「恢复」为止）"
      >
        <Square size={10} />停止
      </button>
    </div>
  );
}
