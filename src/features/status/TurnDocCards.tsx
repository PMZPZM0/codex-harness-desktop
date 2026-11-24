/**
 * 回合「办公文档产物」卡（11-24 用户令：「把 ppt Excel pdf 等等这些办公类的文件卡片在消息汇总
 * 下面的那个本轮产物里面加上」）。
 *
 * ⛔ 与媒体卡（TurnMediaCards：视频/图片/音频）**并列**而不是塞进去：媒体卡是缩略方块 + 点击播放，
 *    文档卡是「文件名 + 类型 + 打开方式」，两种形状混在一个网格里会两头不像。
 * ⛔ 外观/打开方式/右键全部复用 `FileRefCard`（它自带右栏预览 / 编辑器 / 默认应用三种打开方式）——
 *    这里只负责「筛出文档、折叠超量、把右键接到全局菜单」。
 * ⛔ 右键走 `openFileContextMenu`（全局 FileContextMenuHost 在 AppView 挂一次），不在这里写第二套菜单。
 */
import { useState } from "react";
import { FileRefCard } from "../../components/FileRefCard";
import { fileExtOf } from "../../components/FileTypeIcon";
import { openFileContextMenu } from "../../lib/file-context-menu.mjs";

export type TurnDocFile = { path: string; deletedFile?: boolean };

/** 办公文档扩展名（⛔ 只认"会被应用打开后才有意义"的那几类；md/txt 属正文类，不进产物卡）。 */
const DOC_EXTENSIONS = new Set([
  "pptx", "ppt", "pptm", "potx", "ppsx", "pps", "key", "odp",
  "xlsx", "xls", "xlsm", "xlsb", "csv", "ods",
  "docx", "doc", "docm", "odt", "rtf",
  "pdf",
]);

/** 首屏 4 个，其余折叠（与媒体卡同一节奏，11-15 用户「这里一次展示太多」）。 */
const MAX_VISIBLE = 4;

/** 取文件名：右键菜单要显示它（菜单结构要求 name 必填）。 */
function baseName(path: string): string {
  const norm = String(path || "").replaceAll("\\", "/");
  return norm.slice(norm.lastIndexOf("/") + 1) || norm;
}

/** 本回合产出的办公文档卡：文件名 + 类型 + 打开方式，点击默认右栏预览，右键出全局文件菜单。 */
export function TurnDocCards({ files }: { files: TurnDocFile[] }) {
  const [expanded, setExpanded] = useState(false);
  const docs = (Array.isArray(files) ? files : []).filter(
    (f) => f && f.path && !f.deletedFile && DOC_EXTENSIONS.has(fileExtOf(f.path)),
  );
  if (!docs.length) return null;
  const visible = expanded ? docs : docs.slice(0, MAX_VISIBLE);
  const hidden = docs.length - visible.length;
  return (
    <div className="turn-doc-cards" data-count={docs.length}>
      {visible.map((file) => (
        <FileRefCard
          key={file.path}
          path={file.path}
          onContextMenu={(event) => {
            event.preventDefault();
            openFileContextMenu({ path: file.path, name: baseName(file.path), x: event.clientX, y: event.clientY });
          }}
        />
      ))}
      {hidden > 0 && (
        <button type="button" className="turn-doc-more" onClick={() => setExpanded(true)}>
          还有 {hidden} 个文档
        </button>
      )}
      {expanded && docs.length > MAX_VISIBLE && (
        <button type="button" className="turn-doc-more" onClick={() => setExpanded(false)}>
          收起
        </button>
      )}
    </div>
  );
}
