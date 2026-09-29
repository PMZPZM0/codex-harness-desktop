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
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  getSmoothStepPath,
  type EdgeProps,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box, Clapperboard,
  Crosshair,
  GitBranch,
  LayoutGrid,
  ChevronDown,
  Sparkles,
  Loader2,
  Zap,
  Maximize2,
  Move,
  Plus,
  Redo2,
  Save,
  SquareDashed,
  MousePointerSquareDashed,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  Images,
  ListChecks,
  FolderOpen, } from "lucide-react";
import { DRAMA_GROUPS, DRAMA_NODE_DEFS, dramaGroupsFor, dramaNodeDef, dramaNodeFitsFlow, dramaStarterWorkflow, ecomImageStarterWorkflow, imageStarterWorkflow, legacyStarterSignature, model3dStarterWorkflow, upgradeLegacyStarterSnapshot, whiteboxStarterWorkflow } from "../../lib/drama-canvas-model.mjs";
import { dramaAgentPrompt, dramaBoardRelativePath } from "../../lib/drama-agent-prompts.mjs";
import { DramaActionsProvider, useDramaActions, type DramaActions, type ViewerTarget } from "./drama-actions";
import { DramaInspector } from "./DramaInspector";
import { readBoard } from "./drama-storage";
import { DramaMediaViewer } from "./DramaMediaViewer";
import { DramaResultsPanel } from "./DramaResultsPanel";
import { DramaProjectsPanel } from "./DramaProjectsPanel";
import { DramaNodeCard } from "./DramaNodeCard";
import { DramaTimeline } from "./DramaTimeline";
import { useDramaBoard, type DramaRFEdge, type DramaRFNode } from "./use-drama-board";
import { useDramaStory } from "./use-drama-story";

/** ⛔ 必须模块级常量：写成内联对象会让 React Flow 每帧重建节点类型 → 整图重挂。 */
/**
 * 自定义连线（09-29 用户：「用那条线就，那条线亮起来，动画」+「线没办法删」）。
 *  · **亮起来**：悬停 / 选中 / 两端卡片任一被选中 ⇒ 覆盖一条发光流动虚线（一眼看出哪条线在用）；
 *  · **能删**：线中点常驻一个小 ✕，点它删掉这根线；
 *  · **能改接**：拖线两端的圆点换到别的卡（edgesReconnectable + onReconnect）。
 *  ⛔ 不打开 Delete 键的全局删除：那会连**卡片**一起被键盘删掉，用户没要求且容易误删。
 */
function DramaEdgeLine({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style }: EdgeProps) {
  const actions = useDramaActions();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const picked = actions.board.selectedIds;
  const busySet = actions.story.busy;
  /* 「正在工作的那张卡」也点亮（09-29 用户：「卡片那个在工作，那个就亮起来」）——
     忙碌键是 `${nodeId}:${通道}`，所以按前缀就能认出哪张卡在跑。 */
  const working = [...busySet].some((k) => k.startsWith(`${source}:`) || k.startsWith(`${target}:`));
  const hot = Boolean(selected) || working || picked.includes(source) || picked.includes(target) || activeId === id;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {hot ? <path d={path} className="drama-canvas-edge-flow" /> : null}
      {/* 线中点的删除键：常驻显示（用户此前完全找不到删线的入口），悬停/选中时更明显 */}
      <EdgeLabelRenderer>
        <button
          className={`drama-canvas-edge-kill nodrag nopan${hot ? " is-hot" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title="删掉这根连线（也可以拖线两端的圆点改接别处）"
          onMouseEnter={() => setActiveId(id)}
          onMouseLeave={() => setActiveId((current) => (current === id ? null : current))}
          onClick={(e) => { e.stopPropagation(); actions.board.removeEdges([id]); }}
        >
          <X size={11} />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES: EdgeTypes = { "drama-edge": DramaEdgeLine };

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

/** 工作流类型判据（**唯一一处**）：画布上有分镜表/镜头/角色/场景卡 ⇒ 短剧工作流，否则生图工作流。
 *  ⛔ 抽成模块级函数而不是写两遍：顶部类型徽章与「切换」的查找逻辑必须同源，
 *    两份判据漂移会导致「显示短剧流、切换却找不到短剧画布」这类自相矛盾。
 */
function detectFlowType(nodes: Array<{ data?: any; kind?: string }>): "drama" | "image" {
  for (const node of nodes) {
    // ⛔ 两种形态都要认（09-29 实测踩到）：画布运行时是 ReactFlow 的 `{ data: { kind } }`；
    //    而 `readBoard().snapshot.nodes` 与分镜展开出来的是**扁平**的 `{ kind }`（没有 data 包装）
    //    ⇒ 只读 data 会让"查找同类型画布"永远找不到（切不过去，还静默新建一张）。
    const kind = String(node.data?.kind || node.kind || "");
    if (kind === "storyboard" || kind === "shot" || kind === "character" || kind === "location") return "drama";
  }
  return "image";
}

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
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [pendingMenuOpen, setPendingMenuOpen] = useState(false);   // 「待生成 N」的明细浮层（只看，不动手）
  /* 产物查看器（09-29 用户：「卡片里的图片没有预览功能」）—— 卡片缩略图与结果面板共用同一个 */
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
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
  /* 工作流类型（09-29）：按**节点构成**推断，刻意不持久化。
     判据：有分镜表 / 镜头 / 角色 / 场景卡 ⇒ 短剧工作流；否则生图工作流。
     好处：老画布自动适用（没有数据结构迁移）、用户手加了分镜表卡时类型自然跟着变
     （那一刻他确实在做短剧）。用户原话：「我现在新建的是生图工作流，没有生图和视频工作流切换」
     —— 病根是画布压根没有"这是什么工作流"这个概念，两种模板的 UI 全混在一起。 */
  const flow = useMemo(() => ({
    type: detectFlowType(board.nodes),
    empty: board.nodes.length === 0,
  }), [board.nodes]);
  /* 工作流具体名（09-29）：白模视频 / 3D 建模由**模板身份标记**（payload.flow）判定 ——
     建模板时在首卡 payload 写 flow，判定零猜测。无标记回退大类（短剧/生图）。
     tab 高亮仍用 flow.type（视频类 / 图像类两大类）：白模含 shot 卡 ⇒ 自动归视频类 ✓。 */
  const flowLabel = useMemo(() => {
    const mark = board.nodes.find((nd) => nd.data?.payload?.flow)?.data?.payload?.flow;
    if (mark === "whitebox") return "白模视频工作流";
    if (mark === "model3d") return "3D 建模工作流";
    if (mark === "ecom") return "电商出图工作流";
    return flow.type === "drama" ? "短剧工作流" : "生图工作流";
  }, [board.nodes, flow.type]);

  /* 工作流进度（09-28）：当前板「图 / 视频 / 配音」已完成数 + 素材·拍摄类卡中还没有产物的
     「待生成」数。实时跟随 board.nodes —— 让用户随时知道这条工作流走到哪了。
     ⛔ 09-29：pending 同时留一份**明细**（哪几张卡），顶栏那个数字要能说清自己从哪来
     （用户原话：「那个待生成 3 又是什么啊」—— 数字没有出处就是噪声）。 */
  const progress = useMemo(() => {
    let images = 0, videos = 0, audios = 0;
    const pendingCards: string[] = [];
    for (const node of board.nodes) {
      const kind = String(node.data?.kind || "");
      const p = (node.data?.payload || {}) as Record<string, any>;
      const hasImage = Boolean(p.first_frame || p.path || p.ref);
      const label = String(p.title || p.name || node.id);
      /* ⛔ 新增节点类型必须在这里登记（09-29 实测：漏了 imagegen ⇒ 电商工作流顶栏「待生成」只显示 1，
         其余五张没出图的生图卡根本没被计数 —— 数字说少了比不显示更误导）。 */
      if (kind === "image" || kind === "imagegen" || kind === "character" || kind === "location") {
        if (hasImage) images++; else pendingCards.push(label);
      } else if (kind === "shot") {
        if (p.video) videos++;
        else if (p.audio) audios++;
        else if (p.first_frame) { /* 有首帧还没出片，不算完成也不重复计图 */ }
        else pendingCards.push(label);
        if (p.first_frame) images++;
      }
    }
    return { images, videos, audios, pending: pendingCards.length, pendingCards };
  }, [board.nodes]);
  const actions = useMemo<DramaActions>(() => ({
    board,
    story,
    openInspector: (id: string) => { board.select([id], id); setInspectorOpen(true); },
    openMedia: (target: ViewerTarget) => setViewer(target),
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
    linkedShotRefs: (nodeId: string) => board.edges
      .filter((e) => e.source === nodeId)
      .map((e) => board.nodes.find((n) => n.id === e.target))
      .filter((n) => n && String(n.data?.kind) === "shot")
      .map((n) => ({ id: (n as DramaRFNode).id, payload: (n as DramaRFNode).data.payload || {} })),
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

  const createStarter = useCallback((kind: "drama" | "image" | "ecom" | "whitebox" | "model3d" = "drama") => {
    const snapshot = kind === "image" ? imageStarterWorkflow()
      : kind === "ecom" ? ecomImageStarterWorkflow()
      : kind === "whitebox" ? whiteboxStarterWorkflow()
      : kind === "model3d" ? model3dStarterWorkflow()
      : starterSnapshot();
    /* ⛔⛔ 这一行是**唯一**把快照写进画布的地方 —— 09-29 它被上一轮改 createStarter 时整行吞掉，
       症状是「tab 切换不过来 / 新建菜单点了没反应」但 notice 照弹（快照算了、提示弹了、画布空）。
       守卫【208】已补断言盯死这条接线：算了快照必须写进画布。 */
    board.replaceAll(snapshot, { resetHistory: true });
    fittedRef.current = false;
    window.setTimeout(() => fitAll(), 30);
    /* ⛔ 09-28 教训：提示里的动作名必须与卡片实际按钮一致（写「点生成」卡片上没有 = 用户找不到）。 */
    const hints: Record<typeof kind, string> = {
      drama: "短剧创作骨架已建立：先写剧本，再连角色、场景与分镜表",
      image: "生图工作流已就绪（三步）：① 在「写提示词」卡写下你要什么，例：一只橘猫坐在窗台上，暖色午后光；② 点「生图」，图会出在右边的「出图」卡；③ 想多要几张就再点一次「重出」，或把「写提示词」卡复制一张换个说法做对比",
      whitebox: "白模视频工作流已就绪：① 在 Blender 用简单几何体搭场景、相机路径打 keyframe（官方建议主体只保留躯体，别带四肢细节）；② 低质量渲染导出关键帧，拖进「白模关键帧」卡；③ 在「AI 渲染镜头」卡点「视频」出片（Seedance 2.5 官方支持白模参考渲染）",
      model3d: "3D 建模工作流已就绪：参考图 → Aholo Lux3D 生成 3D 资产（导出 GLB 放到工作目录，路径记到「3D 资产清单」卡）→ Blender 组装渲染。3D 生成通道暂未接入，先按卡片指引在 Lux3D 侧完成生成",
      /* ⛔ 提示里的动作名必须与卡片实际按钮逐字一致（守卫【192】口径）：
         「锁定主体」「生图」「重出」都是卡面上真实存在的按钮名。 */
      ecom: "电商出图工作流已就绪（素材包）：① 在「商品参考图」卡上传商品图；② 点各生图卡上的「锁定主体」，把商品图反推成一段固定主体描述（整套图共用 ⇒ 六类图是同一件商品）；③ 按顺序出图：白底图（母版）→ 主图 / SKU 图 / 场景图 / 买家秀 → 详情图（按「图块清单」逐块出，长图拼接需在外部完成）。额度够就点「重出」换一版",
    };
    pushNotice(hints[kind], "ok");
  }, [board, fitAll, pushNotice]);

  /** 切到另一种工作流（09-29 用户：「没有生图和视频两个工作流切换入口啊」）。
   *  一个画布 = 一种工作流 ⇒「切换」的真实语义是「换到那种工作流的画布」：
   *  已有同类型的板就切过去，没有就新建一张。
   *  ⛔ **原画布一定保留**（切走/新建都不动它）—— 用户的原话是"切换"，不是"替换"，
   *    把当前画布换掉会让人以为工作白做了；提示里也要写明怎么切回。 */
  const switchFlow = useCallback((type: "drama" | "image") => {
    if (flow.type === type) return;
    const label = type === "drama" ? "短剧工作流" : "生图工作流";
    const existing = board.boards.find((b) => b.name !== board.board && detectFlowType(readBoard(b.name).snapshot.nodes) === type);
    if (existing) {
      /* 09-29 用户「我这怎么又是旧的了」：切过去的那张若是**旧版模板**要说明白为什么它不一样。
         · 空壳旧模板：load() 会**自动升级**（这里不重复提示，让 load() 那条说话）；
         · 有内容的旧模板：绝不自动改 ⇒ 这里必须告诉用户"为什么没变 + 怎么要最新版"。 */
      const existingSnap = readBoard(existing.name).snapshot;
      const legacyWithContent = !upgradeLegacyStarterSnapshot(existingSnap) && !!legacyStarterSignature(existingSnap);
      board.switchBoard(existing.name);
      if (legacyWithContent) {
        pushNotice(`已切到${label}「${existing.title || existing.name}」—— 这张是旧版 5 卡模板，且里面已有你的内容，没有自动改；想要最新精简版就「+ 新建 ▾ → ${label}」`, "err");
      } else {
        pushNotice(`已切到${label}「${existing.title || existing.name}」`, "ok");
      }
      return;
    }
    createStarter(type);
    pushNotice(`当前还没有${label}的画布，已新建一张（原画布保留 —— 用左侧「画布」下拉可切回）`, "ok");
  }, [board, createStarter, flow.type, pushNotice]);

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
            {/* 09-29 用户三个问题（「两个下拉框不知道是什么」「没有生图和视频工作流切换」「待生成 3 是什么」）
                的共同病根：画布没有"这是什么工作流"的显式概念。现在标题直接显示**当前类型**
                （按画布上的卡片自动判断），点一下就是新建另一种工作流的入口。 */}
            <div>
              {/* ⛔ 09-29 用户：「没有生图和视频两个工作流切换入口啊」—— 上一版是个 15px 的小 ▾，
                  等于没有入口。改成两个**并列 tab**：当前类型高亮，点另一个即切换。 */}
              <div className="drama-canvas-flowtabs" role="tablist" aria-label="工作流类型">
                <button
                  type="button"
                  role="tab"
                  aria-selected={flow.type === "image"}
                  className={flow.type === "image" ? "is-active" : ""}
                  title={flow.type === "image" ? "当前是生图工作流（按画布上的卡片自动判断）" : "切到生图工作流：已有该类型的画布就切过去，没有就新建一张"}
                  onClick={() => switchFlow("image")}
                >{flow.type === "image" ? flowLabel : "生图工作流"}</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={flow.type === "drama"}
                  className={flow.type === "drama" ? "is-active" : ""}
                  title={flow.type === "drama" ? "当前是短剧工作流（按画布上的卡片自动判断）" : "切到短剧工作流（剧本→角色→分镜表→逐镜出片）：已有该类型的画布就切过去，没有就新建一张"}
                  onClick={() => switchFlow("drama")}
                >{flow.type === "drama" ? flowLabel : "短剧工作流"}</button>
              </div>
              <small>{flow.type === "drama" ? "剧本 → 角色 → 分镜表 → 逐镜出片" : "写提示词 → 出图 → 备注"}</small>
            </div>
            <label className="drama-canvas-select nodrag" title={`画布（项目）：一张画布 = 一个工作流。这里是切换/查看已有画布${workspace ? `\n工作文件夹：${workspace}` : "\n（还没选工作文件夹，生成产物不会落盘）"}`}>
              <span>画布</span>
              <AppSelect value={board.board} onChange={(v) => board.switchBoard(v)} ariaLabel="画布（项目）" options={board.boards.length ? board.boards.map((b) => ({ value: b.name, label: b.title || b.name })) : [{ value: "main", label: "main" }]} />
            </label>
            {/* 分镜表只属于短剧工作流 —— 生图流显示它是纯噪声（用户截图里那个「（尚无）」） */}
            {flow.type === "drama" ? (
              <label className="drama-canvas-select nodrag" title="分镜表：短剧的唯一真源（剧本/角色/场次/镜头），会同时存一份到工作区供引擎读取">
                <span>分镜表</span>
                <AppSelect value={story.storyName} onChange={(v) => story.switchStory(v)} ariaLabel="分镜表" options={story.stories.length ? story.stories.map((s) => ({ value: s.name, label: `${s.title || s.name} · ${s.shots} 镜` })) : [{ value: "main", label: "（尚无）" }]} />
              </label>
            ) : null}
            {/* ⛔ 09-28 工作流打磨：进度芯片 —— 当前板「图 / 视频 / 配音 / 待生成」实时计数，
                让用户随时知道这条工作流走到哪了（此前生成状态只能逐卡点开看）。
                ⛔ 09-29 顶栏窄：**0 值不渲染** —— 空画布只留「待生成 N」，宽窄随内容自适应，
                不再用固定三项把顶栏撑出去（用户截图：右边空一大块、按钮被挤到第二行）。
                ⛔ 09-29 二改（用户：「那个待生成 3 又是什么啊」）：数字必须有出处 —— 悬停列出
                是哪几张卡，点一下直接跑批量生成。悬空的一个数字就是噪声。 */}
            <div className="drama-canvas-progress nodrag">
              {progress.images > 0 ? <span className="is-ok" title="已出图的卡片数">图 {progress.images}</span> : null}
              {progress.videos > 0 ? <span className="is-ok" title="已出片的镜头数">视频 {progress.videos}</span> : null}
              {progress.audios > 0 ? <span className="is-ok" title="已配音的镜头数">配音 {progress.audios}</span> : null}
              {/* ⛔⛔ 09-29 用户：「我没有生成啊，怎么显示生成中」。
                  根因是我上一版把这个数字**做成了单击直接开跑**的按钮 —— 一个长成标签样子的元素
                  触发一个会调 API、会花钱的动作，用户点它只是想看"这 3 是什么"。
                  改：点开只**展开明细**（纯查看），明细里再给一个明确的主按钮才开跑。
                  ⛔ 明细做成**顶栏下方的展开条**而不是浮层：实测浮层会被 `.drama-canvas-shell`
                  的 `overflow: hidden`（圆角裁切，必须保留）切到只剩一条线；而画布祖先链有
                  backdrop-filter（创建 containing block），`position: fixed` 也逃不掉。
                  展开条是 shell 的直接子元素、不溢出 ⇒ 不会被裁、也不遮挡画布。
                  ⛔ 判据（守卫【204】）：这个按钮的 onClick 里**不许出现 generateBatch**。 */}
              {progress.pending > 0 ? (
                <button
                  className="drama-canvas-pending"
                  aria-expanded={pendingMenuOpen}
                  title={`还没生成产物的卡片（${progress.pending} 张）—— 点开看是哪几张`}
                  onClick={() => setPendingMenuOpen((v) => !v)}
                >
                  待生成 {progress.pending}
                </button>
              ) : <span className="is-done" title="这张画布上的卡片都有产物了">已完成 ✓</span>}
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
                      <Images size={13} /><span>生图工作流<small>写提示词 → 出图 → 备注</small></span>
                    </button>
                    <button role="menuitem" className="is-brand" onClick={() => { setNewMenuOpen(false); createStarter("ecom"); }}>
                      <Images size={13} /><span>电商出图工作流<small>白底母版 → 主图 / SKU / 详情 / 场景 / 买家秀 → 素材包</small></span>
                    </button>
                    <button role="menuitem" onClick={() => { setNewMenuOpen(false); createStarter("whitebox"); }}>
                      <Clapperboard size={13} /><span>白模视频工作流<small>Blender 白模预演 → Seedance 2.5 渲染成片</small></span>
                    </button>
                    <button role="menuitem" onClick={() => { setNewMenuOpen(false); createStarter("model3d"); }}>
                      <Box size={13} /><span>3D 建模工作流<small>参考图 → Aholo Lux3D 出 3D 资产 → Blender 组装</small></span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            {/* 09-29 批量一键生成（用户：「批量一键生成…完善一下」）。
                跑批中按钮就地变成进度 + 中止；空闲时是范围菜单（待生成 / 选中的）。
                视频只提交不等待 —— 上面那句写进 title，别让用户以为点了要等几十分钟。 */}
            {story.batch.running ? (
              <button className="drama-canvas-head-btn is-busy" title={`正在批量生成：${story.batch.label || "准备中"}（${story.batch.done}/${story.batch.total}）—— 点一下停止：正在跑的这张不打断，已提交的视频任务会继续（可在卡片上续查）`} onClick={() => story.stopBatch()}>
                <Loader2 size={13} className="is-spin" />{story.batch.done}/{story.batch.total} · 停止
              </button>
            ) : (
              <div className="drama-canvas-headmenu-wrap">
                <button className="drama-canvas-head-btn" aria-expanded={batchMenuOpen} title="批量一键生成：图片与配音真生成（并发 3），视频只提交任务不等结果" onClick={() => setBatchMenuOpen((v) => !v)}>
                  <Zap size={13} />批量生成<ChevronDown size={12} />
                </button>
                {batchMenuOpen ? (
                  <>
                    <div className="drama-canvas-headmenu-backdrop" onClick={() => setBatchMenuOpen(false)} />
                    <div className="drama-canvas-headmenu" role="menu">
                      <button role="menuitem" onClick={() => { setBatchMenuOpen(false); void story.generateBatch("pending"); }}>
                        <ListChecks size={13} />
                        <span>跑完待生成的<small>画布上还没产物的卡片{progress.pending ? `（约 ${progress.pending} 张）` : ""}：先出图/配音，再提交视频</small></span>
                      </button>
                      <button
                        role="menuitem"
                        disabled={!board.selectedIds.length}
                        onClick={() => { setBatchMenuOpen(false); void story.generateBatch("selected"); }}
                      >
                        <MousePointerSquareDashed size={13} />
                        <span>只跑选中的{board.selectedIds.length ? ` ${board.selectedIds.length} 张` : ""}<small>{board.selectedIds.length ? "已有产物也重新生成（当作重跑）" : "先在画布上选中卡片（Ctrl/Cmd 点选或框选）"}</small></span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
            <button className="drama-canvas-head-btn" title="管理所有画布项目：切换 / 重命名 / 删除 / 打开数据文件夹" onClick={() => { setProjectsOpen(true); setResultsOpen(false); }}><FolderOpen size={13} />项目</button>
            <button className="drama-canvas-head-btn" title="集中查看这张画布生成的图 / 视频 / 配音" onClick={() => { setResultsOpen(true); setInspectorOpen(false); }}><Images size={13} />结果</button>
            <button className="drama-canvas-head-btn" onClick={async () => {
              board.saveNow();
              /* ⛔ 三态、一条提示（09-29 用户：「我点击保存，提示这个，啥意思」——
                 此前按钮盲目乐观说"分镜表同时写到工作区"，写失败时再弹一条红错，两条自相矛盾）。 */
              const saved = await story.saveNow();
              if (saved.path) pushNotice("已保存：本机 + 工作区文件（Codex 会话读得到这份分镜表）", "ok");
              else if (!workspace) pushNotice("已保存到本机（分镜表只在本机）—— 给会话选个工作文件夹后，Codex 会话才读得到它", "");
              else pushNotice(`已保存到本机，但工作区文件写失败：${saved.error || "未知原因"} —— 确认那个工作文件夹还在，再保存一次`, "err");
            }}><Save size={13} />保存</button>
            <button className="drama-canvas-head-btn" onClick={onClose} title="退出画布"><X size={13} />退出</button>
          </div>
        </header>

        {/* 「待生成 N」的明细展开条（09-29）：点数字才展开，列清是哪几张卡 + 一个明确的生成按钮。
            ⛔ 刻意不是浮层：浮层会被 .drama-canvas-shell 的 overflow:hidden（圆角裁切）切掉
            —— 实测展开后只剩一条 12px 的白线，且按钮中心点 elementFromPoint 命中的是 #root。 */}
        {pendingMenuOpen && progress.pending > 0 ? (
          <div className="drama-canvas-pendingbar">
            <b>还没生成产物的卡片（{progress.pending} 张）</b>
            <div className="drama-canvas-pendingbar-list">
              {progress.pendingCards.slice(0, 12).map((label) => (
                <span className="drama-canvas-pending-item" key={label}>{label}</span>
              ))}
              {progress.pendingCards.length > 12 ? (
                <span className="drama-canvas-pending-item">…还有 {progress.pendingCards.length - 12} 张</span>
              ) : null}
            </div>
            <button
              className="drama-canvas-pending-go"
              title="图片/配音真生成（并发 3 条），视频只提交任务不等待；开始后顶栏可随时停止"
              onClick={() => { setPendingMenuOpen(false); void story.generateBatch("pending"); }}
            >
              <Zap size={13} />批量生成这 {progress.pending} 张
            </button>
            <button className="drama-canvas-pending-close" onClick={() => setPendingMenuOpen(false)}>收起</button>
          </div>
        ) : null}

        <div className="drama-canvas-toolbar">
          <div className="drama-canvas-addmenu">
            <button className="drama-canvas-tool" aria-expanded={addMenuOpen} title="添加节点" onClick={() => setAddMenuOpen((v) => !v)}><Plus size={14} /><span>添加节点</span></button>
            {addMenuOpen ? (
              <div className="drama-canvas-addmenu-body nowheel">
                {/* ⛔ 按**当前工作流**分流（09-29 用户：「节点未按生图工作流和视频工作流独立区分」）：
                    生图流只列生图用得上的（生图节点 / 参考图 / 笔记…），视频流才列剧本 / 角色 /
                    场景 / 分镜表 / 镜头 / 场次 / 剪辑。通用卡（笔记 / Agent / 参考图）两边都有。 */}
                <p className="drama-canvas-addmenu-note">
                  当前：<b>{flow.type === "image" ? flowLabel : "短剧工作流"}</b> —— 只列这条工作流用得上的节点；
                  换另一类工作流（顶栏 tab / 「+ 新建」）会看到另一套。
                </p>
                {dramaGroupsFor(flow.type).map((group) => (
                  <div className="drama-canvas-addmenu-group" key={group}>
                    <span className="drama-canvas-addmenu-label">{group}</span>
                    {Object.entries(DRAMA_NODE_DEFS).filter(([kind, def]) => def.group === group && dramaNodeFitsFlow(kind, flow.type)).map(([kind, def]) => (
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
                edgeTypes={EDGE_TYPES}
                onNodesChange={board.onNodesChange}
                onEdgesChange={board.onEdgesChange}
                onConnect={board.onConnect}
                onReconnect={board.onReconnect}
                edgesReconnectable
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
                  type: "drama-edge",
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
                  <li><strong>新建生图工作流</strong> —— 写提示词 → 出图 → 备注，专门出图</li>
                  <li><strong>新建电商出图工作流</strong> —— 商品参考图 → 白底母版 → 主图 / SKU / 详情 / 场景 / 买家秀 → 素材包清单</li>
                  <li><strong>画布</strong> = 一个方案一张板（左上角可切换/新建）；<strong>分镜表</strong> = 镜头的唯一真源，交给 Agent 生成时读的就是它</li>
                </ul>
                <small>从上面两个按钮挑一个开始；也可以在左侧「+ 添加节点」自己摆卡。</small>
              </div>
            ) : null}
          </div>
          {inspectorOpen ? <DramaInspector onClose={() => setInspectorOpen(false)} /> : null}
          {/* 生成结果（相册）：与检查器同一栏，互斥显示（同时开会把画布挤没） */}
          {viewer ? <DramaMediaViewer target={viewer} onClose={() => setViewer(null)} /> : null}
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

        {/* 镜头时间线只属于短剧工作流（它读的是分镜表的场次/镜头）。
            09-29：生图工作流下这条会显示「未绑定分镜表 0 镜 · 合计 0s / 还没有镜头…」
            —— 全是噪声（用户截图红框二）。按类型收敛掉。 */}
        {flow.type === "drama" ? (
          <DramaTimeline onFocusNode={(id) => { board.select([id], id); setInspectorOpen(true); centerOn(id); }} />
        ) : null}

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
