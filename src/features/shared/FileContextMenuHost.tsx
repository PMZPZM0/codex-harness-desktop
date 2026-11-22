/**
 * 全局文件右键菜单宿主（11-21 用户：所有文件芯都要右键菜单）。
 *
 * 正文文件链接、消息附件、主/群输入框芯片都只发 `openFileContextMenu({ path, x, y })`，
 * 菜单本体只在 AppView 挂一次 —— ⛔ 不在每个 chip 里复制一套菜单。
 */
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Box, Copy, ExternalLink, FolderOpen, Image as ImageIcon, Pencil, Save } from "lucide-react";
import { closeFileContextMenu, getFileContextMenu, subscribeFileContextMenu } from "../../lib/file-context-menu.mjs";
import { openRightFile } from "../../lib/right-file.mjs";
import { copyTextToClipboard } from "../../lib/clipboard";
import { openFileTextEditor, openImageLightbox, notifyToast } from "../../lib/ui-channels";
import { IMAGE_EXTENSIONS, BINARY_EXTENSIONS } from "../../hooks/useFilePreview";
import { fileExtOf } from "../../components/FileTypeIcon";
import { isImagePath } from "../../lib/is-image-path";
import { craftOpeners, openPathInCraft, useInstalledCraftIds } from "./craft-open";

const isEditable = (path: string) => {
  const ext = fileExtOf(path);
  return !IMAGE_EXTENSIONS.has(ext) && !BINARY_EXTENSIONS.has(ext);
};

/** 全局文件右键菜单宿主：订阅事件箱并渲染统一动作，挂在 AppView 一次。 */
export function FileContextMenuHost() {
  const menu = useSyncExternalStore(subscribeFileContextMenu, getFileContextMenu, getFileContextMenu);
  const craftIds = useInstalledCraftIds();

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".file-card-menu")) closeFileContextMenu();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); closeFileContextMenu(); } };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("mousedown", onDown, true); window.removeEventListener("keydown", onKey, true); };
  }, [menu]);

  if (!menu) return null;
  const image = Boolean(menu.image) || isImagePath(menu.path);
  const editable = isEditable(menu.path);
  const items: { label: string; icon: React.ReactNode; run: () => void }[] = [
    { label: "在右侧栏预览", icon: <ExternalLink size={13} />, run: () => openRightFile(menu.path) },
    { label: "在编辑器打开", icon: <Pencil size={13} />, run: () => openFileTextEditor(menu.path, menu.name) },
    { label: "用默认应用打开", icon: <ExternalLink size={13} />, run: () => { try { void window.codex.shellOpen?.(menu.path); } catch { /* 无关联程序 */ } } },
    ...(image ? [{ label: "查看大图", icon: <ImageIcon size={13} />, run: () => openImageLightbox(menu.path, menu.name) }] : []),
    ...craftOpeners(menu.path, craftIds, 3).map((opener) => ({
      label: `用 ${opener.name} 打开`,
      icon: <Box size={13} />,
      run: () => void openPathInCraft(opener.id, menu.path, opener.name),
    })),
    { label: "复制文件路径", icon: <Copy size={13} />, run: () => void copyTextToClipboard(menu.path).then(() => notifyToast("已复制文件路径", menu.path)).catch(() => notifyToast("复制失败", menu.path)) },
    { label: "复制文件名", icon: <Copy size={13} />, run: () => void copyTextToClipboard(menu.name).then(() => notifyToast("已复制文件名", menu.name)).catch(() => notifyToast("复制失败", menu.name)) },
    { label: "在文件夹中显示", icon: <FolderOpen size={13} />, run: () => void window.codex.shellReveal(menu.path) },
    ...(editable ? [{ label: "编辑", icon: <Pencil size={13} />, run: () => openFileTextEditor(menu.path, menu.name) }] : []),
    { label: "另存为…", icon: <Save size={13} />, run: () => void window.codex.saveFileAs(menu.path).then((result) => { if (result?.ok && result.savedTo) notifyToast("已另存为", result.savedTo); }).catch((error: unknown) => notifyToast("另存为失败", String((error as { message?: unknown })?.message ?? error).slice(0, 160))) },
  ];
  const width = 190, itemH = 30, pad = 10;
  const height = pad * 2 + items.length * itemH;
  const left = menu.x + width > window.innerWidth ? Math.max(4, menu.x - width) : menu.x;
  const top = menu.y + height > window.innerHeight ? Math.max(4, menu.y - height) : menu.y;
  return createPortal(
    <div className="file-card-menu" role="menu" style={{ left, top }} onMouseDown={(event) => event.stopPropagation()}>
      {items.map((item) => (
        <button type="button" role="menuitem" key={item.label} onClick={() => { item.run(); closeFileContextMenu(); }}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
