/**
 * AI 短剧无限画布（域入口视图）。
 *
 * 画布底座 = **React Flow（@xyflow/react，MIT）**。选它而不是参考实现用的 JointJS，理由只有一条：
 * 参考项目是**无构建**的静态页（`<script src>` 直引），React Flow 要打包所以被它淘汰；
 * 本项目本来就是 Vite + React，这条约束不存在 —— 而 React Flow 的节点就是 React 组件，
 * 主题变量、字体、无障碍全都天然生效（那正是参考实现挑底座时最看重的一条）。
 *
 * 交互按参考实现逐条对齐（不是"用 React Flow 的默认值"）：
 *  · 滚轮三源分流：ctrl/meta（触控板捏合）→ 指数连续缩放；deltaMode=1（鼠标格）→ 一格 8%；
 *    其余（按像素，触控板双指滑动）→ 平移。缩放**以光标为锚点**。
 *  · 空白左拖 = 平移；Shift 拖 / 开「框选」= 框选；中键与 Space 也可平移。
 *  · 缩放范围 0.12–1.8；节点 ≤10 个时「适配」的最小缩放取 0.62（⛔ 09-27 用户点名「卡片文字糊」：0.38 时 12.5px 字缩到 ~5px 再加分 数缩放栅格化必然糊；宁可出滚动条）。
 *  · 拖完立刻点不弹属性面板；删节点后提示里挂「撤销」；Cmd/Ctrl+Z / ⇧Z / Y、⌘A、Esc、Delete。
 */
import { AppSelect } from "../../components/AppSelect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Clapperboard,
  Crosshair,
  GitBranch,
  LayoutGrid,
  ChevronDown,
  Sparkles,
  Loader2,
  Maximize2,
  Move,
  Plus,
  Redo2,
  Save,
  SquareDashed,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  Images,
  FolderOpen,
} from "lucide-react";
import { DRAMA_GROUPS, DRAMA_NODE_DEFS, dramaNodeDef, dramaStarterWorkflow, imageStarterWorkflow } from "../../lib/drama-canvas-model.mjs";
import { dramaAgentPrompt, dramaBoardRelativePath } from "../../lib/drama-agent-prompts.mjs";
import { DramaActionsProvider, type DramaActions } from "./drama-actions";
import { DramaInspector } from "./DramaInspector";
import { DramaResultsPanel } from "./DramaResultsPanel";
import { DramaProjectsPanel } from "./DramaProjectsPanel";
import { DramaNodeCard } from "./DramaNodeCard";
import { DramaTimeline } from "./DramaTimeline";
import { useDramaBoard, type DramaRFEdge, type DramaRFNode } from "./use-drama-board";
import { useDramaStory } from "./use-drama-story";

/** ⛔ 必须模块级常量：写成内联对象会让 React Flow 每帧重建节点类型 → 整图重挂。 */
const NODE_TYPES: NodeTypes = { drama: DramaNodeCard };

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 1.8;
const FIT_PADDING = 64;
const INSPECTOR_WIDTH = 340;

export interface DramaCanvasProps {
  onClose: () => void;
  /** 当前会话的工作文件夹（"" = 未选）。分镜表文件副本与素材都落它下面 */
  workspace: string;
  /** 把一段任务描述交给 Agent：**选择目标会话后自动发送**（threadId=null=新建会话）。
   *  ⛔ 闭环在宿主侧完成（openThread/startNewThread + pendingCommandTextRef + send）——
   *  画布只负责「选谁」，不碰会话状态。 */
  onAskAgent?: (text: string, threadId: string | null) => void;
  /** 召唤内置专家团执行任务（teamId；不做则不显示专家选项） */
  onSummonTeam?: (teamId: string, text: string) => void;
  /** 会话列表（交给 Agent 选择器的数据源；不传则该入口不显示选择器） */
  threads?: Array<{ id: string; preview: string; name?: string | null; cwd: string; updatedAt: number }>;
  /** 打开时的画布名（侧栏入口带过来的） */
  initialBoard?: string;
  /** 打开「设置 → 插件」页（画布上点「去配置生图/视频」时用）。
   *  ⛔ 不传则画布只显示「未配置」文案、不显示跳转按钮（保持画布可独立渲染）。 */
  onOpenPluginSettings?: () => void;
}

interface Notice { id: number; text: string; tone: "ok" | "err" | ""; undo?: () => void }

export function DramaCanvas({ onClose, workspace, onAskAgent, onSummonTeam, threads, initialBoard, onOpenPluginSettings }: DramaCanvasProps) {
  const shellRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rfRef = useRef<ReactFlowInstance<DramaRFNode, DramaRFEdge> | null>(null);
  const fittedRef = useRef(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeSeq = useRef(0);

  const pushNotice = useCallback((text: string, tone: "ok" | "err" | "" = "", undo?: () => void) => {
    noticeSeq.current += 1;
    const id = noticeSeq.current;
    setNotices((current) => [...current.slice(-3), { id, text, tone, undo }]);
    window.setTimeout(() => setNotices((current) => current.filter((n) => n.id !== id)), undo ? 8000 : 3600);
  }, []);

  const board = useDramaBoard(pushNotice);
  const story = useDramaStory(workspace, board, pushNotice);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  /* 生成结果面板（09-28 用户要求）：原来生成完的图/视频只写在卡片里，散在工作区目录，
     没有一处能总览 —— 用户原话「相册也没有」。面板不扫盘，直接聚合当前画布各卡片的
     payload（image / video / audio / first_frame），点条目把视口飞到那张卡。 */
  const [resultsOpen, setResultsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [marquee, setMarquee] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [zoomText, setZoomText] = useState("100%");

  /* 侧栏入口可以带一个画布名进来 */
  useEffect(() => {
    if (initialBoard && initialBoard !== board.board) board.switchBoard(initialBoard);
    // 只在挂载时应用一次
  }, []);

  /* 焦点：键监听挂在 shell 上，但点完节点 activeElement 是 body —— 不收焦的话 Delete/⌘A 全没反应 */
  useEffect(() => {
    shellRef.current?.focus({ preventScroll: true });
  }, []);

  const nodeSize = useCallback((node: DramaRFNode) => {
    const style = (node.style || {}) as { width?: number; height?: number };
    const def = dramaNodeDef(node.data?.kind);
    return { width: Number(style.width) || def.width, height: Number(style.height) || def.height };
  }, []);

  /** 适配全部：口径同参考实现（扣掉检查器宽度、padding 64、节点少时最小缩放 0.38）。 */
  const fitAll = useCallback(() => {
    const rf = rfRef.current, wrap = viewportRef.current;
    if (!rf || !wrap) return;
    const nodes = board.nodes;
    if (!nodes.length) { pushNotice("画布里还没有节点"); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const size = nodeSize(node);
      minX = Math.min(minX, node.position.x); minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + size.width); maxY = Math.max(maxY, node.position.y + size.height);
    }
    const vw = Math.max(280, wrap.clientWidth - (inspectorOpen ? INSPECTOR_WIDTH : 0));
    const vh = Math.max(220, wrap.clientHeight);
    const minScale = nodes.length <= 10 ? 0.62 : MIN_ZOOM;
    const zoom = Math.min(1.6, Math.max(minScale, Math.min((vw - FIT_PADDING * 2) / (maxX - minX), (vh - FIT_PADDING * 2) / (maxY - minY))));
    rf.setViewport({ x: (vw - (maxX - minX) * zoom) / 2 - minX * zoom, y: (vh - (maxY - minY) * zoom) / 2 - minY * zoom, zoom });
    setZoomText(`${Math.round(zoom * 100)}%`);
  }, [board.nodes, inspectorOpen, nodeSize, pushNotice]);

  const centerOn = useCallback((nodeId: string) => {
    const rf = rfRef.current, wrap = viewportRef.current;
    const node = board.nodes.find((n) => n.id === nodeId);
    if (!rf || !wrap || !node) return;
    const size = nodeSize(node);
    const vw = Math.max(320, wrap.clientWidth - (inspectorOpen ? INSPECTOR_WIDTH : 0));
    const vh = Math.max(260, wrap.clientHeight);
    const zoom = rf.getViewport().zoom;
    rf.setViewport({ x: vw / 2 - (node.position.x + size.width / 2) * zoom, y: vh / 2 - (node.position.y + size.height / 2) * zoom, zoom });
  }, [board.nodes, inspectorOpen, nodeSize]);

  const zoomBy = useCallback((factor: number) => {
    const rf = rfRef.current, wrap = viewportRef.current;
    if (!rf || !wrap) return;
    const vp = rf.getViewport();
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor));
    const ox = wrap.clientWidth / 2, oy = wrap.clientHeight / 2;
    const ratio = next / vp.zoom;
    rf.setViewport({ x: ox - (ox - vp.x) * ratio, y: oy - (oy - vp.y) * ratio, zoom: next });
    setZoomText(`${Math.round(next * 100)}%`);
  }, []);

  const resetView = useCallback(() => {
    rfRef.current?.setViewport({ x: 0, y: 0, zoom: 1 });
    setZoomText("100%");
  }, []);

  /* 滚轮三源分流（原生非被动监听：React 的 onWheel 是被动注册的，preventDefault 无效） */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (evt: WheelEvent) => {
      const rf = rfRef.current;
      if (!rf) return;
      evt.preventDefault();
      evt.stopPropagation();
      const vp = rf.getViewport();
      const dx = Number(evt.deltaX) || 0, dy = Number(evt.deltaY) || 0;
      const zoomIntent = evt.ctrlKey || evt.metaKey || (evt.deltaMode === 1 && dy);
      if (!zoomIntent) {
        const unit = evt.deltaMode === 1 ? 16 : evt.deltaMode === 2 ? Math.max(200, el.clientHeight) : 1;
        if (!dx && !dy) return;
        rf.setViewport({ ...vp, x: vp.x - dx * unit, y: vp.y - dy * unit });
        return;
      }
      if (!dy) return;
      const factor = evt.deltaMode === 1 || Math.abs(dy) >= 50 ? (dy > 0 ? 0.92 : 1.08) : Math.exp(-Math.max(-10, Math.min(10, dy)) * 0.01);
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor));
      const rect = el.getBoundingClientRect();
      const ox = evt.clientX - rect.left, oy = evt.clientY - rect.top;
      const ratio = next / vp.zoom;
      rf.setViewport({ x: ox - (ox - vp.x) * ratio, y: oy - (oy - vp.y) * ratio, zoom: next });
      setZoomText(`${Math.round(next * 100)}%`);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* 首次有节点时自动适配一次（空画布不弹那句"还没有节点"） */
  useEffect(() => {
    if (fittedRef.current || !board.nodes.length) return;
    fittedRef.current = true;
    window.setTimeout(() => fitAll(), 30);
  }, [board.nodes.length, fitAll]);

  const selected = board.selectedIds;
  /* 命名弹层（⛔ Electron 不支持 window.prompt —— 点了直接抛错，之前「新建画布/分镜表
     没反应」就是这个）+ 交给 Agent 的会话选择器 */
  const [naming, setNaming] = useState<null | { kind: "board" | "story"; value: string }>(null);
  const [agentPicker, setAgentPicker] = useState<null | { text: string; target: string | null }>(null);
  /* 应用内确认弹层（09-28 用户要求）：⛔ 不用 window.confirm —— 原生弹窗会**抢走窗口焦点**，
     关掉后 WebContents 与输入框不回焦（用户实测「应用和输入框失焦」，要再点一下才能打字）。
     宿主已有 openAppConfirm，但它挂在设置面板那棵树里、画布浮层够不到 ⇒ 与 naming/agentPicker
     同款在域内自建一个，样式复用 drama-canvas-modal。 */
  const [confirmAsk, setConfirmAsk] = useState<null | { title: string; text: string; confirmLabel: string; onConfirm: () => void }>(null);
  const namingInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (naming) window.setTimeout(() => namingInputRef.current?.select(), 30);
  }, [naming]);
  const submitNaming = useCallback(() => {
    const name = naming?.value.trim();
    if (naming && name) {
      if (naming.kind === "board") { board.createBoard(name); fittedRef.current = false; }
      else void story.createStory(name).then(() => pushNotice("分镜表已建立，可拖入画布或让 Agent 生成", "ok"));
    }
    setNaming(null);
  }, [naming, board, story, pushNotice]);
  /* 工作流进度（09-28）：当前板「图 / 视频 / 配音」已完成数 + 素材·拍摄类卡中还没有产物的
     「待生成」数。实时跟随 board.nodes —— 让用户随时知道这条工作流走到哪了。 */
  const progress = useMemo(() => {
    let images = 0, videos = 0, audios = 0, pending = 0;
    for (const node of board.nodes) {
      const kind = String(node.data?.kind || "");
      const p = (node.data?.payload || {}) as Record<string, any>;
      const hasImage = Boolean(p.first_frame || p.path || p.ref);
      if (kind === "image" || kind === "character" || kind === "location") {
        if (hasImage) images++; else pending++;
      } else if (kind === "shot") {
        if (p.video) videos++;
        else if (p.audio) audios++;
        else if (p.first_frame) { /* 有首帧还没出片，不算完成也不重复计图 */ }
        else pending++;
        if (p.first_frame) images++;
      }
    }
    return { images, videos, audios, pending };
  }, [board.nodes]);
  const actions = useMemo<DramaActions>(() => ({
    board,
    story,
    openInspector: (id: string) => { board.select([id], id); setInspectorOpen(true); },
    askAgent: (id: string) => {
      const node = board.nodes.find((n) => n.id === id);
      if (!node || !onAskAgent) { pushNotice("这个入口没接上 Agent（宿主未提供）", "err"); return; }
      const text = dramaAgentPrompt({
        kind: String(node.data?.kind || ""),
        payload: node.data?.payload || {},
        storyboardPath: dramaBoardRelativePath(story.storyName),
        boardName: story.storyName,
      });
      if (!text) { pushNotice("这个类型的卡还没有配套的 Agent 任务模板", "err"); return; }
      // ⛔ 不再直接 onAskAgent（原来只是把文本塞进当前输入框，"交给哪个 agent"全凭运气）。
      //    弹会话选择器：选已有会话或新建，确认后由宿主切会话并自动发送 —— 这才是闭环。
      setAgentPicker({ text, target: null });
    },
    linkedShots: (nodeId: string) => board.edges
      .filter((e) => e.source === nodeId)
      .map((e) => board.nodes.find((n) => n.id === e.target))
      .filter((n) => n && String(n.data?.kind) === "shot")
      .map((n) => (n as DramaRFNode).data.payload || {}),
    boardNodeId: board.nodes.find((n) => String(n.data?.kind) === "storyboard")?.id || null,
    /* 09-28：未配置生成通道时卡片按钮直接跳「设置 → 插件」（原来点了才 notice 报错）。
       ⛔ 跳转前先关画布？不关 —— 用户在设置里配完回来还能接着画（浮层在设置面板之下，
       关掉设置就回到画布）。 */
    openGenSettings: () => { onOpenPluginSettings?.(); },
    openResults: () => setResultsOpen(true),
  }), [board, story, onAskAgent, onOpenPluginSettings, pushNotice]);

  /* 键盘：与参考实现同一套（Space 平移交给 React Flow 自己的 panActivationKeyCode） */
  const onKeyDown = useCallback((evt: React.KeyboardEvent) => {
    const target = evt.target as HTMLElement | null;
    if (target && target.closest?.("input,textarea,select,[contenteditable=true]")) return;
    const command = evt.metaKey || evt.ctrlKey;
    const key = evt.key.toLowerCase();
    if (command && key === "z") {
      evt.preventDefault();
      if (evt.shiftKey) { if (!board.redo()) return; } else if (!board.undo()) return;
      pushNotice(evt.shiftKey ? "已重做" : "已撤销", "", () => { if (evt.shiftKey) board.undo(); else board.redo(); });
      return;
    }
    if (command && key === "y") { evt.preventDefault(); board.redo(); return; }
    if (command && key === "a") {
      evt.preventDefault();
      board.select(board.nodes.map((n) => n.id));
      pushNotice(board.nodes.length ? `已全选 ${board.nodes.length} 个节点` : "画布里还没有节点");
      return;
    }
    if (evt.key === "Escape") {
      // ⛔ 有弹层时 Escape 先关弹层（09-28）：否则按了没反应，用户只能去点「取消」
      if (confirmAsk) { setConfirmAsk(null); return; }
      if (agentPicker) { setAgentPicker(null); return; }
      setMenu(null); setAddMenuOpen(false);
      if (selected.length || marquee) { setMarquee(false); board.select([]); }
      return;
    }
    if ((evt.key === "Delete" || evt.key === "Backspace") && selected.length) {
      evt.preventDefault();
      const count = selected.length;
      board.removeNodes(selected);
      pushNotice(`已删除 ${count} 个节点`, "", () => board.undo());
    }
  }, [agentPicker, board, confirmAsk, marquee, pushNotice, selected]);

  const createStarter = useCallback((kind: "drama" | "image" = "drama") => {
    const isImage = kind === "image";
    const snapshot = isImage ? imageStarterWorkflow() : starterSnapshot();
    board.replaceAll(snapshot, { resetHistory: true });
    fittedRef.current = false;
    window.setTimeout(() => fitAll(), 30);
    // ⛔ 09-28：提示里的按钮名必须与卡片上的实际按钮**逐字一致** —— 原来写「点『生成』即可」，
    //    而卡片上根本没有叫「生成」的按钮（用户照着找找不到）。现在按真实按钮名写。
    pushNotice(isImage
      ? "生图工作流已就绪：写好主提示词 → 在「出图 A / 出图 B」卡上点「生图 · 首帧」出图；要出片就点同一张卡的「视频」按钮（首次用需先在设置里配视频接口）"
      : "短剧创作骨架已建立：先写剧本，再连角色、场景与分镜表", "ok");
  }, [board, fitAll, pushNotice]);

  const dropFiles = useCallback(async (evt: React.DragEvent) => {
    evt.preventDefault();
    const files = Array.from(evt.dataTransfer?.files || []).filter((f) => /^(image|video|audio)\//i.test(f.type));
    if (!files.length) { pushNotice("只支持图片、视频或音频文件", "err"); return; }
    if (!workspace) { pushNotice("拖入素材要落盘到工作区，请先为会话选择工作文件夹", "err"); return; }
    const rf = rfRef.current;
    const origin = rf ? rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY }) : { x: 120, y: 120 };
    for (const [index, file] of files.slice(0, 6).entries()) {
      try {
        const base64 = await fileToBase64(file);
        const written = await window.codex.dramaCanvasAssetWrite({ workspace, name: file.name, base64, subdir: "uploads" });
        const path = String(written?.path || "");
        if (!path) continue;
        const kind = /^image\//i.test(file.type) ? "image" : /^video\//i.test(file.type) ? "video" : "audio";
        const def = dramaNodeDef(kind);
        board.addNode(kind, { title: file.name, path, url: path, role: "拖入素材" }, {
          x: Math.round(origin.x + index * 26 - def.width / 2),
          y: Math.round(origin.y + index * 26 - def.height / 2),
        });
      } catch (error) {
        pushNotice(`素材导入失败：${String((error as Error)?.message || error).slice(0, 120)}`, "err");
      }
    }
  }, [board, pushNotice, workspace]);

  const menuActions = useMemo(() => {
    const nodeId = menu?.nodeId || "";
    const node = nodeId ? board.nodes.find((n) => n.id === nodeId) : null;
    const payload = node?.data?.payload || {};
    const media = String(payload.first_frame || payload.ref || payload.path || payload.video || payload.audio || "");
    return [
      node ? { key: "agent", label: "交给 Agent", run: () => actions.askAgent(nodeId) } : null,
      node ? { key: "writeback", label: "写回分镜表", run: () => void story.writeBack(nodeId) } : null,
      node ? { key: "duplicate", label: "复制节点", run: () => { const p = node.position; const copy = { ...payload }; ["id", "board", "board_scene", "board_character"].forEach((k) => delete (copy as any)[k]); board.addNode(String(node.data?.kind || "note"), copy, { x: p.x + 42, y: p.y + 42 }); } } : null,
      media && node ? { key: "inspector", label: "打开属性面板", run: () => { board.select([nodeId], nodeId); setInspectorOpen(true); } } : null,
      node ? { key: "layout", label: "整理画布", run: () => board.autoLayout() } : null,
      node ? { key: "delete", label: "删除节点", danger: true, run: () => { board.removeNodes([nodeId]); pushNotice("节点已删除", "", () => board.undo()); } } : null,
      !node ? { key: "add-note", label: "添加笔记", run: () => board.addNode("note") } : null,
      !node ? { key: "add-image", label: "添加参考图", run: () => board.addNode("image") } : null,
      !node ? { key: "layout", label: "自动排版", run: () => board.autoLayout() } : null,
      !node ? { key: "fit", label: "适配全部节点", run: () => fitAll() } : null,
    ].filter(Boolean) as Array<{ key: string; label: string; danger?: boolean; run: () => void }>;
  }, [actions, board, fitAll, menu, pushNotice, story]);

  return (
    <div className="drama-canvas-backdrop" role="dialog" aria-modal="true" aria-label="AI 画布工作流">
      <section className="drama-canvas-shell" ref={shellRef} tabIndex={-1} onKeyDown={onKeyDown}>
        {/* ⛔ Provider 必须包住**整块**：检查器与时间线同样要读动作上下文。
            只包 ReactFlow 的话，一打开就 "useDramaActions 必须在 Provider 内使用" ——
            整屏 ErrorBoundary（实测踩过）。 */}
        <DramaActionsProvider value={actions}>
        <header className="drama-canvas-head">
          <div className="drama-canvas-head-left">
            <span className="drama-canvas-head-icon"><Clapperboard size={17} /></span>
            <div>
              <b>AI 画布工作流</b>
              <small>短剧：剧本拆卡逐镜出片；生图：需求 → 提示词 → 出图 A/B → 选图</small>
            </div>
            <label className="drama-canvas-select nodrag" title={workspace || "尚未选择工作文件夹"}>
              <span>画布</span>
              <AppSelect value={board.board} onChange={(v) => board.switchBoard(v)} ariaLabel="画布" options={board.boards.length ? board.boards.map((b) => ({ value: b.name, label: b.title || b.name })) : [{ value: "main", label: "main" }]} />
            </label>
            <label className="drama-canvas-select nodrag" title="分镜表是唯一真源，会同时存一份到工作区供引擎读取">
              <span>分镜表</span>
              <AppSelect value={story.storyName} onChange={(v) => story.switchStory(v)} ariaLabel="分镜表" options={story.stories.length ? story.stories.map((s) => ({ value: s.name, label: `${s.title || s.name} · ${s.shots} 镜` })) : [{ value: "main", label: "（尚无）" }]} />
            </label>
            {/* ⛔ 09-28 工作流打磨：进度芯片 —— 当前板「图 / 视频 / 配音 / 待生成」实时计数，
                让用户随时知道这条工作流走到哪了（此前生成状态只能逐卡点开看）。 */}
            <div className="drama-canvas-progress nodrag" title="当前画布的生成进度（素材卡 / 拍摄卡计入待生成）">
              <span className="is-ok">图 {progress.images}</span>
              <span className="is-ok">视频 {progress.videos}</span>
              <span className="is-ok">配音 {progress.audios}</span>
              {progress.pending > 0 ? <span className="is-warn">待生成 {progress.pending}</span> : <span className="is-done">已完成 ✓</span>}
            </div>
          </div>
          <div className="drama-canvas-head-actions">
            {/* 09-29 用户要求「按键布局调整一下，做好看一点」：四个「新建」此前各占一个按钮，
                窄窗口下顶栏被撑成两行。收成一个下拉菜单 —— 主按钮区一行放得下，菜单里带一句说明。 */}
            <div className="drama-canvas-headmenu-wrap">
              <button className="drama-canvas-head-btn is-primary" aria-expanded={newMenuOpen} title="新建画布 / 分镜表 / 模板工作流" onClick={() => setNewMenuOpen((open) => !open)}>
                <Plus size={13} />新建<ChevronDown size={12} />
              </button>
              {newMenuOpen ? (
                <>
                  <div className="drama-canvas-headmenu-backdrop" onClick={() => setNewMenuOpen(false)} />
                  <div className="drama-canvas-headmenu" role="menu">
                    <button role="menuitem" onClick={() => { setNewMenuOpen(false); setNaming({ kind: "board", value: "新画布" }); }}>
                      <LayoutGrid size={13} /><span>新建画布<small>空白画布：自己拖卡与连线</small></span>
                    </button>
                    <button role="menuitem" onClick={() => { setNewMenuOpen(false); setNaming({ kind: "story", value: "未命名短剧" }); }}>
                      <Clapperboard size={13} /><span>新建分镜表<small>唯一真源：剧本 / 角色 / 场次 / 镜头</small></span>
                    </button>
                    <div className="drama-canvas-headmenu-sep">从模板起手</div>
                    <button role="menuitem" className="is-brand" onClick={() => { setNewMenuOpen(false); createStarter("drama"); }}>
                      <Sparkles size={13} /><span>短剧工作流<small>剧本 → 角色 → 分镜 → 逐镜出片</small></span>
                    </button>
                    <button role="menuitem" className="is-brand" onClick={() => { setNewMenuOpen(false); createStarter("image"); }}>
                      <Images size={13} /><span>生图工作流<small>需求 → 主提示词 → 出图 A/B → 选图</small></span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            <button className="drama-canvas-head-btn" title="管理所有画布项目：切换 / 重命名 / 删除 / 打开数据文件夹" onClick={() => { setProjectsOpen(true); setResultsOpen(false); }}><FolderOpen size={13} />项目管理</button>
            <button className="drama-canvas-head-btn" title="集中查看这张画布生成的图 / 视频 / 配音" onClick={() => { setResultsOpen(true); setInspectorOpen(false); }}><Images size={13} />生成结果</button>
            <button className="drama-canvas-head-btn" onClick={() => { board.saveNow(); void story.saveNow(); pushNotice("已保存到本机" + (workspace ? "（分镜表同时写到工作区）" : ""), "ok"); }}><Save size={13} />保存</button>
            <button className="drama-canvas-head-btn" onClick={onClose} title="退出画布"><X size={13} />退出</button>
          </div>
        </header>

        <div className="drama-canvas-toolbar">
          <div className="drama-canvas-addmenu">
            <button className="drama-canvas-tool" aria-expanded={addMenuOpen} title="添加节点" onClick={() => setAddMenuOpen((v) => !v)}><Plus size={14} /><span>添加节点</span></button>
            {addMenuOpen ? (
              <div className="drama-canvas-addmenu-body nowheel">
                {DRAMA_GROUPS.map((group) => (
                  <div className="drama-canvas-addmenu-group" key={group}>
                    <span className="drama-canvas-addmenu-label">{group}</span>
                    {Object.entries(DRAMA_NODE_DEFS).filter(([, def]) => def.group === group).map(([kind, def]) => (
                      <button key={kind} className="drama-canvas-addmenu-item" title={def.subtitle} onClick={() => { board.addNode(kind); setAddMenuOpen(false); }}>
                        <Plus size={11} /><span>{def.label}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <span className="drama-canvas-tool-divider" />
          <button className="drama-canvas-tool" disabled={!board.canUndo} title="撤销（Ctrl/Cmd+Z）" onClick={() => board.undo()}><Undo2 size={14} /></button>
          <button className="drama-canvas-tool" disabled={!board.canRedo} title="重做（Ctrl/Cmd+Shift+Z）" onClick={() => board.redo()}><Redo2 size={14} /></button>
          <button className="drama-canvas-tool" title="按生成关系自动排版" onClick={() => board.autoLayout()}><GitBranch size={14} /></button>
          <button className={`drama-canvas-tool ${marquee ? "is-active" : ""}`} aria-pressed={marquee} title="框选：打开后拖空白就是框选（不开时按住 Shift 拖也一样）" onClick={() => setMarquee((v) => !v)}><SquareDashed size={14} /><span>框选</span></button>
          <span className="drama-canvas-tool-divider" />
          <span className="drama-canvas-tool-note" title="空白处拖动=平移；中键或按住空格也可平移">{marquee ? <SquareDashed size={12} /> : <Move size={12} />}{marquee ? "框选模式" : "平移模式"}</span>
          <div className="drama-canvas-zoombox">
            <button className="drama-canvas-tool" title="缩小" onClick={() => zoomBy(1 / 1.1)}><ZoomOut size={14} /></button>
            <span className="drama-canvas-zoom-text">{zoomText}</span>
            <button className="drama-canvas-tool" title="放大" onClick={() => zoomBy(1.1)}><ZoomIn size={14} /></button>
            <button className="drama-canvas-tool" title="适配全部节点" onClick={fitAll}><LayoutGrid size={14} />适配</button>
            <button className="drama-canvas-tool" title="居中选中节点" onClick={() => (selected[0] ? centerOn(selected[0]) : fitAll())}><Crosshair size={14} />居中</button>
            <button className="drama-canvas-tool" title="缩放复位" onClick={resetView}><Maximize2 size={14} />复位</button>
            <button className="drama-canvas-tool is-danger" title="清空这张画布（素材文件保留）" onClick={() => {
              if (!board.nodes.length) return;
              setConfirmAsk({
                title: "清空这张画布？",
                text: `${board.nodes.length} 个节点和全部连线会被删除，素材文件保留。`,
                confirmLabel: "确定",
                onConfirm: () => { board.clearBoard(); pushNotice("画布已清空", "", () => board.undo()); },
              });
            }}><Trash2 size={14} />清空</button>
          </div>
        </div>

        <div className={`drama-canvas-layout ${inspectorOpen ? "" : "is-inspector-hidden"}`}>
          <div
            className={`drama-canvas-viewport ${marquee ? "is-marquee" : ""}`}
            ref={viewportRef}
            onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
            onDrop={(e) => void dropFiles(e)}
            onPointerDown={(e) => { shellRef.current?.focus({ preventScroll: true }); const el = e.target as HTMLElement; if (!el.closest?.("input,textarea,select,button,a,[contenteditable=true]")) setMenu(null); }}
          >
            <ReactFlow
                nodes={board.nodes}
                edges={board.edges}
                nodeTypes={NODE_TYPES}
                onNodesChange={board.onNodesChange}
                onEdgesChange={board.onEdgesChange}
                onConnect={board.onConnect}
                onInit={(instance) => { rfRef.current = instance; }}
                onMove={(_, viewport) => setZoomText(`${Math.round(viewport.zoom * 100)}%`)}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                zoomOnScroll={false}
                panOnScroll={false}
                panOnDrag={!marquee}
                selectionOnDrag={marquee}
                selectNodesOnDrag
                deleteKeyCode={null}
                multiSelectionKeyCode={["Meta", "Control"]}
                selectionKeyCode="Shift"
                panActivationKeyCode="Space"
                nodesConnectable
                connectionRadius={28}
                onPaneContextMenu={(e) => { const evt = e as unknown as MouseEvent; evt.preventDefault(); setMenu({ x: evt.clientX, y: evt.clientY, nodeId: null }); }}
                onNodeContextMenu={(e, node) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id }); }}
                onNodeDoubleClick={(_, node) => { board.select([node.id], node.id); setInspectorOpen(true); }}
                onPaneClick={() => setMenu(null)}
                defaultEdgeOptions={{
                  type: "smoothstep",
                  style: { stroke: "var(--accent)", strokeWidth: 2.25, strokeLinecap: "round" },
                  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--accent)" },
                }}
                proOptions={{ hideAttribution: false }}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--line)" />
              </ReactFlow>
            <div className="drama-canvas-vp-hint" aria-hidden>滚轮缩放 · 空白拖动平移 · Shift 框选 · 空格拖拽平移</div>
            {/* 空画布引导（09-28 用户反馈「新建了然后呢，有什么用，完全看不懂」）：
                原来空画布就是一片白，没人说明这块板干什么、两个起手按钮区别在哪。
                ⛔ 只在真的空时显示（有节点就不该挡视野），纯提示不拦点击（pointer-events:none）。 */}
            {board.nodes.length === 0 ? (
              <div className="drama-canvas-blank-guide" aria-hidden>
                <Clapperboard size={26} />
                <b>这块画布还是空的</b>
                <ul>
                  <li><strong>新建短剧工作流</strong> —— 剧本 → 角色/场景 → 分镜表 → 出片，整条链路一次摆好</li>
                  <li><strong>新建生图工作流</strong> —— 需求 → 主提示词 → 出图 A/B → 选图，专门出图</li>
                  <li><strong>画布</strong> = 一个方案一张板（左上角可切换/新建）；<strong>分镜表</strong> = 镜头的唯一真源，交给 Agent 生成时读的就是它</li>
                </ul>
                <small>从上面两个按钮挑一个开始；也可以在左侧「+ 添加节点」自己摆卡。</small>
              </div>
            ) : null}
          </div>
          {inspectorOpen ? <DramaInspector onClose={() => setInspectorOpen(false)} /> : null}
          {/* 生成结果（相册）：与检查器同一栏，互斥显示（同时开会把画布挤没） */}
          {resultsOpen ? (
            <DramaResultsPanel
              onClose={() => setResultsOpen(false)}
              onLocate={(nodeId: string) => { board.select([nodeId], nodeId); centerOn(nodeId); }}
            />
          ) : null}
          {projectsOpen ? (
            <DramaProjectsPanel
              boards={board.boards}
              current={board.board}
              stories={story.stories}
              currentStory={story.storyName}
              workspace={workspace}
              onClose={() => setProjectsOpen(false)}
              onSwitch={(name: string) => board.switchBoard(name)}
              onRename={(name: string, title: string) => board.renameBoard(name, title)}
              onDelete={(name: string) => board.deleteBoardByName(name)}
              onNew={() => setNaming({ kind: "board", value: "新项目" })}
              onStorySwitch={(name: string) => story.switchStory(name)}
              onStoryRename={(name: string, title: string) => story.renameStory(name, title)}
              onStoryDelete={(name: string) => void story.deleteStory(name)}
              onStoryNew={() => setNaming({ kind: "story", value: "新分镜表" })}
            />
          ) : null}
        </div>

        <DramaTimeline onFocusNode={(id) => { board.select([id], id); setInspectorOpen(true); centerOn(id); }} />

        {menu ? (
          <div className="drama-canvas-context" style={{ left: menu.x, top: menu.y }} role="menu">
            {menuActions.map((item) => (
              <button key={item.key} className={item.danger ? "is-danger" : ""} onClick={() => { setMenu(null); item.run(); }}>{item.label}</button>
            ))}
          </div>
        ) : null}

        <div className="drama-canvas-notices" aria-live="polite">
          {notices.map((n) => (
            <div className={`drama-canvas-notice ${n.tone ? `is-${n.tone}` : ""}`} key={n.id}>
              <span>{n.text}</span>
              {n.undo ? <button onClick={() => { n.undo?.(); setNotices((current) => current.filter((x) => x.id !== n.id)); }}>撤销</button> : null}
            </div>
          ))}
        </div>

        {story.problems.length && !board.nodes.some((n) => String(n.data?.kind) === "storyboard") ? (
          <div className="drama-canvas-story-warn">
            {story.problems[0]}
            {story.problems.length > 1 ? `（共 ${story.problems.length} 条，详见检查器）` : ""}
          </div>
        ) : null}

        {confirmAsk ? (
          <div className="drama-canvas-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmAsk(null); }}>
            <div className="drama-canvas-modal" role="alertdialog" aria-label={confirmAsk.title}>
              <b>{confirmAsk.title}</b>
              <p className="drama-canvas-modal-note">{confirmAsk.text}</p>
              <div className="drama-canvas-modal-row">
                <button type="button" className="drama-canvas-btn is-ghost" autoFocus onClick={() => setConfirmAsk(null)}>取消</button>
                <button
                  type="button"
                  className="drama-canvas-btn is-danger"
                  onClick={() => { const run = confirmAsk.onConfirm; setConfirmAsk(null); run(); }}
                >{confirmAsk.confirmLabel}</button>
              </div>
            </div>
          </div>
        ) : null}

        {naming ? (
          <div className="drama-canvas-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setNaming(null); }}>
            <form className="drama-canvas-modal" onSubmit={(e) => { e.preventDefault(); submitNaming(); }}>
              <b>{naming.kind === "board" ? "新建画布" : "新建分镜表"}</b>
              <input
                ref={namingInputRef}
                className="drama-canvas-modal-input"
                value={naming.value}
                autoFocus
                onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Escape") setNaming(null); }}
              />
              <div className="drama-canvas-modal-row">
                <button type="button" className="drama-canvas-btn is-ghost" onClick={() => setNaming(null)}>取消</button>
                <button type="submit" className="drama-canvas-btn is-brand">创建</button>
              </div>
            </form>
          </div>
        ) : null}

        {agentPicker ? (
          <div className="drama-canvas-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setAgentPicker(null); }}>
            <div className="drama-canvas-modal is-wide">
              <b>把任务交给哪个会话？</b>
              <p className="drama-canvas-modal-note">选定后自动切换到该会话并直接发送任务描述；「新建会话」会开一个全新会话来跑。</p>
              <div className="drama-canvas-thread-list">
                <button
                  className={`drama-canvas-thread-item ${agentPicker.target === null ? "is-target" : ""}`}
                  onClick={() => setAgentPicker({ ...agentPicker, target: null })}
                >
                  <Plus size={13} /><b>新建会话</b><span>开一个全新会话执行这个任务</span>
                </button>
                {(threads ?? []).slice(0, 14).map((thread) => (
                  <button
                    key={thread.id}
                    className={`drama-canvas-thread-item ${agentPicker.target === thread.id ? "is-target" : ""}`}
                    title={thread.cwd}
                    onClick={() => setAgentPicker({ ...agentPicker, target: thread.id })}
                  >
                    <b>{thread.name || thread.preview.slice(0, 40) || thread.id.slice(0, 8)}</b>
                    <span>{thread.cwd.split(/[\\/]/).pop() || thread.cwd} · {thread.preview.slice(0, 46)}</span>
                  </button>
                ))}
              </div>
              {onSummonTeam ? (
                <div className="drama-canvas-expert-row">
                  <span className="drama-canvas-expert-label">或直接召唤内置专家团（自动新建会话）：</span>
                  <button className="drama-canvas-btn" onClick={() => { const picked = agentPicker; setAgentPicker(null); onSummonTeam("video-production-team", picked.text); onClose(); }}>🎬 视频制作专家团</button>
                  <button className="drama-canvas-btn" onClick={() => { const picked = agentPicker; setAgentPicker(null); onSummonTeam("image-gen-expert", picked.text); onClose(); }}>🖼️ 生图专家</button>
                </div>
              ) : null}
              <div className="drama-canvas-modal-row">
                <button type="button" className="drama-canvas-btn is-ghost" onClick={() => setAgentPicker(null)}>取消</button>
                <button
                  type="button"
                  className="drama-canvas-btn is-brand"
                  onClick={() => {
                    const picked = agentPicker;
                    setAgentPicker(null);
                    onAskAgent?.(picked.text, picked.target);
                    onClose();
                  }}
                >发送并退出画布</button>
              </div>
            </div>
          </div>
        ) : null}
        </DramaActionsProvider>
      </section>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.readAsDataURL(file);
  });
}

function starterSnapshot() {
  return dramaStarterWorkflow();
}
