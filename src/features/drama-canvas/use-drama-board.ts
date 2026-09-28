/**
 * 无限画布的**状态骨**（域内私有）：节点/连线、选中、撤销重做、持久化、多画布切换。
 *
 * 为什么用快照式撤销而不是"反向操作"：这张图上一次操作可能同时动十几张卡
 * （框选删除、自动排版、展开分镜表），写反向操作等于为每种操作各写一份逆运算，
 * 漏一个就是"撤销之后图坏了"。快照式只有一份实现，代价是内存 —— 上限 60 步封顶。
 *
 * 参考实现：CatCatUncle/openworkbuddy `app-07-canvas-nodes.js`（快照 + 260ms 防抖 + flush）。
 * ⛔ 只借鉴做法，未复制其代码。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import {
  DRAMA_SNAPSHOT_VERSION,
  dramaAutoLayout,
  dramaDefaultPayload,
  dramaDefaultRelation,
  dramaNextNodeId,
  dramaNextShotId,
  dramaNodeDef,
  dramaSnapshotKey,
  type DramaEdge,
  type DramaSnapshot,
} from "../../lib/drama-canvas-model.mjs";
import * as store from "./drama-storage";

export type DramaNodeData = { kind: string; payload: Record<string, any> };
export type DramaRFNode = Node<DramaNodeData>;
export type DramaRFEdge = Edge<{ relation: string }>;

const HISTORY_LIMIT = 60;
const HISTORY_DEBOUNCE_MS = 260;
const SAVE_DEBOUNCE_MS = 800;

export function dramaEdgeId(source: string, target: string): string {
  return `e:${source}->${target}`;
}

function edgeEndpoint(endpoint: DramaEdge["source"]): string {
  if (typeof endpoint === "string") return endpoint;
  return String((endpoint && endpoint.id) || "");
}

function rfNodesFrom(snapshot: DramaSnapshot): DramaRFNode[] {
  return snapshot.nodes.map((n) => ({
    id: n.id,
    type: "drama",
    position: { x: n.position.x, y: n.position.y },
    data: { kind: n.kind, payload: { ...n.payload } },
    // ⛔ 尺寸写进 style，不写 width/height：后者是 React Flow 的**实测值**，由它量完回写。
    //    我们写进去会被当成"已经量过"，缩放/自适应就算错。
    style: { width: n.size.width, height: n.size.height },
  }));
}

function rfEdgesFrom(snapshot: DramaSnapshot): DramaRFEdge[] {
  return snapshot.edges
    .map((e) => ({ source: edgeEndpoint(e.source), target: edgeEndpoint(e.target), relation: e.relation }))
    .filter((e) => e.source && e.target)
    .map((e) => ({
      id: dramaEdgeId(e.source, e.target),
      source: e.source,
      target: e.target,
      type: "smoothstep",
      data: { relation: String(e.relation || "input") },
    }));
}

/** React Flow 的节点/连线 → 快照（落盘与撤销栈共用这一份口径）。 */
export function dramaSerialize(nodes: DramaRFNode[], edges: DramaRFEdge[]): DramaSnapshot {
  return {
    version: DRAMA_SNAPSHOT_VERSION,
    nodes: nodes.map((n) => {
      const def = dramaNodeDef(n.data?.kind);
      const style = (n.style || {}) as { width?: number; height?: number };
      return {
        id: n.id,
        kind: String(n.data?.kind || "note"),
        payload: { ...(n.data?.payload || {}) },
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        size: { width: Number(style.width) || def.width, height: Number(style.height) || def.height },
      };
    }),
    edges: edges.map((e) => ({ source: { id: e.source }, target: { id: e.target }, relation: String(e.data?.relation || "input") })),
    updatedAt: Date.now(),
  };
}

export interface DramaBoardApi {
  board: string;
  boards: store.BoardMeta[];
  nodes: DramaRFNode[];
  edges: DramaRFEdge[];
  onNodesChange: (changes: NodeChange<DramaRFNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<DramaRFEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  selectedIds: string[];
  anchor: string | null;
  select: (ids: string[], anchor?: string) => void;
  addNode: (kind: string, payload?: Record<string, any>, position?: { x: number; y: number }) => DramaRFNode;
  updatePayload: (id: string, patch: Record<string, any>) => void;
  updateManyPayloads: (entries: Array<{ id: string; patch: Record<string, any> }>) => void;
  removeNodes: (ids: string[]) => void;
  setRelation: (edgeId: string, relation: string) => void;
  replaceAll: (snapshot: DramaSnapshot, options?: { resetHistory?: boolean }) => void;
  mergeNodes: (incomingNodes: DramaSnapshot["nodes"], incomingEdges: DramaSnapshot["edges"]) => number;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  autoLayout: () => void;
  clearBoard: () => void;
  switchBoard: (name: string) => void;
  createBoard: (title: string) => string;
  deleteBoard: () => void;
  /** 改项目显示标题（项目管理面板用；name 标识不动） */
  renameBoard: (name: string, title: string) => void;
  /** 按名删除项目（当前板走 deleteBoard 的切换逻辑） */
  deleteBoardByName: (name: string) => void;
  saveNow: () => void;
  savedAt: number;
  nextShotId: (sceneId?: string) => string;
}

/**
 * @param onNotice 给用户的轻提示（toast）。域内不直接引宿主的 toast 组件 —— 域不知道宿主长什么样。
 */
export function useDramaBoard(onNotice: (text: string, tone?: "ok" | "err") => void): DramaBoardApi {
  const [board, setBoard] = useState(() => store.listBoards()[0]?.name || "main");
  const [boards, setBoards] = useState(() => store.listBoards());
  const [nodes, setNodes] = useState<DramaRFNode[]>([]);
  const [edges, setEdges] = useState<DramaRFEdge[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState(0);
  const [history, setHistory] = useState<DramaSnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const anchorRef = useRef<string | null>(null);
  const nodesRef = useRef<DramaRFNode[]>([]);
  const edgesRef = useRef<DramaRFEdge[]>([]);
  const historyRef = useRef<DramaSnapshot[]>([]);
  const indexRef = useRef(-1);
  const historyTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const muteHistory = useRef(false);
  const loadedBoard = useRef("");

  nodesRef.current = nodes;
  edgesRef.current = edges;
  historyRef.current = history;
  indexRef.current = historyIndex;

  const serializeNow = useCallback(() => dramaSerialize(nodesRef.current, edgesRef.current), []);

  /* ------------------------------------------------------------- 撤销栈 */

  /** 压一步。**列表与下标必须一起改**（分两个 setState 会错位），所以这里自己算完再落 state。 */
  const pushSnapshot = useCallback((snapshot: DramaSnapshot) => {
    const list = historyRef.current.slice(0, indexRef.current + 1);
    const last = list[list.length - 1];
    if (last && dramaSnapshotKey(last) === dramaSnapshotKey(snapshot)) return;
    const nextList = [...list, snapshot].slice(-HISTORY_LIMIT);
    historyRef.current = nextList;
    indexRef.current = nextList.length - 1;
    setHistory(nextList);
    setHistoryIndex(indexRef.current);
  }, []);

  const scheduleHistory = useCallback((snapshot: DramaSnapshot) => {
    if (muteHistory.current) return;
    if (historyTimer.current) window.clearTimeout(historyTimer.current);
    historyTimer.current = window.setTimeout(() => { historyTimer.current = null; pushSnapshot(snapshot); }, HISTORY_DEBOUNCE_MS);
  }, [pushSnapshot]);

  /** 把防抖里那一步立刻落进栈。删节点/撤销前调它 —— 否则撤销会退到"拖之前"，而不是"刚拖完"。 */
  const flushHistory = useCallback(() => {
    if (historyTimer.current) { window.clearTimeout(historyTimer.current); historyTimer.current = null; }
    if (!muteHistory.current) pushSnapshot(serializeNow());
  }, [pushSnapshot, serializeNow]);

  const applySnapshot = useCallback((snapshot: DramaSnapshot) => {
    muteHistory.current = true;
    const rf = rfNodesFrom(snapshot);
    const rfE = rfEdgesFrom(snapshot);
    nodesRef.current = rf;
    edgesRef.current = rfE;
    setNodes(rf);
    setEdges(rfE);
    setSelectedIds((ids) => {
      const alive = new Set(rf.map((n) => n.id));
      return ids.filter((id) => alive.has(id));
    });
    muteHistory.current = false;
  }, []);

  const undo = useCallback(() => {
    flushHistory();
    if (indexRef.current <= 0) { onNotice("已经是最早一步了"); return false; }
    indexRef.current -= 1;
    setHistoryIndex(indexRef.current);
    applySnapshot(historyRef.current[indexRef.current]);
    return true;
  }, [applySnapshot, flushHistory, onNotice]);

  const redo = useCallback(() => {
    flushHistory();
    if (indexRef.current >= historyRef.current.length - 1) { onNotice("已经是最新一步了"); return false; }
    indexRef.current += 1;
    setHistoryIndex(indexRef.current);
    applySnapshot(historyRef.current[indexRef.current]);
    return true;
  }, [applySnapshot, flushHistory, onNotice]);

  /* ------------------------------------------------------------- 持久化 */

  const persist = useCallback(() => {
    const snapshot = serializeNow();
    store.writeBoard(board, snapshot);
    setBoards(store.upsertBoard({ name: board, title: board, nodes: snapshot.nodes.length, updatedAt: snapshot.updatedAt }));
    setSavedAt(snapshot.updatedAt);
  }, [board, serializeNow]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { saveTimer.current = null; persist(); }, SAVE_DEBOUNCE_MS);
  }, [persist]);

  const saveNow = useCallback(() => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    persist();
  }, [persist]);

  /** 载入一张画布：铺快照 + **重置撤销栈**（新画布不该能撤销回上一张的内容）。 */
  const load = useCallback((name: string) => {
    const { snapshot, repaired } = store.readBoard(name);
    const rf = rfNodesFrom(snapshot);
    const rfE = rfEdgesFrom(snapshot);
    nodesRef.current = rf;
    edgesRef.current = rfE;
    setNodes(rf);
    setEdges(rfE);
    setSelectedIds([]);
    anchorRef.current = null;
    historyRef.current = [snapshot];
    indexRef.current = 0;
    setHistory([snapshot]);
    setHistoryIndex(0);
    setSavedAt(snapshot.updatedAt || Date.now());
    loadedBoard.current = name;
    if (repaired.length) onNotice(`这张画布有 ${repaired.length} 处数据问题，已按可用的部分打开`);
  }, [onNotice]);

  useEffect(() => {
    if (loadedBoard.current === board) return;
    load(board);
  }, [board, load]);

  /* --------------------------------------------------------------- 变更 */

  const onNodesChange = useCallback((changes: NodeChange<DramaRFNode>[]) => {
    if (changes.some((c) => c.type === "remove")) {
      // 删节点走 removeNodes（它知道要连带删线），这里只把 RF 发来的 remove 变更吃掉
    }
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      nodesRef.current = next;
      return next;
    });
    if (changes.some((c) => c.type === "select")) {
      setSelectedIds((current) => {
        const set = new Set(current);
        for (const c of changes) if (c.type === "select") { if (c.selected) set.add(c.id); else set.delete(c.id); }
        return [...set];
      });
    }
    if (changes.some((c) => c.type === "position")) { scheduleHistory(serializeNow()); scheduleSave(); }
    if (changes.some((c) => c.type === "dimensions")) scheduleSave();
  }, [scheduleHistory, scheduleSave, serializeNow]);

  const onEdgesChange = useCallback((changes: EdgeChange<DramaRFEdge>[]) => {
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current);
      edgesRef.current = next;
      return next;
    });
    if (changes.some((c) => c.type === "remove")) { scheduleHistory(serializeNow()); scheduleSave(); }
  }, [scheduleHistory, scheduleSave, serializeNow]);

  const onConnect = useCallback((connection: Connection) => {
    const source = String(connection.source || "");
    const target = String(connection.target || "");
    if (!source || !target || source === target) return;
    if (edgesRef.current.some((e) => e.source === source && e.target === target)) return;
    const sourceKind = String(nodesRef.current.find((n) => n.id === source)?.data?.kind || "");
    const targetKind = String(nodesRef.current.find((n) => n.id === target)?.data?.kind || "");
    const next: DramaRFEdge[] = [...edgesRef.current, {
      id: dramaEdgeId(source, target),
      source,
      target,
      type: "smoothstep",
      data: { relation: dramaDefaultRelation(sourceKind, targetKind) },
    }];
    edgesRef.current = next;
    setEdges(next);
    flushHistory();
    scheduleHistory(serializeNow());
    scheduleSave();
  }, [flushHistory, scheduleHistory, scheduleSave, serializeNow]);

  const select = useCallback((ids: string[], anchor?: string) => {
    const set = new Set(ids);
    setNodes((current) => {
      const next = current.map((n) => (Boolean(n.selected) === set.has(n.id) ? n : { ...n, selected: set.has(n.id) }));
      nodesRef.current = next;
      return next;
    });
    setSelectedIds([...ids]);
    anchorRef.current = anchor || ids[0] || null;
  }, []);

  const addNode = useCallback((kind: string, payload?: Record<string, any>, position?: { x: number; y: number }) => {
    const def = dramaNodeDef(kind);
    const count = nodesRef.current.length;
    let nextPayload: Record<string, any> = { ...dramaDefaultPayload(kind), ...(payload || {}) };
    // 新镜头没给镜号就取下一个空号；展开分镜表自带镜号、恢复存档带 id，都不走这里
    if (kind === "shot" && !String(nextPayload.id || "").trim()) {
      const shots = nodesRef.current.filter((n) => n.data?.kind === "shot").map((n) => n.data.payload);
      nextPayload = { ...nextPayload, id: dramaNextShotId(shots, String(nextPayload.board_scene || "")) };
    }
    const node: DramaRFNode = {
      id: dramaNextNodeId(kind),
      type: "drama",
      position: position || { x: 80 + (count % 3) * 400, y: 80 + Math.floor(count / 3) * 300 },
      data: { kind, payload: nextPayload },
      style: { width: def.width, height: def.height },
      selected: true,
    };
    const next = [...nodesRef.current.map((n) => (n.selected ? { ...n, selected: false } : n)), node];
    nodesRef.current = next;
    setNodes(next);
    setSelectedIds([node.id]);
    anchorRef.current = node.id;
    scheduleHistory(serializeNow());
    scheduleSave();
    return node;
  }, [scheduleHistory, scheduleSave, serializeNow]);

  const updatePayload = useCallback((id: string, patch: Record<string, any>) => {
    setNodes((current) => {
      const next = current.map((n) => (n.id === id ? { ...n, data: { ...n.data, payload: { ...n.data.payload, ...patch } } } : n));
      nodesRef.current = next;
      return next;
    });
    scheduleHistory(serializeNow());
    scheduleSave();
  }, [scheduleHistory, scheduleSave, serializeNow]);

  const updateManyPayloads = useCallback((entries: Array<{ id: string; patch: Record<string, any> }>) => {
    if (!entries.length) return;
    const map = new Map(entries.map((e) => [e.id, e.patch]));
    setNodes((current) => {
      const next = current.map((n) => (map.has(n.id) ? { ...n, data: { ...n.data, payload: { ...n.data.payload, ...map.get(n.id) } } } : n));
      nodesRef.current = next;
      return next;
    });
    scheduleHistory(serializeNow());
    scheduleSave();
  }, [scheduleHistory, scheduleSave, serializeNow]);

  const removeNodes = useCallback((ids: string[]) => {
    const set = new Set(ids);
    if (!set.size) return;
    flushHistory();   // 刚拖完一张卡紧接着删，那一步还在防抖里 —— 不先记下来，撤销会退到拖之前
    const nextNodes = nodesRef.current.filter((n) => !set.has(n.id));
    const nextEdges = edgesRef.current.filter((e) => !set.has(e.source) && !set.has(e.target));
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedIds([]);
    anchorRef.current = null;
    scheduleHistory(serializeNow());
    scheduleSave();
  }, [flushHistory, scheduleHistory, scheduleSave, serializeNow]);

  const setRelation = useCallback((edgeId: string, relation: string) => {
    setEdges((current) => {
      const next = current.map((e) => (e.id === edgeId ? { ...e, data: { relation } } : e));
      edgesRef.current = next;
      return next;
    });
    scheduleHistory(serializeNow());
    scheduleSave();
  }, [scheduleHistory, scheduleSave, serializeNow]);

  const replaceAll = useCallback((snapshot: DramaSnapshot, options?: { resetHistory?: boolean }) => {
    applySnapshot(snapshot);
    if (options?.resetHistory) {
      historyRef.current = [snapshot];
      indexRef.current = 0;
      setHistory([snapshot]);
      setHistoryIndex(0);
    } else {
      scheduleHistory(serializeNow());
    }
    scheduleSave();
  }, [applySnapshot, scheduleHistory, scheduleSave, serializeNow]);

  /** 把一批**新**节点/连线并进当前画布（展开分镜表用）。已存在的 id 不重复铺。 */
  const mergeNodes = useCallback((incomingNodes: DramaSnapshot["nodes"], incomingEdges: DramaSnapshot["edges"]) => {
    const have = new Set(nodesRef.current.map((n) => n.id));
    const fresh = incomingNodes.filter((n) => !have.has(n.id));
    if (fresh.length) {
      const merged = [...nodesRef.current, ...fresh.map((n) => ({
        id: n.id,
        type: "drama" as const,
        position: { x: n.position.x, y: n.position.y },
        data: { kind: n.kind, payload: { ...n.payload } },
        style: { width: n.size.width, height: n.size.height },
      }))];
      nodesRef.current = merged;
      setNodes(merged);
    }
    const freshEdges = rfEdgesFrom({ version: DRAMA_SNAPSHOT_VERSION, nodes: [], edges: incomingEdges, updatedAt: 0 })
      .filter((e) => !edgesRef.current.some((x) => x.source === e.source && x.target === e.target));
    if (freshEdges.length) {
      const mergedEdges = [...edgesRef.current, ...freshEdges];
      edgesRef.current = mergedEdges;
      setEdges(mergedEdges);
    }
    flushHistory();
    scheduleHistory(serializeNow());
    scheduleSave();
    return fresh.length;
  }, [flushHistory, scheduleHistory, scheduleSave, serializeNow]);

  const autoLayout = useCallback(() => {
    const positions = dramaAutoLayout(
      nodesRef.current.map((n) => ({
        id: n.id,
        kind: String(n.data?.kind || "note"),
        payload: {},
        position: n.position,
        size: {
          width: Number((n.style as { width?: number } | undefined)?.width) || dramaNodeDef(n.data?.kind).width,
          height: Number((n.style as { height?: number } | undefined)?.height) || dramaNodeDef(n.data?.kind).height,
        },
      })),
      edgesRef.current.map((e) => ({ source: { id: e.source }, target: { id: e.target } })),
    );
    if (!positions.size) return;
    // 排版在原点上算，直接落地会出现负坐标（画布左上角是原点，负坐标得往回拖才看得见）⇒ 整体平移进正区间
    const xs = [...positions.values()].map((p) => p.x);
    const ys = [...positions.values()].map((p) => p.y);
    const shiftX = 160 - Math.min(...xs), shiftY = 120 - Math.min(...ys);
    muteHistory.current = true;
    setNodes((current) => {
      const next = current.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, position: { x: p.x + shiftX, y: p.y + shiftY } } : n;
      });
      nodesRef.current = next;
      return next;
    });
    muteHistory.current = false;
    flushHistory();
    scheduleSave();
  }, [flushHistory, scheduleSave]);

  const clearBoard = useCallback(() => {
    flushHistory();
    nodesRef.current = [];
    edgesRef.current = [];
    setNodes([]);
    setEdges([]);
    setSelectedIds([]);
    scheduleHistory({ version: DRAMA_SNAPSHOT_VERSION, nodes: [], edges: [], updatedAt: Date.now() });
    scheduleSave();
  }, [flushHistory, scheduleHistory, scheduleSave]);

  /* ----------------------------------------------------------- 多画布 */

  const createBoard = useCallback((title: string) => {
    const raw = String(title || "").trim() || `画布${store.listBoards().length + 1}`;
    const name = raw.replace(/[\\/:*?"<>|]/g, "_");
    saveNow();
    store.writeBoard(name, { version: DRAMA_SNAPSHOT_VERSION, nodes: [], edges: [], updatedAt: Date.now() });
    setBoards(store.upsertBoard({ name, title: raw, nodes: 0, updatedAt: Date.now() }));
    setBoard(name);
    return name;
  }, [saveNow]);

  const switchBoard = useCallback((name: string) => {
    if (!name || name === board) return;
    saveNow();
    setBoard(name);
  }, [board, saveNow]);

  /** 改项目显示标题（09-28 项目管理）：name（文件名/标识）不动，只改 meta.title。
   *  改的是当前板时本地 meta 立即同步（顶栏下拉即时显示新标题）。 */
  const renameBoard = useCallback((name: string, title: string) => {
    const clean = String(title || "").trim();
    if (!clean) return;
    const meta = store.listBoards().find((b) => b.name === name);
    if (!meta) return;
    setBoards(store.upsertBoard({ ...meta, title: clean }));
  }, []);

  const deleteBoard = useCallback(() => {
    const removed = board;
    setBoards(store.removeBoard(removed));
    const rest = store.listBoards();
    const next = rest[0]?.name || "main";
    setBoard(next);
    if (next === removed) load(next);
  }, [board, load]);

  /** 按名删除项目（09-28 项目管理）：非当前板直接删（索引+快照）；当前板走 deleteBoard 的切换逻辑。 */
  const deleteBoardByName = useCallback((name: string) => {
    if (name === board) { deleteBoard(); return; }
    setBoards(store.removeBoard(name));
  }, [board, deleteBoard]);

  const nextShotId = useCallback((sceneId?: string) => {
    const shots = nodesRef.current.filter((n) => n.data?.kind === "shot").map((n) => n.data.payload);
    return dramaNextShotId(shots, sceneId);
  }, []);

  /* 卸载前把欠的写出去（防抖里那笔不能丢） */
  useEffect(() => () => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (historyTimer.current) { window.clearTimeout(historyTimer.current); historyTimer.current = null; }
    const name = loadedBoard.current || "main";
    const snapshot = dramaSerialize(nodesRef.current, edgesRef.current);
    store.writeBoard(name, snapshot);
    store.upsertBoard({ name, title: name, nodes: snapshot.nodes.length, updatedAt: snapshot.updatedAt });
  }, []);

  return useMemo<DramaBoardApi>(() => ({
    board,
    boards,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectedIds,
    anchor: anchorRef.current,
    select,
    addNode,
    updatePayload,
    updateManyPayloads,
    removeNodes,
    setRelation,
    replaceAll,
    mergeNodes,
    undo,
    redo,
    canUndo: historyIndex > 0,
    canRedo: historyIndex >= 0 && historyIndex < history.length - 1,
    autoLayout,
    clearBoard,
    switchBoard,
    createBoard,
    deleteBoard,
    renameBoard,
    deleteBoardByName,
    saveNow,
    savedAt,
    nextShotId,
  }), [board, boards, nodes, edges, onNodesChange, onEdgesChange, onConnect, selectedIds, select, addNode, updatePayload, updateManyPayloads, removeNodes, setRelation, replaceAll, mergeNodes, undo, redo, historyIndex, history, autoLayout, clearBoard, switchBoard, createBoard, deleteBoard, saveNow, savedAt, nextShotId]);
}
