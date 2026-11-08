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

/**
 * ⛔⛔ 11-01 用户（截图 + 原话：「每次点开这个，都播放一次」）：
 *   逐字效果是 CSS animation，**元素一重建就从头播一遍** —— 而播报面板是可开合的，
 *   每开一次 <TypedText> 就重新挂载一次 ⇒ 整屏历史事件集体再敲一遍（像重新播报）。
 *   ⇒ 记忆「这条内容已经敲过了」（按 `playKey`，模块级，跨挂载存活）：
 *     第一次进场逐字，之后任何重挂载都静态呈现。⛔ 不是缓存动画进度，是"只敲一次"。
 */
const playedKeys = new Set<string>();

/** 打字机式文本：同一条播报的同一处文字只动一次（`playKey` 相同即静止）。 */
export function TypedText({ text, variant, className, playKey }: {
  text: string;
  variant: TypedVariant;
  className?: string;
  /** 一次性的"已经播过"标记（同一条播报的同一处文字共用一个 key）。不给就每次都动。 */
  playKey?: string;
}) {
  const chars = useMemo(() => Array.from(String(text ?? "")), [text]);
  const key = String(playKey ?? "");
  const animate = key ? !playedKeys.has(key) : true;
  if (key && animate) playedKeys.add(key);
  if (!animate) {
    return <span className={`bc-typed is-${variant}${className ? ` ${className}` : ""}`}>{String(text ?? "")}</span>;
  }
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
