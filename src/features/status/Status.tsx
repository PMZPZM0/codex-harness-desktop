/** 运行状态 / 上下文用量（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, FileCode2, ChevronDown, CircleGauge, Maximize2, Minimize2, Pencil } from "lucide-react";
import { RUN_CLOCK } from "../../lib/run-clock-2";
import { Turn } from "../../lib/turn";
import { diffStats } from "../../lib/diff-stats";
import { ToolCodeBlock } from "../shared/ToolCodeBlock";
import { DiffPreviewBody } from "./DiffPreview";
import { FileCardMenu } from "../shared/InlineCards";
import { getTurnFileChanges, getTurnLiveFileChanges, subscribeTurnFileChanges } from "../../lib/turn-file-changes.mjs";
import { placeLiveFileFloat } from "../../lib/live-file-float-position.mjs";
import { useCenteredPopoverLeft } from "../../lib/use-centered-popover";
import { useRunProcessMode } from "../../lib/run-process-mode";
import { setTurnReview, primeTurnReview, clearTurnReview, getTurnReview } from "../../lib/turn-review-store.mjs";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { TurnMediaCards } from "./TurnMediaCards";
import { TurnDocCards } from "./TurnDocCards";
import { openImageLightbox } from "../../lib/ui-channels";
import { imageUrl, retryLocalImage } from "../../lib/image-url";
import { isImagePath } from "../../lib/is-image-path";
import { usageBucket } from "../../lib/usage-bucket";
import { usageInputTokens } from "../../lib/usage-input-tokens";
import { usageCachedTokens } from "../../lib/usage-cached-tokens";

/** 连接状态点：ready 已连接 / error 连接失败 / 其它表示启动中。 */
export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} title={status === "ready" ? "Codex 已连接" : status === "error" ? "Codex 连接失败" : "Codex 正在启动"} />;
}

/** 回合结束的「文件更改汇报」（10-01 复刻 ZCode）：已更改 N 个文件 +X -Y；每行 = 类型图标 +
    文件名 + 所在目录 + 增删行数 + 「审查」（弹窗看完整 diff）与「打开」（资源管理器定位）。
    ⛔ 不再限定 task 回合——普通聊天回合里模型改了文件同样要汇报（用户按文件数核对改动）。
    10-06（用户对照 Qoder 效果图补交互）：行**点击直接打开预览**（图片走灯箱）、**右键复用文件卡菜单**
    （在文件夹中显示 / 复制文件路径）、超过 6 行折叠成「再显示 N 个文件」、图片文件显示缩略图、
    宿主追踪的**新增文件**打「新增」徽标。
    10-06 二改（用户对照 WorkBuddy 截图）：「类型图标」从彩色文字块换成 FileTypeIcon（扩展名 → 图标+配色）。
    10-06 三改（用户令）：「已修改那个文件…最多一次展示 2 行，多了的自动放进收纳里面」——
    默认只露 2 行，其余收进「再显示 N 个文件」（收纳就是原来的折叠钮，别再改动它）。 */
const COLLAPSE_LIMIT = 2;

/** 路径 → 文件名 + 所在目录（正斜杠归一后以最后一个 / 切开；汇报卡与运行中板块共用）。 */
function segments(full: string): { name: string; dir: string } {
  const norm = full.replaceAll("\\", "/");
  const cut = norm.lastIndexOf("/");
  return { name: cut >= 0 ? norm.slice(cut + 1) : norm, dir: cut >= 0 ? norm.slice(0, cut) : "" };
}

/** 本回合改动汇总卡：按文件列改动，可看差异、可打开文件。 */
export function CompletedChanges({ turn, onOpenFile, isLastTurn, onReview }: { turn: Turn; onOpenFile?: (path: string) => void; isLastTurn?: boolean; onReview?: () => void }) {
  const [review, setReview] = useState<{ path: string; diff: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; name: string } | null>(null);
  /* 行悬停 → diff 预览（10-06 夜，用户对照图一：「鼠标放到汇总的修改的文件名上，出来这种预览效果」）。
     ⛔ 位置**自适应**（用户点名：「别固定，固定容易截掉、展示不全」）：开时按行上下空间选边 +
     计算代码区上限，落位时再实测高度钳进视口；面板 portal 到 body（不受回合卡坐标系影响）。 */
  const [diffHover, setDiffHover] = useState<{ row: DOMRect; path: string; added: number; deleted: number; diff: string; side: "above" | "below"; codeMax: number } | null>(null);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const hoverPanelRef = useRef<HTMLDivElement>(null);
  /** 取消「准备关窗」：行与预览面板**共用**（10-18 用户：「鼠标放上去闪一下就没了」）。 */
  const keepHoverOpen = () => {
    if (hoverCloseTimerRef.current) { window.clearTimeout(hoverCloseTimerRef.current); hoverCloseTimerRef.current = null; }
  };
  const [expanded, setExpanded] = useState(false);
  const changes = turn.items.flatMap((item) => item.type === "fileChange" ? (item.changes ?? []) : []);
  /* 宿主追踪（10-01）：模型走 shell / MCP / 浏览器写文件时引擎不发 fileChange，
     这份差异由主进程快照对比得出 —— 与引擎 changes 合并（同路径引擎优先）。 */
  const [trackedVersion, setTrackedVersion] = useState(0);
  useEffect(() => subscribeTurnFileChanges((changedTurnId: string) => { if (changedTurnId === turn.id) setTrackedVersion((v) => v + 1); }), [turn.id]);
  // 审查弹窗开着时 Esc 即关（10-06 用户：「这个文件审查关不掉」——关闭键在长 diff 里滚不见时的兜底）。
  // ⛔ 必须排在下面的空态提前 return **之前**：hook 顺序不许随文件数变化。
  useEffect(() => {
    if (!review) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setReview(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [review]);
  // diff 悬停预览：外部一滚动就收起（行坐标已漂移，贴着旧坐标会错位）。
  // ⛔ 排除**预览面板内部的滚动**（用户 10-06：「鼠标放上去要能左右/上下滚动看」）——
  //   面板改两轴滚动后，滚动事件在捕获阶段同样会到 window；不豁免就「想滚先关窗」。
  useEffect(() => {
    if (!diffHover) return;
    const close = (event: Event) => {
      const panel = hoverPanelRef.current;
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      setDiffHover(null);
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [diffHover]);
  // diff 悬停预览：**自适应落位**（用户 10-06：「别固定，固定容易截掉、展示不全」）——
  // 开时已按行上下空间选边/算代码区上限，这里实测面板高度后把整块钳进视口。
  useLayoutEffect(() => {
    const panel = hoverPanelRef.current;
    if (!panel || !diffHover) return;
    const M = 8, GAP = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(640, vw - M * 2);
    panel.style.width = width + "px";
    const rect = diffHover.row;
    const h = panel.offsetHeight;
    const top = diffHover.side === "above" ? Math.max(M, rect.top - GAP - h) : Math.min(vh - M - h, rect.bottom + GAP);
    const left = Math.max(M, Math.min(rect.left, vw - width - M));
    panel.style.top = Math.round(top) + "px";
    panel.style.left = Math.round(left) + "px";
    panel.style.visibility = "visible";
  }, [diffHover]);
  void trackedVersion;
  /* ⛔ 兜底（10-10 终端用户两轮反馈）：①「板块凭空消失」——收尾广播没到（中断/异常漏结算）
     时最终报告是空的，但运行中的 live 数据**还在**（只在最终报告落地时才清场）⇒ 拿它顶上；
     ②「位置/形态」——这块卡由 03-turn-view 渲染在**汇总消息下面**（富卡片：头部计数 + 文件行 +
     悬停 diff 预览），SessionQueue 里那块插在汇总上面的裸行已于同日删除，别再加回去。 */
  const finalReport = getTurnFileChanges(turn.id);
  const tracked = finalReport.length ? finalReport : getTurnLiveFileChanges(turn.id);
  const byPath = new Map<string, { path: string; added: number; deleted: number; diffs: string[]; deletedFile?: boolean; newFile?: boolean }>();
  for (const change of changes) {
    const path = change.path ?? change.filePath ?? "未知文件";
    const stats = diffStats(change.diff ?? "");
    const current = byPath.get(path) ?? { path, added: 0, deleted: 0, diffs: [] };
    byPath.set(path, { path, added: current.added + stats.added, deleted: current.deleted + stats.deleted, diffs: [...current.diffs, String(change.diff ?? "")] });
  }
  for (const entry of tracked) {
    const existing = byPath.get(entry.path);
    if (existing) { if (!existing.added && !existing.deleted && (entry.added || entry.deleted || entry.status === "deleted")) byPath.set(entry.path, { path: entry.path, added: entry.added, deleted: entry.deleted, diffs: entry.diff ? [entry.diff] : existing.diffs, deletedFile: entry.status === "deleted", newFile: entry.status === "added" }); continue; }
    byPath.set(entry.path, { path: entry.path, added: entry.status === "deleted" ? 0 : entry.added, deleted: entry.deleted, diffs: entry.diff ? [entry.diff] : [], deletedFile: entry.status === "deleted", newFile: entry.status === "added" });
  }
  const files = [...byPath.values()];
  const totals = files.reduce((sum, file) => ({ added: sum.added + file.added, deleted: sum.deleted + file.deleted }), { added: 0, deleted: 0 });
  const reviewFiles = files.map((file) => ({
    path: file.path,
    added: file.added,
    deleted: file.deleted,
    diff: file.diffs.join("\n"),
    deletedFile: Boolean(file.deletedFile),
    newFile: Boolean(file.newFile),
  }));
  const reviewSignature = reviewFiles.map((file) => `${file.path}|${file.added}|${file.deleted}|${file.diff.length}`).join(";");
  /* 最新回合自动带出到右栏「审阅」（用户 10-18：「每次最新回合中已修改的文件，都要在这里面展示」）：
     只 prime 数据、不打开右栏；历史回合的卡（isLastTurn=false）不许覆盖当前最新回合。
     最新回合没有文件改动 ⇒ 清空，避免右栏把上一轮当成「最新回合」。 */
  useEffect(() => {
    if (!isLastTurn) return;
    if (!reviewFiles.length) { clearTurnReview(); return; }
    const existing = getTurnReview();
    const keepSelected = existing?.turnId === turn.id && reviewFiles.some((file) => file.path === existing.selectedPath);
    primeTurnReview({
      turnId: turn.id,
      selectedPath: keepSelected ? existing!.selectedPath : reviewFiles[0].path,
      files: reviewFiles,
    });
  }, [isLastTurn, turn.id, reviewSignature]);
  if (!changes.length && !tracked.length) return null;
  /** 行点击 / 菜单「打开」共用：图片走灯箱，其余交给文件预览弹窗（会话单例的统一入口）。 */
  const openPath = (path: string, name: string) => {
    if (isImagePath(path)) openImageLightbox(path, name);
    else onOpenFile?.(path);
  };
  /* 点击文件行 → 右栏「审阅」（10-18 用户对照 Qoder：「已修改的文件加一个可以点击，然后右边展示」）。
     整轮文件清单一起交给右栏，面板里还能切换别的文件；不走居中小弹窗。 */
  const openReview = (path: string) => {
    const selected = files.find((file) => file.path === path);
    if (!selected) return;
    setTurnReview({
      turnId: turn.id,
      selectedPath: path,
      files: reviewFiles,
    });
    /* ⛔ 11-09 用户令「已编辑卡片里面的审查…要接线右侧栏浮窗」：群里没有 AppView 的右栏，
       审阅数据先写进同一份 store，再由群视图把**浮动侧栏**开到「审阅」页。 */
    onReview?.();
  };
  const visible = expanded ? files : files.slice(0, COLLAPSE_LIMIT);
  return (
    <>
      {/* 11-09：本回合产出的视频/图片预览卡（点击复用现有播放器/灯箱）；主对话与群聊共用。 */}
      <TurnMediaCards files={files} />
      {/* 11-24：办公文档（ppt / excel / pdf …）卡与媒体卡并列，打开方式与右键都用 FileRefCard 那套。 */}
      <TurnDocCards files={files} />
      {/* 11-21 用户对照 Qoder：底部只留**一条**「已编辑 N 个文件」汇总条（默认收起，点开是行列表），
         正文里的紧凑文件行另由 ProgressiveAgentBody 渲染；⛔ 不再在这里重复文件卡片。 */}
      {files.length > 0 && (
      <details className="completed-changes">
        <summary><FileCode2 size={15} /><strong>已编辑 {files.length} 个文件</strong><span className="diff-add">+{totals.added}</span><span className="diff-delete">-{totals.deleted}</span><ChevronDown size={14} /></summary>
        <div>
          {visible.map((file) => {
            const { name, dir } = segments(file.path);
            const diffText = file.diffs.join("\n");
            return (
              <div className="completed-file clickable" key={file.path} title={`点击在右栏查看改动：${file.path}`}
                onClick={() => openReview(file.path)}
                onMouseEnter={(event) => {
                  keepHoverOpen();
                  if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
                  if (!diffText.trim()) return; // 没有 diff 内容的不弹（悬停没反应好过弹空窗）
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  // 悬停意图 260ms：扫过一行不弹，停住才弹
                  hoverOpenTimerRef.current = window.setTimeout(() => {
                    const vh = window.innerHeight;
                    const spaceAbove = rect.top - 16;
                    const spaceBelow = vh - rect.bottom - 16;
                    const side = spaceAbove >= spaceBelow ? "above" : "below"; // 默认贴空间大的一侧
                    const codeMax = Math.max(120, Math.min(360, (side === "above" ? spaceAbove : spaceBelow) - 52));
                    setDiffHover({ row: rect, path: file.path, added: file.added, deleted: file.deleted, diff: diffText, side, codeMax });
                  }, 260);
                }}
                onMouseLeave={() => {
                  if (hoverOpenTimerRef.current) { window.clearTimeout(hoverOpenTimerRef.current); hoverOpenTimerRef.current = null; }
                  hoverCloseTimerRef.current = window.setTimeout(() => setDiffHover(null), 500); // 给"移向预览面板"留够时间（10-18：160ms 会在中途被关掉）
                }}
                onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, path: file.path, name }); }}>
                {isImagePath(file.path)
                  ? <span className="completed-file-thumb"><img src={imageUrl(file.path)} alt="" loading="eager" onError={(event) => retryLocalImage(event as unknown as { currentTarget: HTMLImageElement }, imageUrl(file.path), file.path)} /></span>
                  : <FileTypeIcon path={file.path} size={15} className="completed-file-icon" />}
                <span className="completed-file-meta"><code title={file.path}>{name}</code><small title={file.path}>{dir}</small></span>
                <span className="completed-file-stats">{file.deletedFile ? <i className="completed-file-gone">已删除</i> : file.newFile ? <b className="completed-file-new">新增</b> : <><b>+{file.added}</b> <i>-{file.deleted}</i></>}</span>
                <button type="button" className="completed-file-btn" title="在右栏审阅这个文件的完整 diff" onClick={(event) => { event.stopPropagation(); setDiffHover(null); openReview(file.path); }}>审查</button>
                <button type="button" className="completed-file-btn" title="在资源管理器里定位该文件" onClick={(event) => { event.stopPropagation(); try { void window.codex.revealInFolder(file.path); } catch { /* 目录可能已删 */ } }}>打开</button>
              </div>
            );
          })}
          {files.length > COLLAPSE_LIMIT && (
            <button type="button" className="completed-more" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "收起" : `再显示 ${files.length - COLLAPSE_LIMIT} 个文件`}
            </button>
          )}
        </div>
      </details>
      )}
      {/* 右键菜单：与文件卡（消息里的内联卡片）共用同一份（在文件夹中显示 / 复制文件路径 / …），
          ⛔ 不复制第二份菜单实现 —— 菜单项永远只有一处真相源。 */}
      {menu && <FileCardMenu menu={menu} onOpen={() => openPath(menu.path, menu.name)} onClose={() => setMenu(null)} />}
      {/* 行悬停的 diff 预览（自适应定位；portal 到 body —— 回合卡的恒等 transform 不影响 fixed）。
          10-06 夜二改（用户对照 Qoder）：正文换成带行号槽的 DiffPreviewBody，面板内可**左右/上下滚动**
          （滚动豁免见上面的 close 监听）；右上角 ⤢ 一键开审查弹窗看完整 diff。 */}
      {diffHover && createPortal((
        <div ref={hoverPanelRef} className="completed-diff-preview" style={{ visibility: "hidden", top: 0, left: 0 }}
          onMouseEnter={keepHoverOpen}
          onMouseMove={keepHoverOpen}
          onMouseLeave={() => setDiffHover(null)}>
          <header>
            <code title={diffHover.path}>{diffHover.path}</code>
            <span className="completed-diff-preview-stats"><b>+{diffHover.added}</b> <i>-{diffHover.deleted}</i></span>
            <button type="button" className="completed-diff-expand" title="打开完整 diff（审查弹窗）"
              onClick={(event) => { event.stopPropagation(); setReview({ path: diffHover.path, diff: diffHover.diff }); setDiffHover(null); }}>
              <Maximize2 size={12} />
            </button>
          </header>
          <DiffPreviewBody text={diffHover.diff} maxHeight={diffHover.codeMax} />
        </div>
      ), document.body)}
      {/* 审查弹窗：完整 diff 就地可看（层级 950 = 模态之上的最后一层，见 DESIGN.md 层叠带）。
          ⛔ 必须 createPortal 到 body（10-06 用户实测「弹窗那个叉掉被遮住了 / 关不掉」的真因）：
          `.turn-group` 上有一个**恒等 transform**（matrix(1,0,0,1,0,0)）——恒等也照样创建
          containing block，让 `position:fixed` 的遮罩退化成「这一回合的盒子」（实测 481px 高），
          弹窗在盒子里居中后被顶出屏幕上方、头部（含关闭键）整个被切掉。portal 出去一劳永逸。 */}
      {review && createPortal((
        <div className="turn-diff-modal-mask" onClick={() => setReview(null)}>
          <div className="turn-diff-modal" role="dialog" aria-label={`${review.path} 改动审查`} onClick={(event) => event.stopPropagation()}>
            <header><code>{review.path}</code><button type="button" onClick={() => setReview(null)}>关闭</button></header>
            <ToolCodeBlock language="diff" text={review.diff || "（这个文件的 diff 内容不可用——会话记录里只存了路径）"} maxHeight={560} />
          </div>
        </div>
      ), document.body)}
    </>
  );
}

const LIVE_LIMIT = 8;

/** 运行中「编辑 <文件> +N -M」实时行（10-06 用户对照 WorkBuddy，两次纠正后定型：
    **运行中是运行中的 —— 数字跟在编辑行对应文件后面；汇总是汇总（回合结束那张卡）—— 不许混**；
    **在哪个地方发生就显示在哪个地方** —— 行由 TurnFoldStream 按锚点挂在当时那条工具项后面渲染，
    这里只负责画（哑组件：给什么画什么，订阅与锚点都在 session-queue）。
    每行 = 铅笔 + 文件类型图标 + 文件名 + 所在目录 + 该文件实时的 +N -M（数字变化重放一次 live-tick）。
    数据源 = 主进程每 ~2.5s 一圈的轻量重扫（turn-file-changes-live，见 electron/turn-file-watch.ts）。 */
export type LiveFileChange = { path: string; status: string; added: number; deleted: number; diff?: string; content?: string };

/** 实时文件浮窗的逐字揭示：只在文本追加时补字；diff 被整段重算时直接定格，
 *  避免把已经显示过的内容倒回去重播（与正文追字同一条纪律）。 */
function useLiveReveal(text: string, key: string, active: boolean) {
  const [shown, setShown] = useState(text);
  const [typing, setTyping] = useState(false);
  const shownRef = useRef(text);
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      shownRef.current = text;
      setShown(text);
      setTyping(false);
      return;
    }
    let start = shownRef.current;
    if (!text.startsWith(start)) {
      let common = 0;
      while (common < start.length && common < text.length && start[common] === text[common]) common++;
      // 变化太大 = diff 重新计算过，不是「新增了几行」⇒ 直接显示，不回退重播。
      if (common < 80 || text.length - common > 900) {
        shownRef.current = text;
        setShown(text);
        setTyping(false);
        return;
      }
      start = text.slice(0, common);
      shownRef.current = start;
      setShown(start);
    }
    const remaining = text.length - start.length;
    if (remaining <= 0 || !active) {
      shownRef.current = text;
      setShown(text);
      setTyping(false);
      return;
    }
    setTyping(true);
    const step = remaining > 1200 ? 12 : remaining > 300 ? 5 : 2;
    let end = start.length;
    const timer = window.setInterval(() => {
      end = Math.min(text.length, end + step);
      const next = text.slice(0, end);
      shownRef.current = next;
      setShown(next);
      if (end >= text.length) {
        window.clearInterval(timer);
        setTyping(false);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [active, key, text]);
  return { shown, typing };
}

/** 运行过程「详细」档：像思考板块一样浮窗展示最新生成/修改文件，停止变化后自动收起。 */
function LiveFileFloat({ file, anchorRef, onClose }: { file: LiveFileChange; anchorRef: { current: HTMLElement | null }; onClose: () => void }) {
  const floatRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const diffText = useMemo(() => {
    if (file.diff?.trim()) return file.diff;
    if (file.content == null) return "";
    const lines = file.content.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    /* 新文件没有引擎 diff ⇒ 按「全新增」拼一份，复用同一个彩色 diff 视图（⛔ 不再显示裸文本）。
       头里不写行数：文件还在长，行数一变前缀就断，逐字出字会退化成整段闪现。 */
    return `@@ -0,0 +1 @@\n${lines.map((line) => `+${line}`).join("\n")}`;
  }, [file.diff, file.content]);
  const { shown, typing } = useLiveReveal(diffText, `${file.path}|${file.status}`, Boolean(diffText));

  /* 位置：把输入框当**禁区**（纯函数在 lib/live-file-float-position.mjs，守卫有真值表）。
     旧版只避开视口边缘，而实时编辑行就在输入框上方，于是浮窗直接盖在输入框上。 */
  const positionFloat = () => {
    const panel = floatRef.current;
    if (!panel) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const comp = document.querySelector(".composer, .team-composer");
    const composer = comp?.getBoundingClientRect() ?? null;
    const anchor = anchorRef.current;
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    const base = placeLiveFileFloat({ vw, vh, height: 160, anchor: rect, composer });
    panel.style.width = base.width + "px";
    panel.style.left = base.left + "px";
    panel.style.maxHeight = base.maxHeight + "px";
    const placed = placeLiveFileFloat({ vw, vh, height: panel.offsetHeight || 160, anchor: rect, composer });
    panel.style.top = placed.top + "px";
  };
  useEffect(() => {
    let raf = 0;
    const loop = () => { positionFloat(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [file.path]);
  /* 换文件 = 重新开始跟随；同一文件里用户主动上滚后不再抢滚动条。 */
  useEffect(() => { stickRef.current = true; setFollowing(true); }, [file.path]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      stickRef.current = atBottom;
      setFollowing(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [file.path]);
  /* 贴底才自动跟；布局阶段补 scrollTop，逐字出字时不会慢一帧。 */
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [shown]);
  const followLatest = () => {
    stickRef.current = true;
    setFollowing(true);
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  const { name } = segments(file.path);
  const truncated = file.content != null && file.content.length >= 12_000;
  return createPortal(
    <div className="live-file-float" ref={floatRef} role="complementary" aria-label="正在生成或修改文件">
      <div className="live-file-float-head">
        <FileTypeIcon path={file.path} size={13} />
        <strong>{name}</strong>
        <small>{file.path}</small>
        <span className="live-file-float-stats" title="本回合累计改动">
          {file.status === "deleted" ? <i>已删除</i> : <><b>+{file.added}</b><i>-{file.deleted}</i></>}
        </span>
        {typing ? <em className="live-file-float-typing" title="正在写入"><span />写入中</em> : null}
        {!following ? (
          <button type="button" className="live-file-float-follow" title="回到最新内容" onClick={followLatest}><ArrowDown size={12} />最新</button>
        ) : null}
        <button type="button" className="live-file-float-close" title="收起" onClick={onClose}><ChevronDown size={13} /></button>
      </div>
      <div className="live-file-float-body" ref={bodyRef}>
        {truncated ? <div className="live-file-float-note">内容较长，这里显示最近 1.2 万字符</div> : null}
        {diffText
          ? <DiffPreviewBody text={shown} maxHeight={99_999} className="live-file-float-diff" />
          : <div className="live-file-float-empty">{file.status === "deleted" ? "文件已删除（没有可显示的差异）" : "等待文件内容…"}</div>}
      </div>
    </div>,
    document.querySelector(".reasoning-float-host") ?? document.body,
  );
}

/** 实时文件改动行：运行中滚动显示正在改的文件，`process` 模式下才展示。 */
export function LiveFileRows({ files }: { files: LiveFileChange[] }) {
  const runProcessMode = useRunProcessMode();
  const [tick, setTick] = useState(0);
  const [floatPath, setFloatPath] = useState("");
  const activeUntilRef = useRef(new Map<string, number>());
  const signatureRef = useRef(new Map<string, string>());
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const now = Date.now();
    for (const file of files) {
      const signature = `${file.status}|${file.added}|${file.deleted}|${file.content?.length ?? 0}|${file.diff?.length ?? 0}`;
      if (signatureRef.current.get(file.path) === signature) continue;
      signatureRef.current.set(file.path, signature);
      activeUntilRef.current.set(file.path, now + 3000);
      // 只浮最新变化的那个文件；它停止变化后自动收起，不叠多个浮窗。
      setFloatPath(file.path);
    }
    const alive = new Set(files.map((file) => file.path));
    for (const path of [...activeUntilRef.current.keys()]) {
      if (!alive.has(path)) { activeUntilRef.current.delete(path); signatureRef.current.delete(path); }
    }
    setTick((value) => value + 1);
  }, [files]);
  if (!files.length) return null;
  const visible = files.slice(0, LIVE_LIMIT);
  const now = Date.now();
  const floatFile = runProcessMode === "detailed" && floatPath && (activeUntilRef.current.get(floatPath) ?? 0) > now
    ? visible.find((file) => file.path === floatPath) ?? null
    : null;
  return (
    <div className="live-edits" role="status" aria-label="正在编辑文件">
      {visible.map((file) => {
        const { name, dir } = segments(file.path);
        return (
          <div className="live-edit-item" key={file.path}>
            <div className="live-edit-row" title={file.path} ref={(el) => { rowRefs.current[file.path] = el; }}>
              <span className="live-edit-action"><Pencil size={12} /><em>编辑</em></span>
              <FileTypeIcon path={file.path} size={13} />
              <code>{name}</code>
              <small>{dir}</small>
              {/* ⛔ key 带数字：数字一变就重挂载 ⇒ 重放 live-tick 动画（就是「实时跳动」的观感）。 */}
              <span className="live-edit-stats" key={`${file.status}-${file.added}-${file.deleted}`}>
                {file.status === "deleted" ? <i className="completed-file-gone">已删除</i> : <><b>+{file.added}</b><i>-{file.deleted}</i></>}
              </span>
            </div>
          </div>
        );
      })}
      {files.length > LIVE_LIMIT && <div className="live-edits-more">还有 {files.length - LIVE_LIMIT} 个文件…</div>}
      {floatFile ? <LiveFileFloat file={floatFile} anchorRef={{ current: rowRefs.current[floatFile.path] ?? null }} onClose={() => setFloatPath("")} /> : null}
    </div>
  );
}

/** 运行计时：每秒刷新一次，显示本轮已跑多久。 */
export function RunningProcessTime({ turnId }: { turnId: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const totalSeconds = RUN_CLOCK.elapsedSeconds(turnId, now);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return <div className="running-process-time">正在处理 {minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`}</div>;
}

/** 上下文环：⛔ 分子只认「本轮 last」（当前上下文规模），`total` 是累计计费量，用了会显示成永远快满。 */
export function ContextRing({ tokenUsage, fallbackWindow }: { tokenUsage?: any; fallbackWindow?: number }) {
  const contextWindow = tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window ?? fallbackWindow;
  // ⛔ 分子只用「本轮 last」= **当前上下文规模**。`total` 是会话**累计计费量**（多轮累加，
  //    长会话必然超过窗口）⇒ 拿它当分子会把环顶到 100%，用户看到的就是「上下文爆了」
  //    （09-25 报障，实测某会话 total 969K/窗口 1048K 但真实上下文只有 65K）。
  const currentUsage = usageBucket(tokenUsage, "last");
  const used = currentUsage?.totalTokens ?? currentUsage?.total_tokens;
  if (!contextWindow) return null;
  // 有 contextWindow 但还没用量时仍显示图标占位（0%），让"上下文进度"始终可见
  const percent = used != null ? Math.min(100, Math.max(0, (used / contextWindow) * 100)) : 0;
  const label = used != null ? `${Math.round(percent)}%` : "—";
  const title = used != null ? `上下文 ${Math.round(percent)}% · ${Number(used).toLocaleString()} / ${Number(contextWindow).toLocaleString()} Token` : `上下文窗口 ${Number(contextWindow).toLocaleString()} Token · 用量未同步`;
  // 重度长上下文：接近窗口上限时变色预警（warn 80% / danger 95%），提示该压缩了
  const tone = percent >= 95 ? "danger" : percent >= 80 ? "warn" : "";
  return <span className={`context-ring ${tone}`} role="progressbar" aria-label="上下文用量" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} title={title}><CircleGauge size={13} /><small>{label}</small></span>;
}

function usageCacheRate(usage: any): number | null {
  const input = usageInputTokens(usage);
  if (input <= 0) return null;
  const cached = Math.min(input, usageCachedTokens(usage));
  return Math.round((cached / input) * 1000) / 10;
}

export type UsageCounterSnapshot = { input: number; cached: number; output: number; total: number };

/** 上下文用量徽标：点开看明细与最近一次压缩，可手动压缩。 */
export function ContextUsageBadge({ tokenUsage, fallbackWindow, recentCompaction, onCompact, running, compacting }: { tokenUsage?: any; fallbackWindow?: number; recentCompaction?: boolean; onCompact?: () => void; /** 本轮是否在跑（运行中禁止手动压缩） */ running?: boolean; /** 是否已有一个压缩在进行（禁止重复触发） */ compacting?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popLeft = useCenteredPopoverLeft(open, triggerRef, popRef);
  /**
   * 开合模型（11-22 用户三次口径，最终定稿）：
   *   · 悬停 → 弹出，**指针可以移进弹层**（徽标与弹层之间有 8px 空隙，穿过时不关）；
   *   · 指针离开徽标与弹层 → 自动消失（260ms 宽限，进弹层即取消）；
   *   · **点击图标 → 常驻**（此时移开鼠标也不关），点外面 / 按 Esc 关闭；再点图标收起。
   * ⛔ 旧实现两个 bug：`onMouseLeave` 立即关（空隙里就关掉）；`onClick` 直接取反 ——
   *    而 onMouseEnter 已经把弹层打开了，于是"鼠标挪上去点一下反而消失"。
   */
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const keep = () => {
    if (closeTimerRef.current != null) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  };
  const scheduleClose = () => {
    keep();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      /* 常驻态不因鼠标离开而关（用户：点击图标就让它留着）。 */
      if (!pinnedRef.current) setOpen(false);
    }, 260);
  };
  const closeAll = () => {
    keep();
    pinnedRef.current = false;
    setPinned(false);
    setOpen(false);
  };
  useEffect(() => () => keep(), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) closeAll(); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") closeAll(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const contextWindow = tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window ?? fallbackWindow;
  const lastUsage = usageBucket(tokenUsage, "last");
  const totalUsage = usageBucket(tokenUsage, "total");
  // ⛔ 百分比与「压缩上下文」提示只认**本轮 last**（= 当前上下文规模）；`total` 是会话累计计费量，
  //    长会话必然超过窗口 ⇒ 拿它当分子会把上下文顶到 100% 并在 70% 处误弹「压缩上下文」
  //    （09-25 用户报的「一切换供应商就爆上下文」症状来源之一）。
  const currentUsage = lastUsage;
  // 明细网格（消息 / MCP 工具 / 系统提示词…）与缓存率仍允许用 total 兜底，避免个别载荷缺 last 时整块空掉
  const breakdownUsage = lastUsage ?? totalUsage;
  const cacheUsage = tokenUsage?.derivedLast ?? breakdownUsage;
  const used = currentUsage?.totalTokens ?? currentUsage?.total_tokens;
  if (!contextWindow) return null;
  const percent = used != null ? Math.min(100, Math.max(0, (used / contextWindow) * 100)) : 0;
  const input = usageInputTokens(cacheUsage);
  const cached = Math.min(input, usageCachedTokens(cacheUsage));
  const turnCacheRate = usageCacheRate(cacheUsage);
  const averageCacheRate = totalUsage ? usageCacheRate(totalUsage) : null;
  const summaryCacheRate = averageCacheRate ?? turnCacheRate;
  const ctx = (value: any) => value != null ? Math.round((Number(value) / contextWindow) * 1000) / 10 : null;
  const details = [
    { label: "消息", value: ctx(breakdownUsage?.messageTokens ?? breakdownUsage?.message_tokens) },
    { label: "MCP 工具", value: ctx(breakdownUsage?.mcpToolTokens ?? breakdownUsage?.mcp_tool_tokens) },
    { label: "系统工具", value: ctx(breakdownUsage?.systemToolTokens ?? breakdownUsage?.system_tool_tokens) },
    { label: "技能", value: ctx(breakdownUsage?.skillTokens ?? breakdownUsage?.skill_tokens) },
    { label: "系统提示词", value: ctx(breakdownUsage?.systemPromptTokens ?? breakdownUsage?.system_prompt_tokens) },
    { label: "其他", value: ctx(breakdownUsage?.otherTokens ?? breakdownUsage?.other_tokens) },
  ].filter((entry) => entry.value != null) as { label: string; value: number }[];
  const rows = details.length ? details : [{ label: "已用", value: Math.round(percent * 10) / 10 }];
  return (
    <div className="ctx-badge" ref={wrapRef} onMouseEnter={keep} onMouseLeave={scheduleClose}>
      <button ref={triggerRef} type="button" className="ctx-badge-btn" aria-pressed={pinned} title={used != null ? `上下文 ${Math.round(percent)}%（点击${pinned ? "收起" : "常驻"}）` : `上下文窗口 ${contextWindow.toLocaleString()} Token · 用量待同步`} aria-label="上下文容量" onClick={() => {
        /* 点击 = 常驻开关（用户：「点击图标弹窗常驻，点击外面/Esc 关闭」）。
           悬停已经打开时不取反 —— 那正是「点一下反而消失」的老毛病。 */
        if (pinnedRef.current) { closeAll(); return; }
        keep();
        pinnedRef.current = true;
        setPinned(true);
        setOpen(true);
      }} onMouseEnter={() => { keep(); setOpen(true); }}>
        <ContextRing tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} />
      </button>
      {open && (
        <div ref={popRef} className="ctx-pop" role="dialog" aria-label="上下文容量明细" style={popLeft != null ? { left: popLeft } : undefined} onMouseEnter={keep} onMouseLeave={scheduleClose}>
          <div className="ctx-pop-head"><strong>上下文容量</strong></div>
          <div className="ctx-pop-sub">{used != null ? (used / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "0.0"}万/{(contextWindow / 10000).toLocaleString()}万（{used != null ? Math.round(percent * 10) / 10 : "—"}%{summaryCacheRate != null ? ` · 累计 ${summaryCacheRate}% 缓存` : ""}）</div>
          {/* ⛔ 分子超过配置窗口时必须解释，不能只显示一个封顶的 100%：09-30 用户看到
             「125.9万/104.8万」直接懵了（上游对超窗口请求照样放行，用量是上游原话）。
             说明三件事：数字是上游原话、引擎自动压缩在回合结束后执行（回合内不中断）、可手动立即压。 */}
          {used != null && used > contextWindow && <p className="ctx-pop-cache-note">本轮上游返回的输入量（{Number(used).toLocaleString()} Token）已超过配置的模型窗口（{Number(contextWindow).toLocaleString()}）—— 部分供应商会放宽窗口或把缓存命中计入用量，请求仍会执行。引擎的自动压缩在回合结束后进行（回合中不会打断）；也可以点下方按钮立即压缩。</p>}
          <div className="ctx-pop-bar"><i style={{ width: `${Math.max(2, percent)}%` }} /></div>
          {used == null && recentCompaction && <p className="ctx-pop-cache-note">上下文刚压缩过：压缩请求自身的用量不算当前占用，下一轮对话完成后会重新统计。</p>}
          <div className="ctx-pop-grid">
            {rows.map((entry) => (
              <div className="ctx-pop-cell" key={entry.label}>
                <span className="ctx-pop-cell-label">{entry.label}</span>
                <b className="ctx-pop-cell-value">{entry.value}%</b>
              </div>
            ))}
            {turnCacheRate != null && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">本轮缓存命中率</span><b className="ctx-pop-cell-value">{turnCacheRate}%</b></div>}
            {averageCacheRate != null && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">会话累计命中率</span><b className="ctx-pop-cell-value">{averageCacheRate}%</b></div>}
            {input > 0 && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">缓存输入</span><b className="ctx-pop-cell-value">{cached.toLocaleString()} / {input.toLocaleString()}</b></div>}
          </div>
          {turnCacheRate != null && turnCacheRate < 20 && input >= 8192 && <p className="ctx-pop-cache-note">{recentCompaction ? "上下文刚压缩过：提示词前缀已被重写，上游缓存需要 1~3 轮对话重建，期间命中率偏低属正常现象。" : "本轮缓存较低，通常是首次请求、恢复旧会话、上下文压缩、切换模型/供应商，或上游未复用相同提示词前缀导致。"}</p>}
          {/* 11-22 用户令：「压缩上下文」按钮**常驻**展示，已用 ≥30% 才可点，不到就灰色不可点。
              ⛔ 旧实现是 `percent >= 70` 才出现 —— 用户找不到入口（「我记得这个地方有个按钮」）。
              ⛔ 门槛定 30%：低于此压缩收益小于代价（压缩本身要跑一次模型，还会丢细节缓存）。
              ⛔⛔ 运行中一律不可点（用户点名的边界）：回合正在跑时压缩会与当前回合抢同一个会话，
                 引擎侧也会互相打断 —— 必须等回合结束。正在压缩时同样不可再点。 */}
          {onCompact && (() => {
            const tooLow = percent < 30;
            const blocked = Boolean(running) || Boolean(compacting);
            const reason = compacting ? "正在压缩上下文…" : running ? "本轮运行中，结束后才能压缩" : tooLow ? "上下文还不到 30%，暂不需要压缩" : "立即压缩当前会话上下文，腾出空间";
            return (
              <button
                type="button"
                className="ctx-pop-compact-btn"
                disabled={blocked || tooLow}
                title={reason}
                onClick={() => { closeAll(); onCompact(); }}
              >
                <Minimize2 size={13} />
                {compacting ? "正在压缩…" : running ? "压缩上下文（运行中不可用）" : `压缩上下文（已用 ${Math.round(percent)}%${tooLow ? " · 30% 后可点" : ""}）`}
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}
