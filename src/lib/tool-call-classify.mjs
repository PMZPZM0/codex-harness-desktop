// src/lib/tool-call-classify.mjs
//
// 折叠块的**概要统计**：按工具调用的**实际内容**归类，而不是按工具名计数。
//
// ⛔ 为什么不能只按工具名计数（这条是需求的核心，别退回按名计数）：
//   引擎把绝大多数动作都报成同一个 item 类型 `commandExecution`——实测某回合 37 次调用全是它。
//   按"工具名"数只会得到「运行 37 条命令」，而拆开看：24 次是 `Get-ChildItem` / `Get-Content`
//   / `git status` 这类**查看**、9 次是 `Select-String` 这类**搜索**、只有 3 次是真的跑构建。
//   用户要的是「运行 12 条命令、查看 8 次」这种**能看出干了什么**的统计，所以判定必须落到
//   调用内容（命令字符串 / 工具名+参数 / 改动文件路径）上。
//
// 单元约定（⛔ 别把两种单位混进一个数字，否则「编辑 3 个文件」可能其实是 3 条命令）：
//   · edit（编辑 N 个文件）—— 单位是**文件数**：只来自 `fileChange` 的 `changes[].path` 去重；
//     命令里直接写文件是另一回事（一个命令可能写好几个文件，数不清），单独进 write（次数）。
//   · 其余桶 —— 单位是**调用次数**（文案里都带「次 / 段 / 步」）。
//
// 纯函数（不依赖 React / DOM / Electron）⇒ 预检守卫可以直接 import 真实现跑断言。

/** 摘要里最多展示几段（多的收成「等 N 类」）；按数量降序取前几段 */
export const STATS_MAX_PARTS = 3;

/** 桶的规范顺序：既用于「数量相同时」的稳定排序，也是守卫核对词表的依据。 */
export const TOOL_CALL_BUCKET_ORDER = [
  "command", "edit", "write", "read", "search", "research", "external", "collab", "thinking", "other",
];

/** 桶的中文文案。单位必须与文件头「单元约定」一致。 */
const BUCKET_TEXT = {
  command: (n) => `运行 ${n} 条命令`,
  edit: (n) => `编辑 ${n} 个文件`,
  write: (n) => `写入文件 ${n} 次`,
  read: (n) => `查看 ${n} 次`,
  search: (n) => `搜索 ${n} 次`,
  research: (n) => `联网检索 ${n} 次`,
  external: (n) => `调用服务 ${n} 次`,
  collab: (n) => `协作分派 ${n} 次`,
  thinking: (n) => `深度思考 ${n} 段`,
  other: (n) => `其它步骤 ${n} 步`,
};

/* ── 命令字符串的意图识别 ─────────────────────────────────────────────────────
 * 优先级：search → write → mutate → read → command（先"更具体的动作"，最后才是泛化的"运行命令"）。
 * 只认**确凿的动词**：漏判只是统计得粗一点（算进「运行 N 条命令」），误判才会给出错误信息。
 *
 * 两条实测踩过的坑（都在守卫里钉住，别改回去）：
 *  ① **管道格式化段会污染判定**：真机上 `npm run build:electron 2>&1 | Select-Object -Last 15`
 *     尾巴上的 `Select-Object` 只是限行输出，若一起参与判定就会被算成「查看」。
 *     ⇒ 先剥掉**非首位**的纯展示型管道段（见 stripFormatterSegments）。
 *  ② **`=>` 会被重定向正则误吃**：`l => !re.test(l)` 里 `>` 后跟 `.test` 形状上像 `> x.ext`，
 *     实测把一堆 JS 单行脚本误判成"写文件"。⇒ 重定向的 `>` 必须**前面是空白/分隔符**
 *     （`2>&1` 与 `=>` 因此都不命中）。
 */
const COMMAND_SEARCH_RE = /\b(?:select-string|findstr|grep|rg|ack|git\s+grep)\b|--pattern\b|-Pattern\b/i;
/** 写文件（真的落了盘）：PowerShell 写 cmdlet / 重定向 / node 的 fs 写调用 / sed -i */
const COMMAND_WRITE_RE = /\b(?:set-content|add-content|out-file|tee-object|new-item|copy-item|move-item|rename-item|remove-item|mkdir)\b|\b(?:writefilesync|appendfilesync|writefile|appendfile|fs\.write)\b|\bsed\s+-i\b|(?:^|[\s;&|])>{1,2}\s*[^\s|&;]+\.[a-z0-9]{1,6}\b/i;
/** 改状态（有后果的动作）：提交/推送/删除/回滚/安装 —— 不能被同一条复合命令里的 `git log` 冲淡成"查看" */
const COMMAND_MUTATE_RE = /\bgit\s+(?:add|commit|push|rm|mv|restore|checkout|reset|clean|stash|merge|rebase|tag|switch)\b|\b(?:stop-process|start-process|set-itemproperty|set-executionpolicy)\b|\b(?:npm|pnpm|yarn)\s+(?:i|install|add|remove|uninstall)\b|\bpip\s+install\b|(?:^|[\s;&|])(?:rm|del|mv|cp|chmod|chown|kill)\s/i;
/** 查看（只读探查）：PowerShell 读 cmdlet / 常见 read 命令 / git 的只读子命令 */
const COMMAND_READ_RE = /\b(?:get-content|get-childitem|get-item|test-path|get-process|get-ciminstance|get-command|get-location|get-date|get-filehash|get-member|select-object|where-object|sort-object|measure-object|resolve-path|split-path|join-path|compare-object|group-object)\b|\b(?:cat|type|ls|dir|head|tail|wc|stat|tree|du|pwd|which|where)\b|\bgit\s+(?:diff|log|status|show|branch|remote|blame)\b/i;

/** 纯展示型管道段（在管道**非首位**时剥掉）：它们不表达"干了什么"，只决定"怎么显示"。 */
const PIPE_FORMATTER_RE = /^\s*(?:select-object|sort-object|where-object|measure-object|group-object|format-table|format-list|format-wide|out-string|out-host|out-null|head|tail|sort|uniq|cut|column)\b/i;

/**
 * 剥掉"纯展示型"管道段（只剥**非首位**段：命令首位的 `head` / `Select-Object` 是真实动作）。
 * ⚠️ 会写文件的段（`Out-File` / `Set-Content` / `Tee-Object`）一律保留 —— 它们是写文件信号。
 */
function stripFormatterSegments(command) {
  const segments = String(command ?? "").split(/\||;/);
  return segments
    .filter((segment, index) => index === 0 || !PIPE_FORMATTER_RE.test(segment))
    .join(" | ");
}

/** 命令字符串 → 桶。只对 commandExecution 有意义。 */
function bucketOfCommand(command) {
  const text = stripFormatterSegments(command);
  if (!text.trim()) return "command";
  if (COMMAND_SEARCH_RE.test(text)) return "search";
  if (COMMAND_WRITE_RE.test(text)) return "write";
  if (COMMAND_MUTATE_RE.test(text)) return "command";
  if (COMMAND_READ_RE.test(text)) return "read";
  return "command";
}

/** 单条 item → 桶。不参与统计的类型（正文/计划/生成图）返回 null。 */
export function toolCallBucket(item) {
  switch (item?.type) {
    case "commandExecution": return bucketOfCommand(item.command);
    case "fileChange": return "edit";
    case "webSearch": return "research";
    case "imageView": return "read";
    case "mcpToolCall":
    case "dynamicToolCall": return "external";
    case "collabAgentToolCall":
    case "subAgentActivity": return "collab";
    case "reasoning": return "thinking";
    // 正文/用户消息/计划/生成图是"产出"或锚点，不是过程步骤，不进统计
    case "agentMessage":
    case "userMessage":
    case "plan":
    case "imageGeneration": return null;
    default: return "other";
  }
}

/** fileChange 改动的文件路径。字段名有两种形态，都兜住。 */
function changedFilesOf(item) {
  return (item?.changes ?? [])
    .map((change) => String(change?.path ?? change?.filePath ?? ""))
    .filter(Boolean);
}

/**
 * 概要统计。
 * @param {(object)[]} units FoldUnit[]（`{item}`）或 ThreadItem[]（两者都收）
 * @returns {{ text: string, calls: number, files: number, buckets: { bucket: string, count: number }[] }}
 *   text —— 给折叠头用的单行文案（没有任何步骤时为空串，调用方据此回退到原有摘要）
 */
export function summarizeToolCalls(units) {
  const list = Array.isArray(units) ? units : [];
  const counts = new Map();
  const bump = (bucket, by = 1) => counts.set(bucket, (counts.get(bucket) ?? 0) + by);
  const editedFiles = new Set();
  let calls = 0;

  for (const entry of list) {
    const item = entry && entry.item ? entry.item : entry;
    if (!item || typeof item !== "object") continue;
    const bucket = toolCallBucket(item);
    if (!bucket) continue;
    if (bucket === "thinking") { bump("thinking"); continue; }
    calls += 1;
    if (bucket === "edit") {
      // 单位是**文件数**（见文件头「单元约定」）：去重后计入
      for (const file of changedFilesOf(item)) editedFiles.add(file);
      continue;
    }
    bump(bucket);
  }
  if (editedFiles.size) bump("edit", editedFiles.size);

  const buckets = TOOL_CALL_BUCKET_ORDER
    .filter((bucket) => counts.get(bucket))
    .map((bucket) => ({ bucket, count: counts.get(bucket) }))
    // 数量降序；同数量按规范顺序（稳定，不随事件顺序抖动）
    .sort((a, b) => (b.count - a.count) || (TOOL_CALL_BUCKET_ORDER.indexOf(a.bucket) - TOOL_CALL_BUCKET_ORDER.indexOf(b.bucket)));

  // 展示优先级：**实际动作**（跑了什么/看了什么/改了什么）先上，「深度思考 / 其它」是背景信息，
  // 排到末位——用户要的是「运行了几条命令、编辑了几个文件」这种能看出干了什么的口径。
  const context = (entry) => entry.bucket === "thinking" || entry.bucket === "other";
  const ordered = [...buckets.filter((entry) => !context(entry)), ...buckets.filter(context)];

  const shown = ordered.slice(0, STATS_MAX_PARTS);
  const text = shown.map((entry) => BUCKET_TEXT[entry.bucket](entry.count)).join("、")
    + (buckets.length > shown.length ? ` 等 ${buckets.length} 类` : "");
  return { text: buckets.length ? text : "", calls, files: editedFiles.size, buckets };
}
