// ═══ WorkBuddy assistant-fold 消息状态机（1:1 复刻 conversation-render）═══
// 本模块是纯函数层：不依赖 React / Electron / DOM，输入 ThreadItem 输出分段与摘要。
// 从 App.tsx 抽离的可测试单元——改分段/摘要逻辑前，先跑 scripts/verify-turn-fold.mjs。

// ── 线程基础类型（与引擎 thread/list、thread/resume 返回结构对齐） ──
export type ThreadItem = { id: string; type: string; [key: string]: any };
export type Turn = {
  id: string;
  status: string;
  items: ThreadItem[];
  error?: { message?: string } | null;
  durationMs?: number | null;
  startedAt?: number | null;
  completedAt?: number | null;
  usage?: any;
};
export type Thread = { id: string; preview: string; name?: string | null; cwd: string; updatedAt: number; status: any; turns: Turn[] };

// 单元分类（对齐 classifyPart）：
// - reasoning → thinking（深度思考卡自成一块常驻可折叠卡，永不进过程折叠组——
//   否则回合结束被吸进「已完成」组时组件卸载重挂，自动收起动画没机会播＝「闪一下就没了」）
// - 工具·命令·编辑等 → foldable（可折叠进过程组）
// - 有正文的 agentMessage → body（正文锚点，不可折叠；解说与结论一视同仁）
// - plan / 图片类 → keepVisible（常驻外露，永不折叠）
export type FoldKind = "foldable" | "body" | "keepVisible" | "thinking";
export type FoldUnit = { item: ThreadItem; kind: FoldKind };
export type FoldSegment = { kind: "foldable"; units: FoldUnit[]; shouldFold: boolean } | { kind: "normal"; units: FoldUnit[] };
export type OrderedToolRun =
  | { kind: "unit"; key: string; units: [FoldUnit] }
  | { kind: "toolRun"; key: string; toolKey: string; label: string; units: FoldUnit[] };

export function classifyUnit(item: ThreadItem): FoldKind {
  if (item.type === "reasoning") return "thinking";
  if (item.type === "agentMessage") return "body";
  if (item.type === "plan" || item.type === "imageView" || item.type === "imageGeneration") return "keepVisible";
  if (item.type === "userMessage") return "keepVisible"; // 用户消息不可折叠
  return "foldable";
}

/** 同类工具的稳定分组键。只合并相邻项；正文/思考天然打断分组，保证事件原位不变。 */
export function toolRunMeta(item: ThreadItem): { key: string; label: string } {
  switch (item.type) {
    case "commandExecution": return { key: "command", label: "命令" };
    case "fileChange": return { key: "file-change", label: "文件编辑" };
    case "webSearch": return { key: "web-search", label: "网页搜索" };
    case "mcpToolCall": {
      const name = String(item.tool ?? "MCP 工具");
      return { key: `mcp:${item.server ?? "mcp"}:${name}`, label: name };
    }
    case "dynamicToolCall": {
      const name = String(item.tool ?? "工具调用");
      return { key: `dynamic:${name}`, label: name };
    }
    case "collabAgentToolCall": return { key: `collab:${item.tool ?? "agent"}`, label: "协作工具" };
    case "subAgentActivity": return { key: `subagent:${item.kind ?? "activity"}`, label: "子智能体" };
    default: return { key: `tool:${item.type}`, label: "工具" };
  }
}

/** 按原始事件顺序构建相邻工具组。非工具单元始终独立，不能被移动或吞并。 */
export function buildOrderedToolRuns(units: FoldUnit[]): OrderedToolRun[] {
  const runs: OrderedToolRun[] = [];
  for (const unit of units) {
    if (unit.kind !== "foldable") {
      runs.push({ kind: "unit", key: `unit:${unit.item.id}`, units: [unit] });
      continue;
    }
    const meta = toolRunMeta(unit.item);
    const previous = runs[runs.length - 1];
    if (previous?.kind === "toolRun" && previous.toolKey === meta.key) {
      previous.units.push(unit);
    } else {
      runs.push({ kind: "toolRun", key: `tools:${meta.key}:${unit.item.id}`, toolKey: meta.key, label: meta.label, units: [unit] });
    }
  }
  return runs;
}

/** 深度思考是否正在直播（流式输出思考文本、还没落用时）：直播中的思考必须内联常驻
 * （保持同一 DOM 节点，live→done 自动收起动画才播得出来）；已结束的思考可以被吸进
 * 工具折叠段（对齐 WorkBuddy：收起态不单独占一行，展开组内可见），否则
 * [命令,思考,命令,思考…] 会被思考卡切成一条条 normal 段，永远合并不成组 → 集体刷屏 */
export function isLiveThinking(item: ThreadItem) {
  return !item.durationMs && (item.status === "inProgress" || item.status === "running");
}

export function bodyTextOf(item: ThreadItem) {
  return item.type === "agentMessage" ? String(item.text ?? "").trim() : "";
}

/** 分段（对齐 buildSegments）：连续 ≥2 个可折叠单元 → 折叠段；单个自成普通段；正文并入普通段 */
export function buildSegments(units: FoldUnit[], turnFinished: boolean): FoldSegment[] {
  const segments: FoldSegment[] = [];
  let buffer: FoldUnit[] = [];
  const flush = () => {
    if (buffer.length >= 2) segments.push({ kind: "foldable", units: buffer, shouldFold: false });
    else if (buffer.length === 1) segments.push({ kind: "normal", units: buffer });
    buffer = [];
  };
  for (const unit of units) {
    if (unit.kind === "foldable" || (unit.kind === "thinking" && !isLiveThinking(unit.item))) {
      // 工具与已结束的思考合并成段（对齐 WorkBuddy：一段过程一个摘要组，思考在组内）；
      // 直播中的思考打断分段、内联常驻
      buffer.push(unit);
    } else {
      flush();
      const last = segments[segments.length - 1];
      if (last && last.kind === "normal") last.units.push(unit);
      else segments.push({ kind: "normal", units: [unit] });
    }
  }
  flush();
  // shouldFold：其后出现正文（流式）或整轮已结束（完成态）
  let bodyTextAfter = false;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.kind === "foldable") seg.shouldFold = bodyTextAfter || turnFinished;
    else if (seg.units.some((u) => bodyTextOf(u.item))) bodyTextAfter = true;
  }
  return segments;
}

export type FoldStatus = "running" | "waiting" | "done" | "failed";

export function foldItemStatus(item: ThreadItem, waitingForApproval?: boolean): FoldStatus {
  const s = item.status;
  if (s === "inProgress" || s === "running") {
    if (waitingForApproval && item.type === "commandExecution") return "waiting";
    return "running";
  }
  if (s === "failed" || s === "error") return "failed";
  return "done";
}

export function truncText(value: string, max = 36) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function basename(value: string) {
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
}

export type FoldAtom = { group: string; object?: string; status: FoldStatus };

/** 工具原子（对齐 extract atom）：group + 展示对象 */
export function foldAtomOf(item: ThreadItem, waitingForApproval?: boolean): FoldAtom {
  const status = foldItemStatus(item, waitingForApproval);
  switch (item.type) {
    case "commandExecution":
      return { group: "command", object: item.command ? truncText(item.command) : undefined, status };
    case "fileChange": {
      const names = (item.changes ?? []).map((change: any) => basename(change.path ?? change.filePath ?? "")).filter(Boolean);
      return { group: "modify", object: names.length ? truncText(names.slice(0, 2).join("、"), 28) : undefined, status };
    }
    case "webSearch":
      return { group: "research", object: item.query ? truncText(item.query) : undefined, status };
    case "mcpToolCall":
      return { group: "external", object: item.tool ? truncText(`${item.server ?? "mcp"}/${item.tool}`) : undefined, status };
    case "dynamicToolCall":
      return { group: "external", object: item.tool ? truncText(item.tool) : undefined, status };
    case "collabAgentToolCall":
    case "subAgentActivity":
      return { group: "collab", object: item.tool ?? item.kind ? truncText(String(item.tool ?? item.kind)) : undefined, status };
    default:
      return { group: "other", status };
  }
}

/** 意图摘要词表（可扩展：新增工具类型时向 DEFAULT_GROUP_TEXT 补一组文案即可，
 *  或在调用 computeFoldSummary 时传 customText 覆盖） */
export type GroupTextMap = Record<string, { topic: string; noTopic: string; verb: string }>;

export const DEFAULT_GROUP_TEXT: GroupTextMap = {
  read: { topic: "查看 {t}", noTopic: "查看相关文件", verb: "查看文件" },
  search: { topic: "定位{t}相关代码", noTopic: "搜索相关代码", verb: "定位代码" },
  research: { topic: "收集{t}资料", noTopic: "收集资料", verb: "收集资料" },
  modify: { topic: "修改{t}", noTopic: "修改文件", verb: "修改文件" },
  command: { topic: "运行 {t}", noTopic: "运行命令", verb: "运行命令" },
  external: { topic: "获取 {t}", noTopic: "调用外部服务", verb: "调用服务" },
  collab: { topic: "协作处理{t}", noTopic: "协作分派", verb: "协作分派" },
  other: { topic: "处理{t}", noTopic: "处理多个步骤", verb: "处理" },
};

/** 意图摘要文案（对齐 metaFold.summary 中文文案与 select 决策优先级） */
export function computeFoldSummary(
  units: FoldUnit[],
  isRunning: boolean,
  waitingForApproval?: boolean,
  customText?: Partial<GroupTextMap>,
): string {
  // Partial 展开后值类型带 | undefined，但 DEFAULT 全量兜底所有 key，运行时不会缺
  const TEXT: GroupTextMap = { ...DEFAULT_GROUP_TEXT, ...customText } as GroupTextMap;
  const atoms = units.filter((u) => u.item.type !== "reasoning").map((u) => foldAtomOf(u.item, waitingForApproval));
  if (atoms.length === 0) return "深度思考";
  const status: "waiting" | "running" | "done" = atoms.some((a) => a.status === "waiting") ? "waiting" : isRunning && atoms.some((a) => a.status === "running") ? "running" : "done";
  const decorate = (text: string) => (status === "running" ? `正在${text}` : status === "waiting" ? `等待确认：${text}` : text);
  const useful = atoms.filter((a) => a.group !== "other" || a.object);
  if (useful.length === 0) return status === "running" ? "正在处理任务过程" : "处理任务过程";
  if (useful.length === 1) {
    const atom = useful[0];
    return atom.object ? decorate(TEXT[atom.group].topic.replace("{t}", atom.object)) : decorate(TEXT[atom.group].noTopic);
  }
  const buckets = new Map<string, number>();
  const order: string[] = [];
  for (const atom of useful) {
    if (!buckets.has(atom.group)) { buckets.set(atom.group, 0); order.push(atom.group); }
    buckets.set(atom.group, (buckets.get(atom.group) ?? 0) + 1);
  }
  const sorted = [...order].sort((a, b) => (buckets.get(b) ?? 0) - (buckets.get(a) ?? 0));
  const objects = [...new Set(useful.map((a) => a.object).filter(Boolean))] as string[];
  const topic = objects.length ? truncText(objects.slice(0, 2).join("、"), 28) : undefined;
  if (order.length === 1) {
    return topic && useful.length > 1 ? decorate(TEXT[order[0]].topic.replace("{t}", topic)) : decorate(TEXT[order[0]].noTopic);
  }
  if (topic && order.length === 2) return decorate(`${TEXT[sorted[0]].verb}、${TEXT[sorted[1]].verb}：${topic}`);
  if (topic) return decorate(`${TEXT[sorted[0]].verb}：${topic}`);
  if (order.length > 3) return `${order.length} 类操作`;
  return decorate(TEXT[sorted[0]].noTopic);
}

/** 折叠头引导图标：段内调用最多的工具分组（对齐 computeTopToolName） */
export function topToolGroup(units: FoldUnit[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const unit of units) {
    if (unit.item.type === "reasoning") continue;
    const group = foldAtomOf(unit.item).group;
    const count = (counts.get(group) ?? 0) + 1;
    counts.set(group, count);
    if (count > bestCount) { bestCount = count; best = group; }
  }
  return best ?? (units.some((u) => u.item.type === "reasoning") ? "reasoning" : null);
}

export function isTurnRunning(turn: Turn) {
  return turn.status === "inProgress" || turn.status === "running";
}

// 历史会话加载归一化：运行中丢过 turn/completed 的回合，在 resume 数据里会残留
// inProgress 状态 → 重开时被误判为「还在运行」，永远走流式分支（转圈/不合并/旧展示）。
// 引擎级会话状态明确仍在运行（后台任务）时保持原样；否则把残留运行态一律落成完成态，
// 让旧消息与新消息一样走完成态合并折叠展示。
export function normalizeLoadedThread(input: Thread): Thread {
  if (input.status === "inProgress" || input.status === "running") return input;
  let changed = false;
  const turns = input.turns.map((turn) => {
    if (!isTurnRunning(turn)) return turn;
    changed = true;
    return {
      ...turn,
      status: "completed",
      items: turn.items.map((item) => item.status === "inProgress" || item.status === "running" ? { ...item, status: "completed" } : item),
    };
  });
  return changed ? { ...input, status: "completed", turns } : input;
}
