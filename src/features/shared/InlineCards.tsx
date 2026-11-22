/** 内联文件卡片 / 引用行（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { resolveFilePath, openImageLightbox, openFileTextEditor, notifyToast, openMediaPreview } from "../../lib/ui-channels";
import { basename } from "../../lib/basename";
import { isImagePath } from "../../lib/is-image-path";
import { mediaKindOf } from "../../lib/media-kind.mjs";
import { FileText, Zap, Quote, Pencil, FolderOpen, Save, ExternalLink, Copy, Film, Music2, Box } from "lucide-react";
import type { ParsedUserRefs } from "../../lib/user-refs";
import { imageDisplaySrc } from "../../lib/image-src.mjs";
import { IMAGE_EXTENSIONS, BINARY_EXTENSIONS } from "../../hooks/useFilePreview";
import { copyTextToClipboard } from "../../lib/clipboard";
import { craftOpeners, openPathInCraft, useInstalledCraftIds } from "./craft-open";

/** 文本类文件才能弹窗编辑（二进制/图片写回即损坏）。口径与 useFilePreview 同源（导出复用，别抄第二份）。 */
function isEditableTextFile(path: string): boolean {
  if (isImagePath(path)) return false;
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return !IMAGE_EXTENSIONS.has(extension) && !BINARY_EXTENSIONS.has(extension);
}

/** 文件卡片右键菜单（09-26「像 WorkBuddy 那样」）：打开 / 在文件夹中显示 / 复制文件路径 / 编辑 / 另存为…
 *  ⛔ 10-06 起**跨板块复用**（回合底部的「已更改 N 个文件」汇报行也用它）—— 改菜单项要连
 *  `features/status` 的用法一起想（那边只是挂 onContextMenu，不复制第二份菜单）。 */
type FileCardMenuState = { x: number; y: number; path: string; name: string };

/** 文件卡的更多菜单：点外面或按 Esc 关闭，菜单项按类型给出。 */
export function FileCardMenu({ menu, onOpen, onClose }: { menu: FileCardMenuState; onOpen: () => void; onClose: () => void }) {
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".file-card-menu")) onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("mousedown", onDown, true); window.removeEventListener("keydown", onKey, true); };
  }, [onClose]);
  // 视口边缘翻转：贴右/贴底时往回挪
  const width = 176;
  const itemH = 30, pad = 10;
  const editable = isEditableTextFile(menu.path);
  /* 11-16：产出的文件按格式给出「用对应 App 打开」（只列已安装的 Craft App，最多 3 个）。 */
  const craftIds = useInstalledCraftIds();
  const openers = craftOpeners(menu.path, craftIds, 3);
  const items: { label: string; icon: ReactNode; run: () => void }[] = [
    { label: "打开", icon: <ExternalLink size={13} />, run: onOpen },
    ...openers.map((opener) => ({
      label: `用 ${opener.name} 打开`,
      icon: <Box size={13} />,
      run: () => void openPathInCraft(opener.id, menu.path, opener.name),
    })),
    { label: "在文件夹中显示", icon: <FolderOpen size={13} />, run: () => void window.codex.shellReveal(menu.path) },
    {
      label: "复制文件路径",
      icon: <Copy size={13} />,
      run: () => {
        void copyTextToClipboard(menu.path)
          .then(() => notifyToast("已复制文件路径", menu.path))
          .catch(() => notifyToast("复制失败", menu.path));
      },
    },
    ...(editable ? [{ label: "编辑", icon: <Pencil size={13} />, run: () => openFileTextEditor(menu.path, menu.name) }] : []),
    {
      label: "另存为…",
      icon: <Save size={13} />,
      run: () => {
        void window.codex.saveFileAs(menu.path)
          .then((result) => { if (result?.ok && result.savedTo) notifyToast("已另存为", result.savedTo); })
          .catch((error: any) => notifyToast("另存为失败", String(error?.message ?? error).slice(0, 160)));
      },
    },
  ];
  const height = pad * 2 + items.length * itemH;
  const left = menu.x + width > window.innerWidth ? Math.max(4, menu.x - width) : menu.x;
  const top = menu.y + height > window.innerHeight ? Math.max(4, menu.y - height) : menu.y;
  // ⛔ createPortal 到 body（10-06）：菜单是 position:fixed 且坐标来自视口（clientX/Y）——
  //    回合容器 `.turn-group` 上有恒等 transform（= containing block），留在原地会被整体偏移。
  return createPortal((
    <div className="file-card-menu" role="menu" style={{ left, top }} onMouseDown={(event) => event.stopPropagation()}>
      {items.map((item) => (
        <button type="button" role="menuitem" key={item.label} onClick={() => { item.run(); onClose(); }}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  ), document.body);
}

/** 用户消息的引用行：文件 / 技能 / 上下文三类 chip，文件可点开。 */
export function UserRefsRow({ refs, onOpenFile, onQuote, extraThumbs, hideFiles }: { refs: ParsedUserRefs; onOpenFile?: (path: string) => void; onQuote?: (text: string) => void; extraThumbs?: ReactNode; hideFiles?: boolean }) {
  const { files, skills, contexts } = refs;
  const visibleFiles = hideFiles ? [] : files;
  const [menu, setMenu] = useState<FileCardMenuState | null>(null);
  if (!visibleFiles.length && !skills.length && !contexts.length && !extraThumbs && !menu) return null;
  const refAbsPath = (path: string) => resolveFilePath(path) ?? path;
  return (
    <>
    <div className="msg-refs">
      {visibleFiles.map((path, index) => {
        const name = basename(path) || path;
        if (isImagePath(path)) {
          // ⛔ 必须走 imageDisplaySrc：写 `startsWith("http") ? path : imageUrl(path)` 会让
          //    data URL 被当成本地路径（09-18 守卫【47】抓到的残留，与灯箱同类缺陷）。
          const src = imageDisplaySrc(path);
          return (
            <button type="button" className="ref-file-card ref-image-card" title={name} onClick={() => openImageLightbox(path, name)} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, path: refAbsPath(path), name }); }} key={index}>
              <span className="ref-image-thumb">
                <img src={src} alt={name} loading="lazy" />
                <span className="ref-image-preview"><img src={src} alt={name} /></span>
              </span>
            </button>
          );
        }
        const mediaKind = mediaKindOf(path);
        return (
          <button
            type="button"
            className={`ref-file-card${mediaKind ? " is-media" : ""}`}
            title={mediaKind ? `点击${mediaKind === "model" ? "预览 3D" : "播放"}：${name}` : name}
            onClick={() => {
              if (mediaKind) openMediaPreview({ source: refAbsPath(path), kind: mediaKind, title: name });
              else onOpenFile?.(path);
            }}
            onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, path: refAbsPath(path), name }); }}
            key={index}
          >
            {mediaKind === "video" ? <Film size={14} />
              : mediaKind === "audio" ? <Music2 size={14} />
              : mediaKind === "model" ? <Box size={14} />
              : <FileText size={14} />}
            <span className="ref-file-name">{name}</span>
          </button>
        );
      })}
      {skills.map((skill, index) => (
        <span className="ref-skill-chip" title={skill.description || skill.name} key={index}><Zap size={12} /><span>{skill.name}</span></span>
      ))}
      {contexts.map((ctx, index) => (
        <button type="button" className="ref-context-card" title="点击引用" onClick={() => onQuote?.(`${ctx.role}：${ctx.text}`)} key={index}>
          <Quote size={13} />
          <span className="ref-context-role">{ctx.role}</span>
          <span className="ref-context-text">{ctx.text}</span>
        </button>
      ))}
      {extraThumbs}
    </div>
    {menu && (
      <FileCardMenu
        menu={menu}
        onOpen={() => {
          const abs = refAbsPath(menu.path);
          const mediaKind = mediaKindOf(abs);
          if (isImagePath(abs)) openImageLightbox(abs, menu.name);
          else if (mediaKind) openMediaPreview({ source: abs, kind: mediaKind, title: menu.name });
          else onOpenFile?.(abs);
        }}
        onClose={() => setMenu(null)}
      />
    )}
    </>
  );
}
