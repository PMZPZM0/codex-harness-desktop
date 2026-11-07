/**
 * 群内成员头像选择器（11-07 用户令：「加一个群内的成员头像自定义修改功能」）。
 *
 * ⛔ 作用域 = **这个群的这个成员**：改完只影响群里的脸，不动专家中心 / 用户中心的形象。
 *   （同一个专家在 A 群一张脸、B 群另一张，是刻意允许的 —— 用户要的是"群里这张"。）
 * ⛔ 存 `preset:<id>` 或 `data:image/...`（渲染层压到 128px）：⛔ 不写本地绝对路径 ——
 *   群 JSON 会被同步/备份，路径在另一台机器上必然失效。
 * ⛔ 上传的图**当场压缩**：原图直接塞进 dataURL 会几 MB，一个群能塞十几个人。
 * ⛔ 头像组件的渲染在 `13-team-avatar`（自定义优先），这里只负责"选"。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, RotateCcw, Upload, X } from "lucide-react";
import { USER_AVATAR_PRESETS } from "../../lib/avatar-presets";
import { avatarPresetSrc } from "./13-team-avatar";

/** 上传图压成 128×128 的 webp dataURL（居中裁方形：⛔ 不拉伸，人脸不会被压扁）。 */
async function fileToAvatarDataUrl(file: File, size = 128): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画布不可用");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();
  return canvas.toDataURL("image/webp", 0.86);
}

export function TeamAvatarPicker({
  anchor,
  name,
  current,
  onPick,
  onClose,
}: {
  /** 点的那个头像（用它定位面板） */
  anchor: HTMLElement | null;
  name: string;
  /** 当前值：`preset:<id>` / `data:image/...` / 空串 */
  current: string;
  onPick: (avatar: string) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) { onClose(); return; }
    /* ⛔ 面板 268 宽、约 250 高：贴右/下边缘时往里收，别被窗口裁掉（项目里的浮层统一口径）。 */
    const width = 268;
    const height = 258;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width + 12));
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 8));
    setPos({ left, top });
  }, [anchor, onClose]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const t = event.target as Node | null;
      if (boxRef.current && t && boxRef.current.contains(t)) return;
      if (anchor && t && anchor.contains(t)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  const pickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setErr("");
      try {
        const dataUrl = await fileToAvatarDataUrl(file);
        onPick(dataUrl);
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "这张图读不出来，换一张试试");
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  if (!pos) return null;
  return createPortal(
    <div
      ref={boxRef}
      className="team-avatar-picker"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label={`修改 ${name} 的头像`}
    >
      <header className="team-avatar-picker__head">
        <ImageIcon size={13} />
        <strong>{name} 的头像</strong>
        <button type="button" className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}><X size={13} /></button>
      </header>
      <div className="team-avatar-picker__grid">
        {USER_AVATAR_PRESETS.map((preset) => {
          const value = `preset:${preset.id}`;
          return (
            <button
              key={preset.id}
              type="button"
              className={`team-avatar-picker__item${current === value ? " is-active" : ""}`}
              title={preset.label}
              aria-pressed={current === value}
              onClick={() => { onPick(value); onClose(); }}
            >
              <img src={avatarPresetSrc(preset.id)} alt={preset.label} />
            </button>
          );
        })}
      </div>
      {err && <p className="team-avatar-picker__err">{err}</p>}
      <footer className="team-avatar-picker__foot">
        <button type="button" onClick={pickFile} disabled={busy}>
          <Upload size={13} /> {busy ? "处理中…" : "上传图片"}
        </button>
        <button type="button" onClick={() => { onPick(""); onClose(); }} disabled={!current}>
          <RotateCcw size={13} /> 恢复默认
        </button>
      </footer>
    </div>,
    document.body,
  );
}
