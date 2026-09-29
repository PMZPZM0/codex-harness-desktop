/**
 * 通用媒体查看器（09-29 用户：「工作流卡片里面的图片没有预览功能，不方便，预览图片里面的功能配套齐全一下」）。
 *
 * 定位：卡片上的缩略图、右侧「生成结果」面板、以及以后任何地方看到产物，**都打开这一个查看器** ——
 * 两套预览必然行为不一致（预览是"看产物"的入口，配套动作很容易漏一边）。
 *
 * ⛔ 用**画布内全屏遮罩**而不是顶栏里的浮层：`.drama-canvas-shell` 有 `overflow: hidden`（圆角裁切，
 *   必须保留），挂在顶栏内的浮层实测会被切成一条 12px 的线、按钮 elementFromPoint 命中 #root
 *   （点不到）。全屏遮罩 `inset: 0` 不溢出 ⇒ 天然安全（命名弹窗一直这么做）。
 * ⛔ 分层：这是「看产物」的**只读 + 轻动作**层 —— 不给"删除文件"（删文件属于文件管理，
 *   卡片上的「清除」只清卡片记录的路径，磁盘文件不动，所以可逆、不需要二次确认）。
 */
import { useState } from "react";
import { Copy, FolderOpen, Loader2, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useDramaActions, type ViewerTarget } from "./drama-actions";
import { useLocalAudio } from "./use-local-audio";
import { imageDisplaySrc } from "../../lib/image-src.mjs";

export type { ViewerTarget };

const fileOf = (p: string) => p.split(/[\\/]/).pop() || p;

export function DramaMediaViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const { board, story } = useDramaActions();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // ⛔ hook 必须无条件调用（音频要读成 blob url —— 本地绝对路径直接喂 <audio> 会被 CSP 拦）
  const audioUrl = useLocalAudio(target.kind === "audio" ? target.path : "");
  const src = target.kind === "image" ? imageDisplaySrc(target.path) : target.kind === "audio" ? audioUrl : target.path;
  const perCard = Boolean(target.nodeId);

  const run = async (label: string, fn: () => Promise<unknown> | unknown) => {
    setBusy(true);
    setNote("");
    try {
      await fn();
      setNote(`${label}完成`);
    } catch (error) {
      setNote(`${label}失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drama-canvas-modal-mask" onClick={onClose} role="dialog" aria-modal="true" aria-label="产物预览">
      <div className="drama-media-viewer" onClick={(event) => event.stopPropagation()}>
        <header className="drama-media-viewer-head">
          <b>{target.title || fileOf(target.path)}</b>
          <small title={target.path}>{fileOf(target.path)}</small>
          <button className="icon-button" title="关闭（Esc）" onClick={onClose}><X size={15} /></button>
        </header>

        <div className="drama-media-viewer-stage">
          {target.kind === "image" ? <img src={src} alt={target.title || "产物"} />
            : target.kind === "video" ? <video src={src} controls autoPlay playsInline />
            : audioUrl ? <audio src={audioUrl} controls autoPlay />
            : <span className="drama-media-viewer-note">音频读不到（文件可能已从工作区移除）</span>}
        </div>

        <div className="drama-media-viewer-bar">
          <span className="drama-media-viewer-path" title={target.path}>{target.path}</span>
          {note ? <span className="drama-media-viewer-note">{note}</span> : null}
          <div className="drama-media-viewer-actions">
            {/* 通用动作：所有产物都有 */}
            <button
              className="drama-media-viewer-btn"
              title="在系统资源管理器中显示这个文件"
              onClick={() => void run("打开文件夹", () => window.codex.revealInFolder(target.path))}
            >
              <FolderOpen size={13} />打开文件夹
            </button>
            <button
              className="drama-media-viewer-btn"
              title="复制文件路径"
              onClick={() => void run("复制路径", () => navigator.clipboard.writeText(target.path))}
            >
              <Copy size={13} />复制路径
            </button>
            {/* 按卡动作：只有从卡片点进来才有（结果面板是聚合视图，不该在这里改卡） */}
            {perCard && target.kind === "image" ? (
              <button
                className="drama-media-viewer-btn"
                disabled={busy}
                title="用本地图片替换这张卡的参考图（选图后会落盘到工作区）"
                onClick={() => void run("替换", () => story.uploadRef(target.nodeId!))}
              >
                <Sparkles size={13} />替换为新图
              </button>
            ) : null}
            {perCard && target.channel ? (
              <button
                className="drama-media-viewer-btn is-primary"
                disabled={busy}
                title="用这张卡现在的提示词重新生成一版（覆盖这张卡的产物记录）"
                onClick={() => void run("重新生成", () => story.generate(target.nodeId!, target.channel!, { report: () => undefined }))}
              >
                {busy ? <Loader2 size={13} className="is-spin" /> : <RefreshCw size={13} />}重新生成
              </button>
            ) : null}
            {perCard && target.fields?.length ? (
              <button
                className="drama-media-viewer-btn is-danger"
                disabled={busy}
                title="只清掉这张卡上记录的产物路径（磁盘文件不动，可重新生成）"
                onClick={() => {
                  board.updatePayload(target.nodeId!, Object.fromEntries(target.fields!.map((f) => [f, ""])));
                  board.saveNow();
                  setNote("已清除这张卡的产物记录（文件仍在磁盘上）");
                }}
              >
                <Trash2 size={13} />清除记录
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
