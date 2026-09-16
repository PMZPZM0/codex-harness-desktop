/**
 * config.toml 的读写边界 + TOML 字面量工具。
 *
 * 这个文件存在的理由：harness 每次保存模型/个性化都会整份重写 config.toml，
 * 写错一个字节引擎就起不来，所以「哪些段落归 harness、哪些要原样留给用户」
 * 必须集中在一处，并且能被 scripts/check-preflight.mjs 单独跑测试
 * （预检直接 require 本文件的编译产物 dist-electron/config-toml.js 跑真行为）。
 */

/** harness 自己会重新生成的顶层键 —— 同时也是**必须主动丢弃**的废止键集合。
 *  ⚠️ `model_context_window` 属于后者（09-16 改）：harness 已**不再生成**它（顶层是引擎的全局
 *  单值，会覆盖 catalog 里每个模型各自的 context_window → 表现为「只有默认那个模型的上下文
 *  生效」，用户实测）。但**必须把它留在这个集合里**：本集合的作用正是「拼回用户段时丢弃
 *  harness 管的键」，留着才能把老版本写下的旧值一并清掉。一旦移出，旧值会被
 *  `preserveUserConfig` 原样拼回新配置 → bug 立刻复现。 */
export const HARNESS_CONFIG_KEYS = new Set(["model", "model_context_window", "model_provider", "preferred_auth_method", "developer_instructions", "model_catalog_json", "model_reasoning_effort"]);

/** harness 自己会**整段**重写的表；其余段落（用户手工配置的 projects / marketplaces /
 *  plugins / hooks / permissions / 自定义段）原样保留。
 *
 *  ⛔ `permissions` 已于 09-16 移出（修 Bug 1/2）：
 *   ① 引擎**没有** per-tool 的「工具 → deny/ask/allow」配置机制（`PermissionProfileToml` 只有
 *      description/extends/workspace_roots/filesystem/network 五个字段，写 `"mcp__x__y" = true`
 *      被静默丢弃）；
 *   ② 只写 `[permissions.*]` 而**不写**顶层 `default_permissions`，引擎判定**整份配置非法**
 *      （stderr `Invalid configuration; using defaults`，随后 `config/read` / `mcpServerStatus/list`
 *      全部硬报错）—— 而 harness 恰恰从来不写 `default_permissions`，等于「点一下权限格就把配置打废」。
 *  ⇒ 工具级权限改走引擎真正支持的键（见 `injectMcpToolRules`），同时把 `permissions` 归还用户，
 *    用户自己写的 `[permissions.*]` 与 `default_permissions` 从此不再被删。 */
export const HARNESS_CONFIG_SECTIONS = new Set(["model_providers", "windows", "tools", "sandbox_workspace_write", "shell_environment_policy", "features", "mcp_servers", "otel"]);

/** 段级共享表里 harness **只拥有这几个子键**，其余子键属于用户、必须原样保留。
 *  ⛔ 09-16 修 Bug 6：旧实现是「段级所有权」——只要段名在 HARNESS_CONFIG_SECTIONS 里就
 *  整段丢弃，于是用户手写的 `features.memories` / `otel.trace_exporter` /
 *  `sandbox_workspace_write.exclude_tmpdir_env_var` / `windows.sandbox_private_desktop` /
 *  `shell_environment_policy.exclude` 全被静默删除（已实测这些键引擎真的会读 → 真实功能丢失）。
 *  现在改成「键级所有权」：harness 只删自己写的那几个键，用户键经 `injectSectionExtras`
 *  插回同一个表里（TOML 不允许同名表声明两次，所以必须插进 harness 自己的段，不能另起一段）。 */
export const HARNESS_SECTION_KEYS: Record<string, Set<string>> = {
  windows: new Set(["sandbox"]),
  tools: new Set(["web_search"]),
  features: new Set(["browser_use"]),
  otel: new Set(["exporter"]),
  sandbox_workspace_write: new Set(["network_access"]),
  shell_environment_policy: new Set(["inherit", "ignore_default_excludes"]),
  "shell_environment_policy.set": new Set(["PATH", "PYTHON", "PYTHON_EXECUTABLE", "PYTHONHOME"]),
};

/**
 * 解析 TOML 表头 → 段路径数组；不是表头返回 null。
 * 支持三种键写法：裸键（`A-Za-z0-9_-`）/ 基本字符串 `"a b"` / 字面量字符串 `'a b'`，
 * 以及它们用 `.` 拼起来的路径。
 *
 * ⛔ 09-16 修 Bug 9：旧实现用 `/^\s*\[\[?\s*([A-Za-z0-9_.'"-]+)[^\]]*\]\]?\s*$/` 取第一个
 * token，字符类里**没有空格、没有非 ASCII、没有 `@ : +`** ⇒ `[mcp_servers."my server"]`、
 * `[mcp_servers."我的服务"]`、`[mcp_servers."@scope/pkg"]` 这类**引擎完全接受**的写法
 * 采不到名字 → `preserveUserConfig` 把整段当 harness 段丢掉 → 用户手写的 MCP 服务器
 * 下次保存模型时凭空消失（零报错）。现在按 TOML 语法真解析。
 */
export function parseTableHeader(line: string): string[] | null {
  const match = /^\s*\[\[?\s*([\s\S]*?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
  if (!match) return null;
  const body = match[1];
  if (!body) return null;
  const parts: string[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "." || ch === " " || ch === "\t") { i += 1; continue; }
    if (ch === '"' || ch === "'") {
      let out = "";
      i += 1;
      while (i < body.length && body[i] !== ch) {
        if (ch === '"' && body[i] === "\\" && i + 1 < body.length) {
          const esc = body[i + 1];
          out += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === "r" ? "\r" : esc === '"' ? '"' : esc === "\\" ? "\\" : esc;
          i += 2;
          continue;
        }
        out += body[i];
        i += 1;
      }
      if (i >= body.length) return null; // 引号未闭合
      i += 1;
      parts.push(out);
      continue;
    }
    const start = i;
    while (i < body.length && !/[\s.]/.test(body[i])) i += 1;
    const bare = body.slice(start, i);
    if (!bare) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(bare)) return null; // TOML 裸键字符集
    parts.push(bare);
  }
  return parts.length ? parts : null;
}

/** 单个字符串字面量的转义（含引号）。
 *  ⛔ 09-16 修 Bug 5：旧实现只转义 `\` 与 `"`，**不处理换行/制表/控制字符**。
 *  TOML 单行基本字符串里裸换行是非法的 ⇒ 用户粘贴一个带尾换行的 base_url / 模型名 /
 *  连接器参数，就能写出 `Illegal character '\n'` → 引擎**整份配置作废**
 *  （`initialize` 照样 OK，只有 stderr 与 `config/read` 暴露，极具欺骗性）。
 *  注意：`new URL()` 之类的校验挡不住它 —— URL 规范会主动剥掉 ASCII 换行，
 *  于是「校验通过」而落盘的是**没剥除的原始串**。所以必须在拼 TOML 时兜住。 */
export function escapeTomlString(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    // 其余 C0 控制字符与 DEL：TOML 基本字符串里不允许裸写，直接剔除（它们从来不是有意义的内容）
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** 表头里的裸键（provider id / 服务器名）。TOML 裸键只允许 `A-Za-z0-9_-`，
 *  其余字符一律剔除 —— 表头里写 `\n` / `"` 只会让整份配置非法，不如退化成合法名字。 */
export function tomlBareKey(value: string): string {
  const bare = String(value).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return bare || "unnamed";
}

/** 表头里表示一个键：合法裸键原样，否则用基本字符串包起来 */
export function tomlHeaderKey(value: string): string {
  const raw = String(value);
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : `"${escapeTomlString(raw)}"`;
}

export type PreservedUserConfig = {
  /** 用户自己的顶层键值（标量/数组/内联表）。⛔ 必须输出在**第一个段头之前** ——
   *  拼在文件末尾的话 TOML 语义上它们属于上一个段，引擎根本读不到（09-16 修 Bug 3）。 */
  topLevel: string;
  /** 用户自己的整段（projects / marketplaces / plugins / hooks / permissions / 自定义段） */
  sections: string;
  /** 段级共享表里用户的额外子键：`段路径.join(".")` → 行数组，由 `injectSectionExtras` 插回 */
  sectionExtras: Record<string, string[]>;
};

/**
 * 从现有 config.toml 中挑出 harness 不拥有的内容。
 *  · 顶层：丢掉 harness 管的键（含废止残留），其余原样留待拼回**文件开头**
 *  · 段：整段不属于 harness → 原样保留；段级共享表 → 只保留非 harness 子键（键级所有权）
 * 注意 mcp_servers 永远会被丢掉：连接器与内置 nuphus 由 harness 重新生成，
 * 用户手工写的那些由 readUserConfigSplit 按覆盖表决定是否拼回。
 */
export function preserveUserConfig(existing: string): PreservedUserConfig {
  const topLevel: string[] = [];
  const sections: string[] = [];
  const sectionExtras: Record<string, string[]> = {};
  /** 当前所处的段路径（null = 还没遇到任何段头，即顶层） */
  let currentPath: string[] | null = null;
  let currentOwnedKeys: Set<string> | null = null;
  let skipWholeSection = false;
  let inBlockString = false;

  for (const line of existing.split(/\r?\n/)) {
    if (inBlockString) {
      // 多行字符串内部一律随所属键一起丢弃，否则残留内容会污染新配置
      if (line.includes('"""')) { inBlockString = false; skipWholeSection = false; }
      continue;
    }
    const header = parseTableHeader(line);
    if (header) {
      const base = header[0];
      if (HARNESS_CONFIG_SECTIONS.has(base)) {
        // 段级共享表：harness 只拥有 HARNESS_SECTION_KEYS 里列的子键，其余是用户的
        currentOwnedKeys = HARNESS_SECTION_KEYS[header.join(".")] ?? null;
        skipWholeSection = currentOwnedKeys === null; // 没声明子键所有权 = 整段归 harness
      } else {
        currentOwnedKeys = null;
        skipWholeSection = false;
        sections.push(line);
      }
      currentPath = header;
      continue;
    }
    if (currentPath === null) {
      // 顶层（仍在第一个段头之前）
      const scalar = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
      if (scalar && HARNESS_CONFIG_KEYS.has(scalar[1])) {
        if ((line.match(/"""/g) ?? []).length === 1) { inBlockString = true; skipWholeSection = true; }
        continue;
      }
      if (line.trim()) topLevel.push(line);
      continue;
    }
    if (skipWholeSection) continue;
    if (currentOwnedKeys) {
      const scalar = line.match(/^\s*([A-Za-z0-9_.'"-]+)\s*=/);
      const key = scalar ? scalar[1].replace(/^['"]|['"]$/g, "") : "";
      if (key && currentOwnedKeys.has(key)) continue; // harness 自己会重写这个子键
      // 用户的子键：必须是合法的 key = value 行才收（表头/数组续行/空行跳过）
      if (key && line.includes("=")) {
        (sectionExtras[currentPath.join(".")] ??= []).push(line.trim());
      }
      continue;
    }
    sections.push(line);
  }
  return {
    topLevel: topLevel.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    sections: sections.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    sectionExtras,
  };
}

/** 列出 config.toml 里所有 `[mcp_servers.X]` 的 X（支持裸键与带引号两种写法，见 parseTableHeader） */
export function collectMcpServerNames(raw: string): string[] {
  const names: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const header = parseTableHeader(line);
    if (!header || header.length !== 2 || header[0] !== "mcp_servers") continue;
    if (header[1]) names.push(header[1]);
  }
  return names;
}

/** 把用户手写的额外子键插回对应段落**末尾**（同一张表的续行位置）。
 *  extras 的键是段路径，按 `[x]` / `[x.y]` 精确匹配 —— 子表 `[shell_environment_policy.set]`
 *  与父表分开处理，互不串味。
 *  ⚠️ harness 有**条件写入**的段（如 `[features]` 只在浏览器自动化开着时写）：那时表根本不存在，
 *  直接插就无处可插 —— 所以没匹配到的路径会在文末**补建**该表，否则用户的子键又会被静默丢掉。 */
export function injectSectionExtras(text: string, extras: Record<string, string[]>): string {
  const paths = Object.keys(extras).filter((path) => extras[path]?.length);
  if (!paths.length) return text;
  const matched = new Set<string>();
  const out: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current && extras[current]?.length) { out.push(...extras[current]); matched.add(current); }
    current = null;
  };
  for (const line of text.split("\n")) {
    const header = parseTableHeader(line);
    if (header) { flush(); current = header.join("."); }
    out.push(line);
  }
  flush();
  const missing = paths.filter((path) => !matched.has(path));
  if (missing.length) {
    if (out.at(-1)?.trim()) out.push("");
    for (const path of missing) {
      out.push(`[${path}]`, ...extras[path], "");
    }
  }
  return out.join("\n");
}

/** 单个 MCP 服务器的工具级规则（来自连接器页的权限格） */
export type McpToolRules = { deny: string[]; ask: string[]; allow: string[] };

/**
 * 把「按工具权限」落到引擎**真正支持**的键上（09-16 实证，替换掉旧的 `[permissions.*]` 写法）：
 *   · deny  → `disabled_tools = [...]`（父表内的键）→ 工具从引擎工具表里**消失**，模型看不到 = 真阻断
 *   · ask   → `[mcp_servers.<名>.tools.<工具>] approval_mode = "prompt"`（引擎侧审批档位）
 *   · allow → 同上的 `approval_mode = "auto"`
 *
 * 实证记录（真实 app-server + 最小 stdio MCP 暴露 alpha/beta）：
 *   · `enabled_tools = ["alpha"]` / `disabled_tools = ["beta"]` → `mcpServerStatus/list` 只剩 alpha ✓
 *   · `tools.<名>.enabled = false` → **无效**（未知键被静默忽略，两个工具都还在）
 *   · `approval_mode` 合法枚举 = auto / prompt / writes / approve（写别的值会让整份配置被拒）
 *   · `omit_tools_from` 收的是 `code_mode`/`deferred` 这类枚举，**不是**工具名，别拿它做黑名单
 */
export function injectMcpToolRules(text: string, rules: Record<string, McpToolRules>): string {
  const entries = Object.entries(rules).filter(([, rule]) => rule.deny.length || rule.ask.length || rule.allow.length);
  if (!entries.length) return text;
  const byName = new Map<string, McpToolRules>(entries);
  const out: string[] = [];
  let pendingSubTables: string[] = [];
  const flush = () => { if (pendingSubTables.length) { out.push(...pendingSubTables, ""); pendingSubTables = []; } };
  for (const line of text.split("\n")) {
    const header = parseTableHeader(line);
    if (header) {
      flush();
      out.push(line);
      if (header.length === 2 && header[0] === "mcp_servers") {
        const rule = byName.get(header[1]);
        if (rule) {
          if (rule.deny.length) out.push(`disabled_tools = [${rule.deny.map((tool) => `"${escapeTomlString(tool)}"`).join(", ")}]`);
          const parent = line.trim().replace(/\s*#.*$/, "");
          for (const tool of rule.ask) pendingSubTables.push("", `${parent.slice(0, -1)}.tools.${tomlHeaderKey(tool)}]`, 'approval_mode = "prompt"');
          for (const tool of rule.allow) pendingSubTables.push("", `${parent.slice(0, -1)}.tools.${tomlHeaderKey(tool)}]`, 'approval_mode = "auto"');
        }
      }
      continue;
    }
    out.push(line);
  }
  flush();
  return out.join("\n");
}

/**
 * 抠出 `[mcp_servers.X]` 整段（含表头）。
 * 用户手工写进去的 MCP 没有连接器记录，停用前必须把原文存下来，否则启用时无从恢复。
 */
export function extractMcpSection(raw: string, name: string): string {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const header = parseTableHeader(line);
    return Boolean(header && header.length === 2 && header[0] === "mcp_servers" && header[1] === name);
  });
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (parseTableHeader(lines[i])) { end = i; break; }
  }
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end).join("\n");
}
