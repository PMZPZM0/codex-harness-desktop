/**
 * 工具的**技能归属**映射（纯函数，不依赖 React / Electron ⇒ 预检守卫可直接 import 跑断言）。
 *
 * 为什么需要（09-24 用户：「还有使用了技能类似没看见」）：
 *   技能（SkillHub 装的 / 内置技能）被使用时，引擎那边就是一条普通的
 *   `mcpToolCall`（`desktop_screenshot`）/ `dynamicToolCall` / `commandExecution`（markitdown …），
 *   界面上显示成「调用 nuphus/desktop_screenshot」—— 看不出**这是在用一个技能**，
 *   更看不出用的是哪个技能。这里按工具名/服务器名/命令特征认出"这属于哪个技能"。
 *
 * ⛔ 判据是**字面特征匹配**（不查磁盘、不读 SKILL.md、不做任何 I/O）：技能目录是
 *   用户可随时增删的，渲染层不能为了贴标签去读盘；认不出就返回 null ⇒ 保持原样显示。
 */

/** 技能 → 特征。顺序即优先级（先命中先算）。 */
export const SKILL_MATCHERS = [
  // 内置技能 desktop-automation：nuphus MCP 的 desktop_* 工具
  { skill: "desktop-automation", label: "桌面自动化", re: /\b(desktop_[a-z_]+|nuphus)\b/i },
  // 内置技能 browser-automation：playwright-cli / CloakBrowser / browser_* 工具
  { skill: "browser-automation", label: "浏览器自动化", re: /\b(browser_[a-z_]+|playwright(?:-cli)?|cloakbrowser)\b/i },
  // 内置技能 document-convert：markitdown / openpyxl 转档
  { skill: "document-convert", label: "文档转换", re: /\b(markitdown|openpyxl|document-convert|doc-convert)\b/i },
  { skill: "humanizer", label: "去 AI 味", re: /\bhumaniz(?:e|er|ed)?\b/i },
  { skill: "no-ai-slop", label: "去 AI 套话", re: /\bno[-_ ]?ai[-_ ]?slop\b/i },
  { skill: "i-have-adhd", label: "ADHD 写法", re: /\badhd\b/i },
  { skill: "self-review", label: "自我审查", re: /\bself[-_ ]?review\b/i },
  { skill: "memory-distill", label: "记忆蒸馏", re: /\bmemory[-_ ]?(distill|hygiene)\b/i },
  { skill: "skill-authoring", label: "技能编写", re: /\bskill[-_ ]?authoring\b/i },
];

/**
 * 「怎么用的」：从工具入参里挑**最能说明这次在干什么**的那一个（09-24 用户：「技能，插件，mcp
 * 等等都要展示出来怎么用了」—— 光显示名字不知道它干了啥）。
 *
 * 判据：按信息量排序的键名白名单（url / 路径 / 查询词 / 命令 / 代码 / 目标 …），
 * 取第一个有值的；`target` / `file` 这类对象再下钻一层取它的 path/url。
 * 值一律截断（默认 48），认不出返回空串 —— 调用方据此不显示这一段，别显示 `{}` 噪音。
 * @param {unknown} args 工具的入参（mcpToolCall.arguments 等）
 * @param {number} [max] 截断长度
 * @returns {string}
 */
const ARG_KEYS = ["url", "uri", "target", "path", "filePath", "file", "filename", "query", "q", "search", "command", "cmd", "code", "prompt", "text", "input", "name", "title", "selector", "memberId", "skill", "method", "id"];

export function argSummary(args, max = 48) {
  if (args == null) return "";
  if (typeof args === "string") return trunc(args, max);
  if (Array.isArray(args)) return args.length ? argSummary(args[0], max) : "";
  if (typeof args !== "object") return trunc(String(args), max);
  const bag = args;
  for (const key of ARG_KEYS) {
    const value = bag[key];
    if (value == null || value === "") continue;
    // 形如 { type:"file", path:"D:\…" } / { url:"https://…" } 的对象下钻一层
    if (typeof value === "object" && !Array.isArray(value)) {
      const inner = value.path ?? value.url ?? value.uri ?? value.file ?? value.name ?? value.target;
      if (inner != null && inner !== "") return trunc(String(inner).replace(/\\/g, "/"), max);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length) return trunc(String(value[0]).replace(/\\/g, "/"), max);
      continue;
    }
    return trunc(String(value).replace(/\\/g, "/"), max);
  }
  // 白名单都没命中：退到第一个字符串值（比显示 `{}` 有用）
  for (const value of Object.values(bag)) {
    if (typeof value === "string" && value.trim()) return trunc(value, max);
  }
  return "";
}

function trunc(value, max) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 技能/插件目录的**路径特征**（用户自建技能、插件缓存技能都靠它认 —— 名字不在内置表里也照样显示）。 */
const SKILL_PATH_RE = /[\\/](?:\.codex[\\/])?skills[\\/]([A-Za-z0-9._-]+)(?:[\\/]|$)/;
// ⛔ `plugins/cache/<vendor>/<plugin>/…` 要取**插件名**而不是 vendor 名（09-24 实测：命中成
//   `workbuddy-builtin` 等于没信息）—— 所以 cache 那一层是「vendor 段」要整段吃掉。
const PLUGIN_PATH_RE = /[\\/](?:connectors-marketplace|plugins)[\\/](?:cache[\\/][A-Za-z0-9._-]+[\\/])?([A-Za-z0-9._-]+)(?:[\\/]|$)/;

/** 已知技能名 → 中文名（路径命中时用它美化，认不出就用目录名本身）。 */
function labelForSkillName(name) {
  const known = KNOWN_SKILLS.get(String(name ?? "").toLowerCase());
  if (known) return known;
  const builtin = SKILL_MATCHERS.find((entry) => entry.skill === name);
  return builtin ? builtin.label : name;
}

/* ── 本地技能清单（09-24）：把「目录名」翻成人话的唯一真相源 ─────────────
   为什么需要：路径兜底能认出 `…/skills/<名>/…`，但拿到的只是**目录名**
   （`electron-main-surgery` 这种），用户看不懂。服务能力 swallow 主进程
   `skills:local-list` 给出的 name / descriptionZh / description —— 这是引擎之外
   唯一写着"这个技能是干什么的"的地方。渲染层**不读盘**，只接这份已加载的数据。
   ⛔ 没注册完全不影响功能（退回目录名），所以失败/未加载都静默。 */
const KNOWN_SKILLS = new Map();

/**
 * 注册本地技能清单（App 启动拉一次 `skills:local-list` 后调用即可，可重复调用）。
 * @param {Array<{ name?: string, folder?: string, descriptionZh?: string, description?: string }>} list
 * @returns {number} 实际登记条数
 */
export function registerKnownSkills(list) {
  let count = 0;
  if (!Array.isArray(list)) return 0;
  for (const entry of list) {
    const name = String(entry?.name ?? entry?.folder ?? "").trim();
    if (!name) continue;
    const pretty = String(entry?.descriptionZh ?? entry?.description ?? "").replace(/\s+/g, " ").trim();
    const label = pretty ? (pretty.length > 18 ? `${pretty.slice(0, 18)}…` : pretty) : name;
    KNOWN_SKILLS.set(name.toLowerCase(), label);
    // 目录名与技能名不同（市场装的技能常见）时两条都登记
    const folder = String(entry?.folder ?? "").trim();
    if (folder && folder.toLowerCase() !== name.toLowerCase()) KNOWN_SKILLS.set(folder.toLowerCase(), label);
    count++;
  }
  return count;
}

/** 已登记多少条（便于探针/守卫断言，也为排查"清单没喂进来"留个口子） */
export function knownSkillCount() {
  return KNOWN_SKILLS.size;
}

/**
 * 这条工具调用属于哪个技能？认不出返回 null（调用方保持原样显示，别硬贴标签）。
 * ① 先按工具/命令特征（desktop_*、markitdown …）；② 再按**技能目录路径**（`…/skills/<name>/…`）
 * —— 用户自建技能、以及模型直接跑技能脚本的形态都靠 ② 兜住（09-24：会话里技能多半是这么用的）。
 * @param {{ type?: string, server?: string, tool?: string, command?: string }} item
 * @returns {{ skill: string, label: string } | null}
 */
export function skillOfItem(item) {
  const type = String(item?.type ?? "");
  let hay = "";
  if (type === "mcpToolCall") hay = `${item.server ?? ""}/${item.tool ?? ""}`;
  else if (type === "dynamicToolCall") hay = String(item.tool ?? "");
  else if (type === "commandExecution") hay = String(item.command ?? "");
  else return null;
  // 工具**入参**里也可能带着技能路径（09-24： swallowed 例如跨技能转发时把 SKILL.md 当参数传进来），
  // 一并纳入匹配串（限量 2000 字符，防止超大载荷拖慢每帧渲染）。
  if (hay && item?.arguments) hay += " " + JSON.stringify(item.arguments).slice(0, 2000);
  if (!hay.trim()) return null;
  for (const matcher of SKILL_MATCHERS) {
    if (matcher.re.test(hay)) return { skill: matcher.skill, label: matcher.label };
  }
  const byPath = hay.match(SKILL_PATH_RE);
  if (byPath) return { skill: byPath[1], label: labelForSkillName(byPath[1]) };
  return null;
}

/**
 * 技能卡的**目标显示规则**（09-24 真机实测定下来的，卡片与折叠芯片共用这一个真相源）：
 *   · 目标本身在技能目录里（`…/skills/<名>/…`）⇒ 空（读 SKILL.md 这个动作本身就是"用技能"，
 *     再把文件名拼上去只会重复）；
 *   · 目标是长路径 ⇒ 只留文件名（`…/humanizer/SKILL.md` → `SKILL.md`）；
 *   · 连文件名都被截断成半截（`…/.workbud…`）⇒ 空 —— 半截目录比不显示更糟
 *     （真机：commandTarget 会把 `.workbuddy` 当成扩展名先命中）。
 * @param {string} target commandTarget(...) / argSummary(...) 的结果
 * @returns {string}
 */
export function skillTargetLabel(target) {
  const isDotDir = (v) => /^\.[A-Za-z0-9_-]+$/.test(v);
  const raw = String(target ?? "").trim();
  if (!raw || isDotDir(raw)) return "";
  if (/skills[\\/]/i.test(raw)) return "";
  if (/[\\/]/.test(raw)) {
    const seg = raw.split(/[\\/]/).filter(Boolean).pop() ?? "";
    // 半截（含省略号）与纯点目录段都没有信息量
    return seg && !/…/.test(seg) && !isDotDir(seg) ? seg : "";
  }
  return raw;
}

/**
 * 这条调用来自哪个**插件**（`…/plugins/cache/<vendor>/<plugin>/…` 或 `…/connectors-marketplace/<x>/…`）？
 * 认不出返回 null。插件与技能分开：技能是"方法论/脚本包"，插件是 MCP 工具包（09-24）。
 * @param {{ type?: string, server?: string, tool?: string, command?: string }} item
 * @returns {{ plugin: string } | null}
 */
export function pluginOfItem(item) {
  const type = String(item?.type ?? "");
  const hay = type === "mcpToolCall" ? `${item.server ?? ""}/${item.tool ?? ""}`
    : type === "dynamicToolCall" ? String(item.tool ?? "")
    : type === "commandExecution" ? String(item.command ?? "")
    : "";
  if (!hay) return null;
  const matched = hay.match(PLUGIN_PATH_RE);
  return matched ? { plugin: matched[1] } : null;
}
