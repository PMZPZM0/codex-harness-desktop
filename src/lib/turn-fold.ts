// ═══ WorkBuddy assistant-fold 消息状态机（1:1 复刻 conversation-render）═══
// 本模块是纯函数层：不依赖 React / Electron / DOM，输入 ThreadItem 输出分段与摘要。
// 从 App.tsx 抽离的可测试单元——改分段/摘要逻辑前，先跑 scripts/verify-turn-fold.mjs。

import { commandIntentOf, commandTarget } from "./command-display.mjs";
import { diffStats } from "./diff-stats";
import { argSummary, skillOfItem, skillTargetLabel } from "./tool-display.mjs";

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
// - plan / **生成的**图片 → keepVisible（常驻外露，永不折叠）
// ⛔ `imageView`（agent **查看**图片）09-18 从 keepVisible 改为 foldable：
//   用户原话「消息汇总下面的那个图片和文件展示…只要在那个目录的图片，下面都展示」——
//   agent 逐张查看目录里的图片时，一张一个常驻大图预览，把消息区铺满（真机记录：单回合 3 张、
//   单会话 12 张）。查看是**过程**，应当随过程折叠；生成才是**产出**，继续常驻。
export type FoldKind = "foldable" | "body" | "keepVisible" | "thinking";
export type FoldUnit = { item: ThreadItem; kind: FoldKind };
export type FoldSegment = { kind: "foldable"; units: FoldUnit[]; shouldFold: boolean } | { kind: "normal"; units: FoldUnit[] };
export type OrderedToolRun =
  | { kind: "unit"; key: string; units: [FoldUnit] }
  | { kind: "toolRun"; key: string; toolKey: string; label: string; units: FoldUnit[] };

export function classifyUnit(item: ThreadItem): FoldKind {
  if (item.type === "reasoning") return "thinking";
  if (item.type === "agentMessage") return "body";
  // imageView 走 foldable（见上方注释）；plan 与生成图仍常驻外露
  if (item.type === "plan" || item.type === "imageGeneration") return "keepVisible";
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
    case "imageView": return { key: "image-view", label: "查看图片" };
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

/** 完成态折叠计划见 ./turn-fold-plan.mjs（纯逻辑放 .mjs，预检可直接 import 跑断言）。 */


export function buildSegments(units: FoldUnit[], turnFinished: boolean): FoldSegment[] {
  const segments: FoldSegment[] = [];
  let buffer: FoldUnit[] = [];
  const flush = () => {
    // ⛔ **单条过程也要收**（09-23 用户追报「运行过程折叠没了」）：旧版 length === 1 时直接内联
    //   （normal 段），正文锚点化（见 turn-fold-plan.mjs）之后过程段普遍只剩一两条，
    //   单条不折 ⇒ 大量孤零零的命令卡散在正文之间，看上去就像"过程折叠没有了"。
    //   用户 09-23 的口径是「**无论**中间执行了多少工具和命令，最终都归并为一个可折叠区块」
    //   —— 1 条也是"多少"之内。
    if (buffer.length) segments.push({ kind: "foldable", units: buffer, shouldFold: false });
    buffer = [];
  };
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    // ⛔ 「直播思考」判定必须带**事件顺序**兜底（09-23 用户：「运行状态下，下一个正文输出的时候，
    //   深度思考板块没有被收纳到正文工具折叠里面去」）：上游经常不给 reasoning item 回传
    //   completed/status（isLiveThinking 恒真）⇒ 思考卡永远留在正文外面。但事件是**有序**的 ——
    //   后面已经出现工具或正文时，前面那块思考必然已经结束。与 SessionQueue 的 reasoningActive
    //   同一条规则（两边必须一致，守卫【127】钉着）；只有「末尾连续的思考」才是真直播。
    const laterWork = units.slice(index + 1).some((next) => next.item.type !== "reasoning");
    const thinkingLive = unit.kind === "thinking"
      && (isLiveThinking(unit.item) || (!unit.item.status && !unit.item.durationMs))
      && !laterWork
      && !turnFinished;   // ⛔ 回合已结束 ⇒ 不存在还在直播的思考（settle 会补记时长）
    if (unit.kind === "foldable" || (unit.kind === "thinking" && !thinkingLive)) {
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

export type FoldAtom = { group: string; object?: string; status: FoldStatus; stats?: { add: number; del: number } };

/** 工具原子（对齐 extract atom）：group + 展示对象 */
export function foldAtomOf(item: ThreadItem, waitingForApproval?: boolean): FoldAtom {
  const status = foldItemStatus(item, waitingForApproval);
  // ★ 技能优先（09-24 用户：「使用了技能类似没看见」）：`desktop_*` / `browser_*` / markitdown
  //   这类调用落在 mcpToolCall / dynamicToolCall / commandExecution 里，命中技能就按技能归类
  //   ⇒ 折叠芯片显示「使用技能 桌面自动化」，而不是「调用 nuphus/desktop_screenshot」。
  const skill = skillOfItem(item);
  if (skill) {
    // 「怎么用的」：命令走 commandTarget（文件），工具调用走入参摘要；都取不到就只显示技能名。
    const how = skillTargetLabel(item.type === "commandExecution"
      ? commandTarget(String(item.command ?? ""))
      : argSummary(item.arguments));
    return { group: "skill", object: how ? truncText(`${skill.label} · ${how}`, 40) : skill.label, status };
  }
  switch (item.type) {
    // ⛔ 命令的展示对象**不能是原始命令行**（09-23 用户实测「图一看着很变扭」）：引擎给的
    //   `item.command` 是宿主包过一层 shell 启动器的形态，真机原样是
    //     "D:\…\resources\tools\pwsh\pwsh.exe" -Command "Get-Content -Lit…"
    //   ——拿它当摘要 topic，每条都从同一段 ~90 字符绝对路径开头，标题又长又乱。
    //   改成取命令里的**文件目标**（剥壳 + 路径归一 + 保尾截断，见 command-display.mjs）；
    //   取不到（如 `Write-Output "…"`）就留空 ⇒ 摘要退回无目标文案（对齐 WorkBuddy 原样）。
    // ⛔ 分组**不能一律 command**（09-23 用户：「正文中间怎么全是运行命令，编辑文件、读取、
    //   检索没有嘛」）：引擎里读/搜/改文件大多也走 shell 命令 ⇒ 用命令的二级意图
    //   （commandIntentOf，词法判定）拆成 modify/search/read/command 四档，
    //   摘要才出得了「修改…」「查看…」「定位…相关代码」。认不出 ⇒ 照旧 "command"。
    case "commandExecution": {
      const raw = item.command ? String(item.command) : "";
      return { group: commandIntentOf(raw), object: raw ? commandTarget(raw) || undefined : undefined, status };
    }
    case "fileChange": {
      // ★ 真实状态映射（09-23 用户附 WorkBuddy 截图：「这种效果我也要」——「编辑 xxx.mjs +40 -0」）：
      //   渲染层归一后的 changes 是数组、每项带 `diff`（unified diff 文本，见 ItemView 的同款消费），
      //   复用 lib/diff-stats.ts 数 +/- 行，多文件聚合求和 —— 与明细卡同一真相源，别再解析 rollout 原始对象。
      const changes = item.changes ?? [];
      let add = 0, del = 0;
      for (const change of changes) {
        const next = diffStats(String(change?.diff ?? ""));
        add += next.added;
        del += next.deleted;
      }
      const names = changes.map((change: any) => basename(change.path ?? change.filePath ?? "")).filter(Boolean);
      const stats = changes.length ? { add, del } : undefined;
      return { group: "modify", object: names.length ? truncText(names.slice(0, 2).join("、"), 28) : undefined, status, stats };
    }
    case "webSearch":
      return { group: "research", object: item.query ? truncText(item.query) : undefined, status };
    // imageView 归到 read 组（词表：topic「查看 {t}」/ verb「查看文件」）——
    // 否则会落进 other（摘要变成「处理多个步骤」，看不出它在看图）。
    case "imageView":
      return { group: "read", object: item.path ? truncText(basename(String(item.path))) : undefined, status };
    // ★ 来源分档（09-24 用户：「技能，插件，mcp 都要展示出来怎么用了」）：
    //   mcpToolCall = MCP 服务器，dynamicToolCall = 插件注册的动态工具；两者各归一组，
    //   不再混进含糊的「调用服务」。名字后面带上**入参摘要**（这次到底对谁/对什么做的）。
    case "mcpToolCall": {
      const name = item.tool ? `${item.server ?? "mcp"}/${item.tool}` : String(item.server ?? "mcp");
      const how = argSummary(item.arguments);
      // ⛔ 目标上限 56（与摘要 topic 同口径）：40 会把路径截成 `…/imag…`，比不显示更糟。
      return { group: "mcp", object: truncText(how ? `${name} · ${how}` : name, 56), status };
    }
    case "dynamicToolCall": {
      const name = item.tool ? String(item.tool) : "";
      const how = argSummary(item.arguments);
      return { group: "plugin", object: name ? truncText(how ? `${name} · ${how}` : name, 56) : undefined, status };
    }
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
  modify: { topic: "编辑 {t}", noTopic: "编辑文件", verb: "编辑文件" },
  command: { topic: "运行 {t}", noTopic: "运行命令", verb: "运行命令" },
  external: { topic: "获取 {t}", noTopic: "调用外部服务", verb: "调用服务" },
  // MCP 服务器 / 插件动态工具（09-24：与「技能」分开，各自可见）
  mcp: { topic: "调用 MCP {t}", noTopic: "调用 MCP", verb: "调用 MCP" },
  plugin: { topic: "用插件 {t}", noTopic: "使用插件", verb: "使用插件" },
  // 技能调用（09-24 用户：「使用了技能类似没看见」）—— 桌面自动化/浏览器自动化/文档转换…
  skill: { topic: "使用技能 {t}", noTopic: "使用技能", verb: "使用技能" },
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
  // ★ 真实状态映射尾巴（09-23 用户附截图：「编辑 xxx.mjs +40 -0」）：段里只要有文件编辑，
  //   摘要末尾就带聚合行数 —— 数字来自 fileChange 的 diff（与明细卡同一 diffStats 真相源）。
  let editAdd = 0, editDel = 0, hasEdit = false;
  for (const atom of atoms) {
    if (atom.stats) { editAdd += atom.stats.add; editDel += atom.stats.del; hasEdit = true; }
  }
  const statsTail = hasEdit ? ` +${editAdd} -${editDel}` : "";
  if (atoms.length === 0) return "深度思考";
  const status: "waiting" | "running" | "done" = atoms.some((a) => a.status === "waiting") ? "waiting" : isRunning && atoms.some((a) => a.status === "running") ? "running" : "done";
  const decorate = (text: string) => (status === "running" ? `正在${text}` : status === "waiting" ? `等待确认：${text}` : text) + statsTail;
  const useful = atoms.filter((a) => a.group !== "other" || a.object);
  if (useful.length === 0) return (status === "running" ? "正在处理任务过程" : "处理任务过程") + statsTail;
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
  // 目标文案上限 56 字（09-23 改：原来 28 字会把一个文件路径从中间切断 ——
  // 摘要里的目标现在常是路径，如 `…/features/app-state/parts/part09/01-seg.tsx`，必须留得下）。
  // ⛔ 两个目标拼起来超上限时**只留第一个**，不再截断第二个
  //   （实测：拼出来是 `…/imagegen/SKILL.md、…/skills/.syst…`，尾巴被切成半截，比不展示更糟）。
  const joined = objects.slice(0, 2).join("、");
  const topic = objects.length ? (joined.length > 56 ? String(objects[0]) : joined) : undefined;
  if (order.length === 1) {
    return topic && useful.length > 1 ? decorate(TEXT[order[0]].topic.replace("{t}", topic)) : decorate(TEXT[order[0]].noTopic);
  }
  if (topic && order.length === 2) return decorate(`${TEXT[sorted[0]].verb}、${TEXT[sorted[1]].verb}：${topic}`);
  if (topic) return decorate(`${TEXT[sorted[0]].verb}：${topic}`);
  if (order.length > 3) return `${order.length} 类操作${statsTail}`;
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
  // ⛔ 引擎的 `thread.status` 是对象（`{type:"active",activeFlags}`），不是字符串 —— 早期按
  // `status === "inProgress"` 比较是**恒假**的，于是"引擎明确仍在跑就保持原样"这个逃逸口
  // 是死代码：真正在跑的回合会被归一化成 completed（切回来停止键消失、消息绕过排队）。
  const statusType = (input.status as any)?.type ?? input.status;
  if (statusType === "active" || statusType === "inProgress" || statusType === "running") return input;
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
