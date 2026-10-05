/**
 * 像素办公室 · 事件面（2026-10-05 晚新增）
 *
 * 一句话：**把「对话框里出现的所有事件」接进办公室的显示器**。
 *
 * ⛔⛔ 为什么必须新开这个面，而不是从 run 记录里推：
 *   `TeamMemberRunRecord` / `DelegateRecordEntry` 只有 `query + output + status` ——
 *   它们能回答"这人接了活没有、干完没有"，**回答不了"他此刻在干什么"**。
 *   而"他此刻在干什么"恰恰就是对话框逐条列出来的那些过程步骤：
 *   打开浏览器、写文件、搜文件、看文件、改文件、跑命令、调服务、深度思考……
 *   ⇒ 所以这一面直接吃**引擎的 item 事件**（`item/started` / `item/completed`），
 *     按**对话框同一套判据**分类（`commandIntentOf` / `toolCallBucket` 是对话框在用的
 *     那两个函数，⛔ 不另写一套词表 —— 两套必然漂，用户会看到"对话里说查文件、
 *     办公室里在敲命令"这种自相矛盾）。
 *
 * ⛔ 落点是"每会话最近一条真实事件"（`Map<threadId, Entry>`），模块级单例：
 *   · 画布每 250ms 自取（**不触发 React 重渲染**，与 OfficeSim 同一个理由）；
 *   · 只存**最新一条** —— 办公室要表现的是"此刻"，不是历史（历史在对话框里）。
 *
 * ⛔ 覆盖范围：**所有会话**都记账（含后台的团队成员 / 被调度子会话）。
 *   接线点在事件总路由里、`threadId !== 当前会话` 那条过滤**之前**（见 01-seg.tsx）——
 *   放过滤之后的话，办公室成员的会话全是后台会话，一条事件都收不到。
 */
import { commandIntentOf, commandPurpose, commandTarget, displayCommand } from "../../lib/command-display.mjs";
import { toolCallBucket } from "../../lib/tool-call-classify.mjs";

/** 办公室能演的"事件"种类 —— 每一种在显示器上都有**专属画面**（见 office-screen 的模式表）。 */
export type OfficeActivityKind =
  /** 打开浏览器 / 操作网页（命令里启动浏览器、或浏览器类 MCP 工具） */
  | "browser"
  /** 联网检索（`webSearch`） */
  | "websearch"
  /** **写入 / 新建**文件（fileChange 全是新增行） */
  | "file-write"
  /** **搜索**文件内容（grep / Select-String / rg…） */
  | "file-search"
  /** **查看**文件（读取命令 / 看图） */
  | "file-read"
  /** **修改**文件（fileChange 带删除行） */
  | "file-edit"
  /** 跑命令 / 构建 / 测试 */
  | "terminal"
  /** 调用 MCP / 动态工具（外部服务） */
  | "service"
  /** 协作分派（把活交给别的智能体） */
  | "collab"
  /** 深度思考（reasoning） */
  | "thinking";

/** 一条被记下来的事件。 */
export type OfficeActivityEntry = {
  kind: OfficeActivityKind;
  /** 真实细节（命令 / 文件名 / 查询词）—— 屏面底部那行滚动字幕就是它 */
  detail: string;
  /** 这条事件**开始**的时刻（屏面计时器用它） */
  at: number;
  /** 是否仍在进行（`item/completed` 未到） */
  running: boolean;
  /** 最后一次更新的时刻（用于"刚做完"的滞留判定） */
  updatedAt: number;
  /** 完成时记下耗时（running=false 后屏面显示它） */
  tookMs: number;
};

/** 模块级单例（刻意的：办公室是"整个应用的一份世界状态"，不属于某个组件）。 */
const STORE = new Map<string, OfficeActivityEntry>();

/** 浏览器类线索：启动浏览器的命令 或 浏览器自动化的 MCP 工具名。 */
const BROWSER_RE = /\b(?:chrome|msedge|firefox|chromium|brave|edge)\b|playwright|puppeteer|browsermcp|browser_|open\s+https?:\/\/|start\s+https?:\/\//i;

/** 路径 → 文件名。
 *  ⛔ 刻意**不 import `src/lib/basename`**：那是个无扩展名的 TS 相对导入，
 *   预检守卫要用 `node --experimental-strip-types` **真跑本模块**，而 node 的 ESM
 *    解析器要求显式扩展名 ⇒ 会 ERR_MODULE_NOT_FOUND（本模块的其它依赖都是 .mjs，没事）。
 *    三个字符的逻辑，不值得为它牺牲「守卫能真跑」这条判据强度。 */
function basename(value: string): string {
  const text = String(value ?? "");
  const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return cut >= 0 ? text.slice(cut + 1) : text;
}

/** 只在画布上显示、不需要保留的字符集（微字模只会画 A-Z0-9 与这几个符号）。 */
function tickerSafe(text: string): string {
  return String(text ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .,:/\\_+\-=[\]()#%]/g, " ")   // 中文/花引号等一律转空格
    .replace(/\s+/g, " ")
    .trim();
}

/** fileChange 里的改动是否含"删除行"（有 ⇒ 是修改，没有 ⇒ 是新建）。
 *  ⛔ 判据用 diff 文本而不是 `changes[].kind` —— 后者在引擎各版本里时有时无。 */
function changesHaveRemoval(changes: any[]): boolean {
  for (const change of changes) {
    const lines = String(change?.diff ?? "").split("\n");
    if (lines.some((line) => line.startsWith("-") && !line.startsWith("---"))) return true;
  }
  return false;
}

function fileNamesOf(changes: any[]): string {
  return changes
    .map((change) => basename(String(change?.path ?? change?.filePath ?? "")))
    .filter(Boolean)
    .join(" ");
}

/**
 * 单条 item ⇒ 办公室事件（纯函数，预检可直接跑）。
 * @returns null 表示这条 item **不该出现在显示器上**（正文/用户消息/计划/生图）。
 *
 * ⛔ 分类口径与对话框一致：先过 `toolCallBucket`（对话框折叠头统计用的就是它），
 *   为 null 的（agentMessage/userMessage/plan/imageGeneration）**一律不演** ——
 *   ⛔ 别在这里"顺手"给它们编一个画面：那会让显示器出现对话框里根本没有的步骤。
 */
export function classifyOfficeItem(item: any): { kind: OfficeActivityKind; detail: string } | null {
  if (!item || typeof item !== "object") return null;
  const bucket = toolCallBucket(item);
  if (!bucket) return null;
  const type = String(item.type ?? "");
  switch (type) {
    case "commandExecution": {
      const raw = String(item.command ?? "");
      if (!raw.trim()) return { kind: "terminal", detail: "" };
      /* 浏览器优先判：`start chrome https://…` 也会被 commandIntentOf 判成 read/command，
         那样显示器就会演成"查看文件"，而用户看到的是浏览器打开了。 */
      if (BROWSER_RE.test(raw)) {
        return { kind: "browser", detail: tickerSafe(commandTarget(raw) || displayCommand(raw, 80)) };
      }
      const detail = tickerSafe(commandTarget(raw) || commandPurpose(raw, 40) || displayCommand(raw, 80));
      switch (commandIntentOf(raw)) {
        case "search": return { kind: "file-search", detail };
        case "read": return { kind: "file-read", detail };
        case "modify": return { kind: "file-edit", detail };
        default: return { kind: "terminal", detail };
      }
    }
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return {
        kind: changesHaveRemoval(changes) ? "file-edit" : "file-write",
        detail: tickerSafe(fileNamesOf(changes)),
      };
    }
    case "webSearch":
      return { kind: "websearch", detail: tickerSafe(item.query ?? "") };
    case "mcpToolCall":
    case "dynamicToolCall": {
      const tool = [item.server, item.tool].filter(Boolean).join(" ");
      if (BROWSER_RE.test(tool)) return { kind: "browser", detail: tickerSafe(item.tool ?? "") };
      return { kind: "service", detail: tickerSafe(tool) };
    }
    case "collabAgentToolCall":
    case "subAgentActivity":
      return { kind: "collab", detail: tickerSafe(item.tool ?? item.name ?? "") };
    case "reasoning":
      return { kind: "thinking", detail: "" };
    /* ⛔ `agentMessage`（正文产出）**刻意没有事件种类** —— 它是"产出"不是"过程步骤"，
       上面那道 `toolCallBucket` 闸就会把它挡掉（返回 null）。正文态由**运行阶段**表达
       （writing → code 屏 / reporting → report 屏），⛔ 别在这里给它编一个画面上来
       （那会让显示器出现对话框里根本不存在的步骤，也是"死代码"的来源）。 */
    case "imageView":
      return { kind: "file-read", detail: "IMAGE" };
    default:
      return null;
  }
}

/**
 * 记账（事件总路由调用；⛔ 必须对所有会话调用，见文件头）。
 * @param params 通知事件的 params（带 threadId 与 item）
 * @param method 事件方法名（只处理 item/started 与 item/completed）
 */
export function noteOfficeActivity(params: any, method: string): void {
  /* ⛔ 先按方法名短路：item/agentMessage/delta 这类高频事件每字一条，
     不短路的话这里会变成一条真的热路径。 */
  if (method !== "item/started" && method !== "item/completed") return;
  const threadId = String(params?.threadId ?? "");
  const item = params?.item;
  if (!threadId || !item || typeof item !== "object") return;
  const info = classifyOfficeItem(item);
  if (!info) return;

  const now = Date.now();
  const prev = STORE.get(threadId);
  const same = prev && prev.kind === info.kind && prev.detail === info.detail;
  if (method === "item/started") {
    /* 同一条事件重复 started（引擎会重放）⇒ 保留原计时，别把"已跑 8 秒"重置成 0 */
    STORE.set(threadId, {
      ...info,
      at: same && prev.running ? prev.at : now,
      running: true,
      updatedAt: now,
      tookMs: 0,
    });
  } else {
    /* completed：内容形状可能比 started 更全（例如 fileChange 完成时才带 diff），
       所以用新 info 覆盖，但**开始时刻沿用旧的** —— 否则耗时永远是 0。 */
    const startedAt = same ? prev.at : now;
    STORE.set(threadId, {
      ...info,
      at: startedAt,
      running: false,
      updatedAt: now,
      tookMs: Math.max(0, now - startedAt),
    });
  }
}

/** 该会话"刚做完"的事件还能在屏上留多久（超过就交给阶段画面 / 屏保）。 */
export const ACTIVITY_LINGER_MS = 10000;

/**
 * 取该会话当前该演的事件。
 * @returns null = 没有可演的事件（或已过期）⇒ 调用方按**运行阶段**决定画面。
 */
export function officeActivityOf(threadId: string, now = Date.now()): OfficeActivityEntry | null {
  const id = String(threadId ?? "");
  if (!id) return null;
  const entry = STORE.get(id);
  if (!entry) return null;
  if (!entry.running && now - entry.updatedAt > ACTIVITY_LINGER_MS) return null;
  return entry;
}

/** 屏面计时器要用的毫秒数（进行中 = 实时；已完成 = 本次耗时）。 */
export function activityElapsedMs(entry: OfficeActivityEntry, now = Date.now()): number {
  return entry.running ? Math.max(0, now - entry.at) : entry.tookMs;
}

/** 清账（诊断探针 / 会话归档时用；⛔ 业务路径不调，让旧记录自然过期）。 */
export function clearOfficeActivity(threadId?: string): void {
  if (threadId) STORE.delete(String(threadId));
  else STORE.clear();
}
