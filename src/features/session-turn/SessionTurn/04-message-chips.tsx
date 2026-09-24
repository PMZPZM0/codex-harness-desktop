/**
 * SessionTurn 的「message-chips」部分（09-22 从同目录 SessionTurn.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { useEffect, useMemo, memo, useState, useRef } from "react";
import { CircleStop, AlertTriangle, FileText, Brain, ChevronDown } from "lucide-react";
import { hk } from "../../../lib/hk";
import { COMPOSER_CHIP_ICON } from "../../shared/COMPOSER_CHIP_ICON";
import { imageDisplaySrc } from "../../../lib/image-src.mjs";
export function UserMessageEditor({ initial, onCancel, onSubmit }: { initial: string; onCancel: () => void; onSubmit: (text: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="edit-message">
      <textarea value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onSubmit(draft); }} placeholder="编辑消息内容" />
      <div className="edit-actions">
        <span>{hk("Ctrl+Enter")} 发送 · Esc 取消</span>
        <button className="ghost" onClick={onCancel}>取消</button>
        <button disabled={!draft.trim()} onClick={() => onSubmit(draft)}>保存并重新发送</button>
      </div>
    </div>
  );
}

export function MessageAttachChip({ name, source, image, onOpenImage, onOpenFile }: {
  name: string;
  source: string;
  image: boolean;
  onOpenImage?: (source: string, name: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  // 悬停预览的弹出方向：默认在上方（贴着文字流更自然），上方空间不够时翻到下方。
  // ⛔ 必须翻：聊天区的滚动容器（`.timeline`）有 overflow 裁剪，靠近顶部的那条消息
  //    如果硬往上弹，预览会被切掉上半截（09-18 真机实测 `top: -101`，等于看不见）。
  const [previewBelow, setPreviewBelow] = useState(false);
  const decideDirection = (el: HTMLElement) => {
    const preview = el.querySelector(".message-attach-preview") as HTMLElement | null;
    const img = preview?.querySelector("img");
    // 所需高度：图片已加载就用实测高度，否则按 CSS 上限（240）留足余量，避免"先判定在上、
    // 图片随后撑高 → 又被裁"的时序问题。
    const measured = preview ? preview.getBoundingClientRect().height : 0;
    const need = (img?.naturalWidth ? measured : 0) > 0 ? measured : 240;
    const budget = need + 16;
    // 以最近的滚动/裁剪容器为"可视上界"
    let box: HTMLElement | null = el.parentElement;
    while (box && box !== document.body) {
      const s = getComputedStyle(box);
      if (/(auto|scroll|hidden|clip)/.test(`${s.overflowY}${s.overflow}`)) break;
      box = box.parentElement;
    }
    const limitTop = (box ?? document.documentElement).getBoundingClientRect().top;
    setPreviewBelow(el.getBoundingClientRect().top - limitTop < budget);
  };
  return (
    <button
      type="button"
      className={`composer-image-chip-inline message-attach-chip${image ? " is-image" : ""}${previewBelow ? " preview-below" : ""}`}
      title={image ? `点击查看大图：${name}` : name}
      onClick={(event) => {
        // ⛔ 指针点击后要**释放焦点**：chip 一旦留着焦点，`:focus-visible` 会让预览继续挂着——
        //    用户点开大图 → Esc 关掉 → 小预览却又自己冒出来（而且 Esc 属键盘操作，会把
        //    Chromium 的焦点渲染切到"键盘模式"，让刚点过的按钮开始命中 :focus-visible）。
        //    键盘激活（Enter/Space）的 click 事件 `detail === 0`，此时**保留焦点**给无障碍用。
        if (event.detail > 0) event.currentTarget.blur();
        if (image) onOpenImage?.(source, name);
        else onOpenFile?.(source);
      }}
      onMouseEnter={(event) => decideDirection(event.currentTarget)}
      onFocus={(event) => decideDirection(event.currentTarget)}
    >
      {image
        ? <span className="composer-image-chip-icon" dangerouslySetInnerHTML={{ __html: COMPOSER_CHIP_ICON }} />
        : <FileText size={13} style={{ color: "var(--link)", flex: "none" }} />}
      <span className="composer-image-chip-name">{name}</span>
      {/* 悬停小预览：只给图片。尺寸由 CSS 的 max-width/max-height + 浏览器保持原始宽高比决定，
          所以"自适应"是天然的——不用按图片比例写任何分支。 */}
      {image && (
        <span className="message-attach-preview" aria-hidden="true">
          <img src={imageDisplaySrc(source)} alt="" />
        </span>
      )}
    </button>
  );
}
