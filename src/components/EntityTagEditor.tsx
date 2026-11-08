import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Tag, X } from "lucide-react";
import { closeTagEditor, clampTagText, getEntityTagState, MAX_TAG_CHARS, removeEntityTag, setEntityTag, subscribeEntityTags, TAG_COLORS } from "../lib/entity-tags.mjs";
import { useEscapeLayer } from "../hooks/useEscapeLayer";

/** 会话 / 项目标签编辑器（10-25）：文字 + 8 色可选，默认无标签。 */
export function EntityTagEditorHost() {
  const state = useSyncExternalStore(subscribeEntityTags, getEntityTagState, getEntityTagState);
  const editor = state.editor;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0].value);

  useEffect(() => {
    if (!editor) return;
    setText(editor.value?.text ?? "");
    setColor(editor.value?.color ?? TAG_COLORS[0].value);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [editor]);

  useEscapeLayer(Boolean(editor), () => closeTagEditor());

  if (!editor) return null;
  const kindLabel = editor.kind === "project" ? "项目标签" : "会话标签";
  const title = String(editor.title ?? "").trim();
  const save = () => {
    const next = clampTagText(text);
    if (!next) return;
    setEntityTag(editor.kind, editor.id, { text: next, color });
  };

  return createPortal(
    <div className="entity-tag-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTagEditor(); }}>
      <div className="entity-tag-modal" role="dialog" aria-label={kindLabel} onMouseDown={(event) => event.stopPropagation()}>
        <div className="entity-tag-head">
          <span className="entity-tag-head-icon"><Tag size={15} /></span>
          <div>
            <strong>{kindLabel}</strong>
            {title ? <small title={title}>{title}</small> : null}
          </div>
          <button type="button" className="entity-tag-close" aria-label="关闭" onClick={closeTagEditor}><X size={14} /></button>
        </div>
        <input
          ref={inputRef}
          className="entity-tag-input"
          value={text}
          maxLength={MAX_TAG_CHARS}
          placeholder={`最多 ${MAX_TAG_CHARS} 个字，例如：专家团 / 客户`}
          onChange={(event) => setText(clampTagText(event.target.value))}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(); } }}
        />
        <div className="entity-tag-colors" role="radiogroup" aria-label="标签颜色">
          {TAG_COLORS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={color === option.value}
              className={`entity-tag-color${color === option.value ? " active" : ""}`}
              style={{ "--tag-color": option.value } as CSSProperties}
              title={option.label}
              onClick={() => setColor(option.value)}
            />
          ))}
        </div>
        <div className="entity-tag-actions">
          {editor.value ? <button type="button" className="entity-tag-remove" onClick={() => removeEntityTag(editor.kind, editor.id)}>移除标签</button> : <span />}
          <div>
            <button type="button" className="entity-tag-cancel" onClick={closeTagEditor}>取消</button>
            <button type="button" className="entity-tag-save" disabled={!text.trim()} onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
