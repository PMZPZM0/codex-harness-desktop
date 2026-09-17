import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Zap } from "lucide-react";
import { blockedEffortsOf } from "../lib/effort-support";

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
 *  Light / Standard / Extended / Max 这种**带语义的档位 + 一句用途**，而不是光秃秃的 low/high）。 */
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

/** 思考强度：底栏一个档位按钮，点开是**滑块**弹窗（09-18 用户定稿的形态）：
 *  「前面一个⚪点滑动滑到哪里；⚪鼠标放上去再展示；默认展示一条线；已选的后面
 *   彩色动态液体流动 + 灯带；没拉到的地方空着；拉满后一个燃烧特效」。
 *
 *  实现（对应关系）：
 *  · **默认一条线**：`.effort-picker-track`（2px 细线），没拉到的地方就只有它；
 *  · **已选段液体 + 灯带**：`.effort-picker-fillwrap`（按档位分色的渐变，用 overflow 裁到
 *    已选宽度 —— 颜色与档位位置始终对齐）+ `::after` 流光扫过 + 外发光（box-shadow 在
 *    wrapper 上，否则会被自己的 overflow:hidden 裁掉）+ 前沿亮珠（液体头）；
 *  · **⚪默认隐藏**：`.effort-picker-thumb` opacity:0，bar hover / focus-within 才出现；
 *    原生 `input[type=range]` 的拇指**保持透明但可拖** —— 拖动/键盘（←→）/触摸/无障碍
 *    全部复用原生行为，视觉全部由上面的元素承担；
 *  · **拉满燃烧**：`.burn` 填充切火焰配色 + 流光加速 + 三簇火苗（.effort-picker-flames）。
 *
 *  不变的纪律：
 *  · **拖动中绝不提交**：释放（pointerup/keyup）才 onCommit —— 提交会落库（IPC），拖动经过
 *    中间档位会反复触发、还会把选中的档位覆盖回去（09-16 真机踩过）；点标签则立即提交。
 *  · 弹窗 createPortal + fixed：底栏在滚动容器里，absolute 浮层会被裁掉（09-17 踩过）。 */
export function EffortPicker({ levels, value, labels, disabled, modelId, onCommit }: {
  levels: string[];
  value: string;
  labels: Record<string, string>;
  disabled?: boolean;
  /** 当前模型 id —— 「该模型已知不支持的档位」按模型记（发送失败时自动学会，
   *  见 src/lib/effort-support.ts）。⚠️ 每次**打开弹窗时重读**一次而不是靠父组件 state：
   *  降档可能发生在别的窗口、也可能刚被记下，打开时读才一定是最新的。 */
  modelId?: string;
  onCommit: (next: string) => void;
}) {
  const index = Math.max(0, levels.indexOf(value));
  const [blocked, setBlocked] = useState<string[]>(() => blockedEffortsOf(modelId));
  const blockedSet = new Set(blocked);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const [draft, setDraft] = useState(index);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // 外部值变化（菜单/命令切换、切会话）要同步回滑块
  useEffect(() => { setDraft(index); }, [index]);

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ right: Math.max(12, window.innerWidth - rect.right), bottom: window.innerHeight - rect.top + 8 });
    setDraft(index);
    setBlocked(blockedEffortsOf(modelId)); // 打开时重读：刚被降档记下的、别的窗口记的，都立刻可见
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
  const isMax = draft >= levels.length - 1;
  // 分段色带：每档一段纯色，左→右 = 低→高（铺满整条轨道，再由 fillwrap 裁到已选宽度）
  const bands = `linear-gradient(90deg, ${levels.map((level, i) => {
    const c = effortColor(level, i);
    return `${c} ${(i / levels.length) * 100}%, ${c} ${((i + 1) / levels.length) * 100}%`;
  }).join(", ")})`;
  const pct = levels.length > 1 ? (draft / (levels.length - 1)) * 100 : 0;
  // 渐变按「整条轨道」铺：已选段越窄，背景就要放得越大，颜色才与档位位置对齐
  const fillScale = pct > 0 ? (100 / pct) * 100 : undefined;

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
          style={{ right: anchor.right, bottom: anchor.bottom, "--fill-color": color } as CSSProperties}
        >
          <div className="effort-picker-head">
            <strong>思考强度</strong>
            <span>越往右，Codex 想得越久、越细</span>
          </div>
          <div className={`effort-picker-bar${isMax ? " burn" : ""}`}>
            {/* 未选段 = 一条线 */}
            <div className="effort-picker-track" aria-hidden />
            {/* 已选段 = 液体 + 灯带（宽度=已选比例；渐变铺满整条再裁，颜色对齐档位） */}
            <div className="effort-picker-fillwrap" style={{ width: `${pct}%` }} aria-hidden>
              <div className="effort-picker-fill" style={{ backgroundImage: bands, backgroundSize: fillScale ? `${fillScale}%` : undefined }} />
            </div>
            {/* 档位刻度点（贴轨道，低存在感；当前档被滑块盖住） */}
            <div className="effort-picker-dots" aria-hidden>
              {levels.map((level, i) => (
                <i
                  key={level}
                  className={i === draft ? "on" : ""}
                  style={{ left: `${levels.length > 1 ? (i / (levels.length - 1)) * 100 : 0}%`, "--fill-color": effortColor(level, i) } as CSSProperties}
                />
              ))}
            </div>
            {/* 液体前沿的亮珠 */}
            <div className="effort-picker-bead" style={{ left: `${pct}%` }} aria-hidden />
            {/* ⚪ 滑块：默认隐藏，hover / 聚焦 / 拖动才出现 */}
            <div className="effort-picker-thumb" style={{ left: `${pct}%` }} aria-hidden />
            {isMax && <div className="effort-picker-flames" aria-hidden><i /><i /><i /></div>}
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
                  className={`effort-tick${on ? " on" : ""}${blockedSet.has(level) ? " blocked" : ""}`}
                  style={on ? ({ color: c } as CSSProperties) : undefined}
                  title={blockedSet.has(level) ? `该模型上次报「不支持」这一档 —— 选它会报错并自动降档` : undefined}
                  onClick={() => { setDraft(i); commit(level); }}
                >
                  {labels[level] ?? level}
                </button>
              );
            })}
          </div>
          {/* 当前档位 + 一句用途（随拖动实时更新） */}
          <div className="effort-picker-hint">
            <i style={{ background: color }} aria-hidden />
            <span style={{ color }}>{labels[shown] ?? shown}</span>
            <em>{EFFORT_HINTS[shown] ?? ""}</em>
          </div>
          {/* 09-18：档位是**会话级**的（每个会话各自记住自己选的档位）；模型真不支持某档时
              发送会失败 → 自动降档重发，并把该档记进这个模型（下面这行就是它的反馈）。 */}
          <div className="effort-picker-foot">
            <span>按会话各自记忆 · 切会话互不影响</span>
            {blockedSet.size > 0 && (
              <span className="effort-picker-blocked">
                该模型不支持：{[...blockedSet].map((b) => labels[b] ?? b).join("、")}
                <em>（选了会自动改用相邻档位）</em>
              </span>
            )}
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
