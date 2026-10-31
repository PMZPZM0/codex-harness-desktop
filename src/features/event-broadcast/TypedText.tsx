/**
 * 逐字出场文字（10-31 用户令：「群事件…加入文字逐字展示动画；语音播报也要有逐字出字效果，
 * 两种效果不一样」）。
 *
 * 两种节奏刻意做成不同手感，一眼能分辨：
 *   · `group`（群事件）＝ **打字机**：每个字干脆地"敲"出来（快、无模糊、轻微下坠），像有人在播报台念稿；
 *   · `voice`（语音）＝ **说话**：字从模糊里浮上来（慢、柔和、带上浮），跟着 TTS 的语流感。
 *
 * ⛔ 拆字用 `Array.from`：中文与 emoji 都是按码位算，`split("")` 会把 emoji 拆成两个乱码半块。
 * ⛔ 延迟上限 1300ms：长文本（群事件正文常常上百字）如果按字线性排，最后几个字会出现
 *    "半天打不完"的情况 —— 一旦气泡 4.2s 就要收，尾巴永远看不见。封顶后长文会加速追平。
 */
import { useMemo } from "react";

export type TypedVariant = "group" | "voice";

export function TypedText({ text, variant, className }: {
  text: string;
  variant: TypedVariant;
  className?: string;
}) {
  const chars = useMemo(() => Array.from(String(text ?? "")), [text]);
  const step = variant === "voice" ? 26 : 14;
  return (
    <span className={`bc-typed is-${variant}${className ? ` ${className}` : ""}`}>
      {chars.map((ch, index) => (
        <span key={index} style={{ animationDelay: `${Math.min(index * step, 1300)}ms` }}>
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );
}
