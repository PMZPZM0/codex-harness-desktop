import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Eye, Sparkles, Video } from "lucide-react";
import { formatTokenCount, matchModelSpec, suggestModelIds } from "../lib/model-specs";
import { imageSpecBadges, buildImageModelRows, type ImageModelSpec } from "../lib/image-model-specs";

/** 一行候选：内置规格表的条目，或是供应商「刷新探测」到的模型 id。 */
type Row = {
  id: string;
  /** 内置表命中的厂商/系列；探测到的未知模型为空 */
  family?: string;
  vendor?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  vision?: boolean;
  video?: boolean;
  /** 生图变体：命中的生图规格（徽标由它渲染） */
  image?: ImageModelSpec;
  /** 探测来源（供应商网关实际可用），与内置推荐区分显示 */
  probed?: boolean;
};

/**
 * 模型 ID 输入框 + **Tab 补全**（09-18 用户：「加一个 tab 补全功能，模型额度和上下文输出根据模型名字
 * 自动填写内置参数，方便新手快速配置」；同日追加生图变体：「热门生图模型内置参数…支持 tab 补全」）。
 *
 * 为什么不用原生 `<datalist>`（改造前就是它）：datalist 只能靠点击 / 方向键选中，**Tab 补全做不到**，
 * 而且没法显示「上下文 / 输出 / 支持图片」这些新手最需要一眼看到的信息。
 *
 * 两个变体共用同一套交互契约，只是「参数徽标」不同：
 *  · `variant="chat"`（默认）：上下文 / 最大输出 / 图片 / 视频；
 *  · `variant="image"`：尺寸（含自定义规则）/ 改图参考图张数 / quality 档（见 `image-model-specs.ts`）。
 *
 * 交互契约：
 *  · 聚焦或输入即出候选（空输入给当前主流型号，避免「不知道该填什么」）；
 *  · **Tab / Enter** 补全到高亮项，**↑↓** 换项，**Esc** 只关列表、不动输入框内容；
 *  · 选中即调用 onChange（沿用原有链路：`matchModelSpec` 自动回填上下文 / 最大输出 / 视觉模态）；
 *  · 候选来自两处：内置规格表（`suggestModelIds` / `suggestImageModelIds`）+ 供应商探测到的模型 id（`extraIds`）。
 */
export function ModelIdInput({ value, onChange, extraIds = [], placeholder, autoFocus, ariaLabel = "模型 ID", variant = "chat" }: {
  value: string;
  onChange: (next: string) => void;
  /** 供应商「刷新」探测到的模型 id（网关实际可用），与内置推荐一起候选 */
  extraIds?: string[];
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  /** 参数口径：聊天模型（上下文/输出）还是生图模型（尺寸/改图/质量档） */
  variant?: "chat" | "image";
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 刚补全过就不再自动弹列表（否则补全完立刻又被候选挡住，用户以为没生效） */
  const justPickedRef = useRef(false);
  /** 浮层空间不够时向上弹（见下） */
  const [upward, setUpward] = useState(false);
  /** 浮层高度上限（按可用空间算，见下） */
  const [popMax, setPopMax] = useState(320);

  /** 网关探测到的 id → 候选行（聊天口径）。探测项也过一遍规格表：命中就有徽标
   *  （很多网关的内部接入点名里带着官方型号）。生图口径不走这里 —— 见 `buildImageModelRows`（纯函数，可被预检直跑断言）。 */
  const probedRows = (ids: string[], known: Set<string>): Row[] =>
    ids
      .filter((id) => id && !known.has(id.toLowerCase()))
      .slice(0, 6)
      .map((id) => {
        const spec = matchModelSpec(id);
        return {
          id,
          probed: true,
          contextWindow: spec?.contextWindow,
          maxOutputTokens: spec?.maxOutputTokens,
          vision: (spec?.inputTypes ?? []).includes("image"),
          video: (spec?.inputTypes ?? []).includes("video"),
        };
      })
      // 探测项里「前缀与已输入内容一致」的排前面（用户在打 deepseek 时先看到 deepseek-* 的接入点）
      .sort((a, b) => Number(b.id.toLowerCase().startsWith(value.trim().toLowerCase())) - Number(a.id.toLowerCase().startsWith(value.trim().toLowerCase())));

  const rows: Row[] = useMemo(() => {
    if (variant === "image") {
      // 候选行来自 image-model-specs 的**纯函数**（这样预检能直跑真代码做行为断言，
      // 组件里的分支用文本守卫是挡不住 `if (false)` 的）
      return buildImageModelRows(value, extraIds).map((row) => ({ id: row.id, vendor: row.vendor, family: row.family, probed: row.probed, image: row.spec }));
    }
    const builtin: Row[] = suggestModelIds(value, 7);
    const known = new Set(builtin.map((entry) => entry.id.toLowerCase()));
    return [...builtin, ...probedRows(extraIds ?? [], known)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, extraIds, variant]);

  useEffect(() => { setCursor(0); }, [value]);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  /** ⛔ 浮层方向与高度：向下弹是默认，但**弹窗（`.connector-setup-modal` 等）自己有 `overflow: auto`**，
   *  字段又常在弹窗最底部 —— 向下弹的列表会被弹窗边界裁掉（用户看不到候选，还以为补全坏了）。
   *  所以按**最近的裁剪祖先**（overflow ≠ visible 的父节点，兜底视口）算上下可用空间：
   *  下方不够（< 300px）且上方更宽裕时翻上去，并把高度**封顶到可用空间内**。
   *  09-18 真机验收抓到过一版只判方向的实现：上弹后顶部超出弹窗 7px，首行候选正好被切掉半行。 */
  useEffect(() => {
    if (!open) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let clipTop = 0, clipBottom = window.innerHeight;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll|hidden)/.test(`${style.overflowY}${style.overflow}`)) {
        const box = node.getBoundingClientRect();
        clipTop = box.top; clipBottom = box.bottom;
        break;
      }
    }
    const above = rect.top - clipTop;
    const below = clipBottom - rect.bottom;
    const flip = below < 300 && above > below;
    setUpward(flip);
    setPopMax(Math.max(120, Math.min(320, Math.floor((flip ? above : below) - 8))));
  }, [open, rows.length]);

  const pick = (row: Row) => {
    justPickedRef.current = true;
    onChange(row.id);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const listOpen = open && rows.length > 0;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!listOpen) { setOpen(true); return; }
      event.preventDefault();
      setCursor((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        return (next + rows.length) % rows.length;
      });
      return;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      // ⛔ Tab 只在「列表开着且有候选」时被劫持：其余情况必须保持原生换焦点行为，
      //   否则用户在模型 ID 里按 Tab 会被困住（弹窗里 Tab 是唯一的键盘移动方式）。
      if (!listOpen) return;
      const row = rows[Math.min(cursor, rows.length - 1)];
      if (!row) return;
      event.preventDefault();
      pick(row);
      return;
    }
    if (event.key === "Escape" && listOpen) {
      // ⛔ 只收列表、不冒泡：弹窗自己也可能监听 Esc，这里必须拦住，否则一次 Esc 连弹窗一起关掉
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="model-id-field" ref={wrapRef}>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open && rows.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(event) => { justPickedRef.current = false; onChange(event.target.value); setOpen(true); }}
        onFocus={() => { if (!justPickedRef.current) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && rows.length > 0 && (
        <div className={`model-id-pop${upward ? " up" : ""}`} style={{ maxHeight: `${popMax}px` }} role="listbox" aria-label="模型 ID 候选">
          {rows.map((row, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === cursor}
              key={(row.probed ? "p:" : "b:") + row.id}
              className={`model-id-item${index === cursor ? " on" : ""}`}
              // mousedown 时 preventDefault：不把焦点从输入框抢走，点选后仍能继续打字
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setCursor(index)}
              onClick={() => pick(row)}
            >
              <span className="model-id-main">
                <b>{row.id}</b>
                {row.family && <i>{row.vendor} · {row.family}</i>}
                {row.probed && <i className="probed">网关探测到</i>}
              </span>
              <span className="model-id-badges">
                {variant === "image"
                  ? imageSpecBadges(row.image).map((badge) => <em key={badge.text} title={badge.title}>{badge.text}</em>)
                  : <>
                      {row.vision && <em className="badge-vision" title="支持图片输入（视觉）"><Eye size={10} />图片</em>}
                      {row.video && <em className="badge-video" title="支持视频输入"><Video size={10} />视频</em>}
                      {row.contextWindow ? <em title="上下文窗口">{formatTokenCount(row.contextWindow)} 上下文</em> : null}
                      {row.maxOutputTokens ? <em title="最大输出">{formatTokenCount(row.maxOutputTokens)} 输出</em> : null}
                    </>}
                {index === cursor && <Check size={12} className="model-id-check" aria-hidden />}
              </span>
            </button>
          ))}
          <div className="model-id-foot">
            <Sparkles size={11} aria-hidden />
            <span>
              {variant === "image"
                ? <>↑↓ 选择 · <b>Tab</b> 补全 · Esc 关闭 —— 徽标是该模型的尺寸 / 改图 / 质量档参数</>
                : <>↑↓ 选择 · <b>Tab</b> 补全 · Esc 关闭 —— 补全后上下文 / 最大输出会按内置规格自动填写</>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
