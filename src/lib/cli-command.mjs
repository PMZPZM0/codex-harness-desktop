/**
 * CLI 智能体的「单轮非交互」命令模板 —— 跨进程单一真相源。
 *
 * 背景（11-06 用户报障：QwenPaw 派活报 `No such option '-F'`）：
 * 宿主把 `{prompt}` 原样拼进命令，任务正文里只要有 `-First` 这类片段，就会被 shell
 * 拆成独立参数，再被 CLI 当成短选项（`-First` → `-F`）⇒ 任务一个字都没跑。
 *
 * 两条纪律：
 *   ① `{prompt}` 必须整体当一个参数传（`fillCliPromptTemplate` 负责补引号）；
 *   ② 每条 CLI 的传参开关写在 `CLI_PROMPT_COMMANDS`，别再让模型自己猜。
 *      ⛔ 核实不到非交互入口的（openclaw / codebuddy / comatecli / qoder / trae）
 *        不写假模板，留给模型先跑 `--help`。
 */

/** 可执行名 → 单轮非交互命令模板（`{prompt}` 是任务全文占位符）。
 *  每条都对着官方文档 / npm README 核实过（见各条注释）；核实不到的不写假模板。 */
export const CLI_PROMPT_COMMANDS = {
  claude: 'claude -p "{prompt}"',
  codex: 'codex exec "{prompt}"',
  gemini: 'gemini -p "{prompt}"',
  aider: 'aider --message "{prompt}" --yes',
  /* OpenClaw：setup 文档 `-m/--message` 单次请求；agent 子命令要带 --agent 名。
     ⛔ 加 --json：社区实证不带它 stdout 只回「completed + 状态条」，看不到回答。 */
  openclaw: 'openclaw agent --agent main -m "{prompt}" --json',
  /* Qwen Code：官方 headless 文档写的是 `qwen --prompt "<任务>"`。 */
  qwen: 'qwen --prompt "{prompt}"',
  /* QwenPaw（pip 包同时装出 qwenpaw / copaw 两个入口）：
     `task` 子命令 + `-i/--instruction` 必填；实测 `qwenpaw task --help`。 */
  qwenpaw: 'qwenpaw task -i "{prompt}" --max-iters 20 -t 540',
  /* Kimi Code：官方帮助 `kimi -p "<任务>"`（`-c` 是续会话）。 */
  kimi: 'kimi -p "{prompt}"',
  /* CodeBuddy Code：官方仓 `codebuddy -p "<任务>"`。 */
  codebuddy: 'codebuddy -p "{prompt}"',
  /* Comate CLI：npm README 的 headless 形态 `comatecli run -q "<任务>" --display event-stream`。 */
  comatecli: 'comatecli run -q "{prompt}" --display event-stream',
  /* Qoder CLI：npm README `qodercli -p`；`qoder` 是同一包的 dispatcher（实测把 argv.slice(2) 原样转发）。 */
  qoder: 'qoder -p "{prompt}"',
  /* Trae CLI：官方文档明确「历史 `-p` 任务参数改用 `--print`」。 */
  traecli: 'traecli --print "{prompt}"',
  zcode: 'zcode -p "{prompt}"',
  workbuddy: 'workbuddy "{prompt}"',
  deepseek: 'deepseek "{prompt}"',
  doubao: 'doubao "{prompt}"',
};

const BIN_ALIASES = { copaw: "qwenpaw" };

/* ── 派活权限档（11-07 用户令：每个 CLI 可选 安全 / 标准 / 完全，默认标准）──────────
 * 背景：这些 CLI 的单轮非交互模板只保证「能跑起来」，但无头模式下没人回答权限询问，
 * 大多数会把「需要确认」的动作直接拒绝（只读能过、改文件/跑命令被拒）——表现和 QwenPaw
 * 的 tools=0 很像：能说话，干不了活。
 *
 * ⛔ 只写**官方文档核实过**的参数；没把握的 CLI 一律不写（返回空串 ⇒ 行为不变）。
 * ⛔ safe = 只读分析；standard = 允许改文件（命令仍按各 CLI 默认）；full = 连命令一起放行。
 * ⛔ 这些是「本机任意命令执行」的开关，默认必须是 standard，且只在用户显式选择时升级。 */
export const CLI_PERMISSION_TIERS = ["safe", "standard", "full"];

const CLI_PERMISSION_FLAGS = {
  /* Claude Code：-p 下权限提示无人可答 ⇒ 默认拒绝；acceptEdits 放行编辑，bypassPermissions 全放行。 */
  claude: { safe: "", standard: "--permission-mode acceptEdits", full: "--permission-mode bypassPermissions" },
  /* Codex CLI：`-s/--sandbox` 在本版被策略层忽略（实测仍按 read-only 拦写）；可用的是
     `--approve-for-me`（走 workspace-write + 自动审查）与 `--dangerously-bypass-approvals-and-sandbox`。 */
  codex: { safe: "--sandbox read-only", standard: "--approve-for-me", full: "--dangerously-bypass-approvals-and-sandbox" },
  /* Gemini CLI：非交互无法授权工具；plan 只读、auto_edit 放行编辑、yolo 全放行。 */
  gemini: { safe: "--approval-mode plan", standard: "--approval-mode auto_edit", full: "--approval-mode yolo" },
  /* Qwen Code：Gemini 同源，审批档取值见其 /approval-mode 文档。 */
  qwen: { safe: "--approval-mode plan", standard: "--approval-mode auto-edit", full: "--approval-mode yolo" },
  /* Qoder CLI：官方明说 headless 下 ask → deny；accept_edits 放行编辑，--yolo 全放行。 */
  qoder: { safe: "", standard: "--permission-mode accept_edits", full: "--yolo" },
  /* CodeBuddy：默认严格只读；acceptEdits 放行编辑，bypassPermissions 全放行。 */
  codebuddy: { safe: "", standard: "--permission-mode acceptEdits", full: "--permission-mode bypassPermissions" },
  /* ⛔ Kimi Code 2.5.2 实测：`-p` 与 `--auto` / `--yolo` **不能同用**
     （报 `Cannot combine --prompt with --auto/--yolo`）⇒ 没有可用的无头权限参数，不写。
     它的权限模式只能在交互 TUI 里切，或靠它自己的配置文件。 */
  /* 其余（aider / openclaw / comatecli / traecli / iflow / harness / qwenpaw / kimi）：
     没有核实过、或实测不可用的无头权限开关 —— 不写，保持原命令。 */
};

/** 归一权限档：脏值/缺省一律回落 standard（⛔ 不因为一条坏数据把派活变成全放行）。 */
export function cliPermissionTierOf(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  return CLI_PERMISSION_TIERS.includes(value) ? value : "standard";
}

/** 该 CLI 是否有权限档参数（没有的，界面上要说明「此 CLI 无档位参数」）。 */
export function cliSupportsPermissionTier(bin) {
  const key = normalizeBinName(bin);
  return Boolean(CLI_PERMISSION_FLAGS[BIN_ALIASES[key] ?? key]);
}

/**
 * 给命令模板追加该档位的参数（幂等：已带同一段参数就不重复加）。
 * ⛔ 不认识的 bin / 自定义命令原样返回 —— 不猜别人的开关。
 */
export function applyCliPermissionTier(template, tier) {
  const tpl = String(template ?? "").trim();
  if (!tpl.includes("{prompt}")) return tpl;
  const bin = cliBinOf(tpl);
  const flags = CLI_PERMISSION_FLAGS[BIN_ALIASES[bin] ?? bin]?.[cliPermissionTierOf(tier)] ?? "";
  if (!flags || tpl.includes(flags)) return tpl;
  /* ⛔ Codex 的选项必须写在 PROMPT **之前**：`codex exec "{prompt}" --sandbox …` 里的
     `--sandbox` 会被当成提示词的一部分（实测：工作区写入仍被 read-only 策略拦下）。
     模板形如 `codex exec "{prompt}"` ⇒ 把参数插到子命令后面。 */
  if ((BIN_ALIASES[bin] ?? bin) === "codex") {
    return tpl.replace(/^(\S+\s+\S+)\s+/, `$1 ${flags} `);
  }
  return `${tpl} ${flags}`;
}

/** 规范单轮命令 + 权限档参数（空串 = 没有核实过的模板）。 */
export function cliPromptCommandFor(bin, tier = "standard") {
  return applyCliPermissionTier(cliPromptCommand(bin), tier);
}

function normalizeBinName(bin) {
  return String(bin ?? "").trim().toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh)$/, "");
}

/** 查某条 CLI 的规范单轮命令（空串 = 没有核实过的模板，别硬凑）。 */
export function cliPromptCommand(bin) {
  const key = normalizeBinName(bin);
  return CLI_PROMPT_COMMANDS[BIN_ALIASES[key] ?? key] ?? "";
}

/**
 * NO_PROXY 里的 IPv6 字面量去掉方括号。
 * ⛔ 11-06 QwenPaw 真机实测：`NO_PROXY=...,[::1],::1` 让 httpx 拼出 `all://*[::1]`，
 *   启动即抛 `InvalidURL: Invalid port: ':1]'` —— 所有 Python httpx 系 CLI 都会崩，
 *   而且报错在第三方栈里，看不出是环境变量的问题。
 */
export function normalizeNoProxyList(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .map((part) => (/^\[[^\]]+\]$/.test(part) ? part.slice(1, -1) : part))
    .join(",");
}

/** 模板里第一条命令（可执行名）。 */
export function cliBinOf(template) {
  const hit = String(template ?? "").trim().match(/^["']?([^\s"']+)["']?/);
  return hit ? normalizeBinName(hit[1]) : "";
}

/**
 * 任务全文 → 可安全塞进命令行的单行文本。
 *  · 换行会截断命令；双引号 / 反引号会破坏外层引号；`%` 在 cmd 里是变量展开；
 *  · `& | < > ^` 是命令分隔 / 重定向；`$` 在 sh 里是变量展开；
 *  · 结尾的反斜杠会吃掉收尾引号。
 * 提示词本质是自然语言，去掉这些符号不损失语义。
 */
export function sanitizeCliPrompt(text) {
  return String(text ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/["`]/g, "'")
    .replace(/[&|<>^%$]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\\+$/, "")
    .trim();
}

/**
 * 把任务全文填进模板 —— 无论模板自己带不带引号，结果都是**一个参数**。
 * ⛔ 这是 `-First` 被当成 `-F` 的根因修复点：模板写 `qwenpaw task {prompt}` 也安全。
 */
export function fillCliPromptTemplate(template, prompt) {
  const tpl = String(template ?? "");
  const value = sanitizeCliPrompt(prompt);
  if (tpl.includes('"{prompt}"')) return tpl.split('"{prompt}"').join(`"${value}"`);
  /* 占位符被单引号包着：换成双引号 —— cmd 不认单引号分组，`'a b'` 会被拆成两个参数。 */
  if (tpl.includes("'{prompt}'")) return tpl.split("'{prompt}'").join(`"${value}"`);
  const idx = tpl.indexOf("{prompt}");
  if (idx < 0) return tpl;
  /* 占位符夹在更长的引号串里（`bin -p "任务：{prompt}"`）：只在里面填值，别再加一层引号。 */
  const quotesBefore = (quote) => tpl.slice(0, idx).split(quote).length - 1;
  const replacement = quotesBefore('"') % 2 === 1
    ? value
    : quotesBefore("'") % 2 === 1
      ? value.replace(/'/g, " ")
      : `"${value}"`;
  return tpl.split("{prompt}").join(replacement);
}

/** 模板里「必须出现」的标记：子命令字面量 + 开关（开关的取值不算）。 */
function requiredTokens(spec) {
  const tokens = String(spec ?? "").trim().split(/\s+/).slice(1);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token === "{prompt}" || token === '"{prompt}"' || token === "'{prompt}'") continue;
    if (token.startsWith("-")) {
      out.push(token);
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 修复老档案里「猜出来的」CLI 命令模板（11-06 起在 store.load 与派活前调用）。
 * 判定：模板首条命令有规范模板，且缺了规范模板里的必要标记 ⇒ 换成规范模板。
 * ⛔ 用户自己写过完整开关的模板（含全部必要标记）原样保留。
 */
export function healCliCommand(template) {
  const command = String(template ?? "").trim();
  if (!command.includes("{prompt}")) return command;
  const bin = cliBinOf(command);
  const spec = cliPromptCommand(bin);
  if (!spec) return command;
  const missing = requiredTokens(spec).filter((token) => !new RegExp(`(^|\\s)${escapeRe(token)}(?=\\s|$)`).test(command));
  if (!missing.length) return command;
  return spec.replace(/^\S+/, bin);
}
