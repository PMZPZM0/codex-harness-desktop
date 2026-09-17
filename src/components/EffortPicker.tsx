import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Zap } from "lucide-react";

/** 每个档位一个固定色（由低到高：冷 → 暖）。
 *  用户 09-17：「每个等级颜色都不一样」。颜色按**档位名**取而不是按位置下标 ——
 *  模型只声明 3 档（低/中/高）时，各档颜色与声明 5 档时保持一致，不会因为少一档就整体串色。 */
export const EFFORT_COLORS: Record<string, string> = {
  minimal: "#38bdf8",   // 极简 · 浅蓝
  low: "#22c55e",       // 低 · 绿
  medium: "#3b82f6",    // 中 · 蓝
  high: "#a855f7",      // 高 · 紫
  ultra: "#f59e0b",     // 最高 · 琥珀
  xhigh: "#ef4444",     // 极高 · 红
  max: "#ec4899",       // 引擎内置模型的扩展高位档 · 玫红
};
/** 引擎将来新增档位时的备用色（避免全部落回同一个灰）。 */
const SPARE_COLORS = ["#14b8a6", "#8b5cf6", "#f97316", "#06b6d4"];
const FALLBACK_COLOR = "#94a3b8";

/** 每档的用途说明（09-17 参考 Codex 原生的 effort slider：它把档位做成
 *  Light / Standard / Extended / Max 这种**带语义的档位 + 一句用途**，而不是光秃秃的 low/high）。
 *  文案取自官方对各档的定位：简单编辑 → 日常 → 多文件重构 → 研究级难题。 */
export const EFFORT_HINTS: Record<string, string> = {
  minimal: "一行小问题、格式化、改个名字",
  low: "小修复、简单重构，要快",
  medium: "日常开发与排查（大多数时候够用）",
  high: "多文件重构、原因不明的 bug",
  ultra: "再往上要更细的推理",
  xhigh: "最难的问题、大面积改动",
  max: "不计时间，想透为止",
};

/** 取档位颜色：已知档位用固定色，未知档位按下标取备用色。 */
export function effortColor(level: string, index = 0): string {
  return EFFORT_COLORS[level] ?? SPARE_COLORS[index % SPARE_COLORS.length] ?? FALLBACK_COLOR;
}

/** 思考强度：底栏一个档位按钮，点开是**宽彩色动态条**的弹窗（09-17 用户第二次要求：
 *  「弹窗拖动，不是输入框直接一个长条，gpt 那种宽的彩色动态条」）。
 *
 *  几个刻意的取舍：
 *  · **弹窗用 createPortal + fixed**：底栏在滚动容器里，absolute 浮层会被裁掉上半截
 *    （设置页的 `?` 气泡踩过同一个坑），所以按触发按钮的视口坐标定位、往上弹。
 *  · **拖动中绝不提交**：`changeEffort` 在档位未被模型声明时会 `upsertProviderModel` 落库
 *    （IPC + 重写 model-catalog.json），拖动经过中间档位会反复触发；它还读过期闭包，
 *    连发多次会把刚选中的档位覆盖回去（09-16 真机踩过）。所以拖动只改本地 draft，
 *    **pointerup / keyup 才提交一次**；点档位标签则是立即提交。
 *  · **动态**：色带用 220% 宽背景 + 缓慢平移做流光，滑块下方一团跟随的光晕，
 *    档位标签随当前档位染色 —— 静止时也在动，拖动时跟手。
 *  · 原生 `input[type=range]` 提供拖动/键盘（←→）/触摸/无障碍，不自己写指针逻辑。 */
export function EffortPicker({ levels, value, labels, disabled, onCommit }: {
  levels: string[];
  value: string;
  labels: Record<string, string>;
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const index = Math.max(0, levels.indexOf(value));
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const [draft, setDraft] = useState(index);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // 外部值变化（菜单/命令切换、切会话、模型声明变化）要同步回滑块
  useEffect(() => { setDraft(index); }, [index]);

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ right: Math.max(12, window.innerWidth - rect.right), bottom: window.innerHeight - rect.top + 8 });
    setDraft(index);
    setOpen(true);
  };
  // 点外部 / Esc 关闭（portal 在 body 上，必须同时排除弹窗与触发按钮）
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (levels.length === 0) return null;
  const shown = levels[Math.min(draft, levels.length - 1)] ?? value;
  const color = effortColor(shown, draft);
  const triggerColor = effortColor(value, index);
  const commit = (level?: string) => {
    const next = level ?? levels[draft];
    if (next && next !== value) onCommit(next);
  };
  // 分段色带：每档一段纯色，左→右 = 低→高
  const bands = `linear-gradient(90deg, ${levels.map((level, i) => {
    const c = effortColor(level, i);
    return `${c} ${(i / levels.length) * 100}%, ${c} ${((i + 1) / levels.length) * 100}%`;
  }).join(", ")})`;
  const pct = levels.length > 1 ? (draft / (levels.length - 1)) * 100 : 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="effort-trigger"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        title={`思考强度：${labels[value] ?? value}（点开调整）`}
        style={{ "--effort-color": triggerColor } as CSSProperties}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Zap size={12} className="effort-trigger-icon" aria-hidden />
        <span className="effort-trigger-label">{labels[value] ?? value}</span>
        <ChevronDown size={11} className="effort-trigger-caret" aria-hidden />
      </button>
      {open && anchor ? createPortal(
        <div
          ref={popRef}
          className="effort-picker-pop"
          role="dialog"
          aria-label="思考强度"
          style={{ right: anchor.right, bottom: anchor.bottom, "--effort-color": color } as CSSProperties}
        >
          <div className="effort-picker-head">
            <strong>思考强度</strong>
            <span>越往右，Codex 想得越久、越细</span>
          </div>
          <div className="effort-picker-bar">
            <div className="effort-picker-bands" style={{ backgroundImage: bands }} aria-hidden />
            <div className="effort-picker-glow" style={{ left: `${pct}%`, background: color }} aria-hidden />
            {/* 每档位置一个定位点（当前档那个被滑块盖住，剩下的就是分段刻度） */}
            <div className="effort-picker-dots" aria-hidden>
              {levels.map((level, i) => (
                <i
                  key={level}
                  className={i === draft ? "on" : ""}
                  style={{ left: `${levels.length > 1 ? (i / (levels.length - 1)) * 100 : 0}%`, background: effortColor(level, i) }}
                />
              ))}
            </div>
            <input
              type="range"
              className="effort-picker-range"
              min={0}
              max={levels.length - 1}
              step={1}
              value={draft}
              aria-label="思考强度"
              aria-valuetext={labels[shown] ?? shown}
              onChange={(event) => setDraft(Number(event.target.value))}
              onPointerUp={() => commit()}
              onKeyUp={() => commit()}
            />
          </div>
          <div className="effort-picker-ticks">
            {levels.map((level, i) => {
              const c = effortColor(level, i);
              const on = i === draft;
              return (
                <button
                  key={level}
                  type="button"
                  className={`effort-tick${on ? " on" : ""}`}
                  style={on ? ({ color: c, "--tick-color": c } as CSSProperties) : undefined}
                  onClick={() => { setDraft(i); commit(level); }}
                >
                  {labels[level] ?? level}
                </button>
              );
            })}
          </div>
          {/* 当前档位 + 一句用途（09-17 参考 Codex 原生 effort slider 的信息结构：它每档都带
              语义名与用途，而不是只给个 low/high）。信息放在条下方一行、随拖动实时更新 ——
              比把用途塞进 5 个窄标签里可读得多。 */}
          <div className="effort-picker-hint">
            <i style={{ background: color }} aria-hidden />
            <span style={{ color }}>{labels[shown] ?? shown}</span>
            <em>{EFFORT_HINTS[shown] ?? ""}</em>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
