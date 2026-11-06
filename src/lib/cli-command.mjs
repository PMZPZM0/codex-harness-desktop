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

/** 可执行名 → 单轮非交互命令模板（`{prompt}` 是任务全文占位符）。 */
export const CLI_PROMPT_COMMANDS = {
  claude: 'claude -p "{prompt}"',
  codex: 'codex exec "{prompt}"',
  gemini: 'gemini -p "{prompt}"',
  aider: 'aider --message "{prompt}" --yes',
  qwen: 'qwen -p "{prompt}"',
  /* QwenPaw（pip 包同时装出 qwenpaw / copaw 两个入口）：
     `task` 子命令 + `-i/--instruction` 必填；实测 `qwenpaw task --help`。 */
  qwenpaw: 'qwenpaw task -i "{prompt}" --max-iters 20 -t 540',
  iflow: 'iflow -p "{prompt}"',
  kimi: 'kimi -p "{prompt}"',
  zcode: 'zcode -p "{prompt}"',
  qoder: 'qoder "{prompt}"',
  workbuddy: 'workbuddy "{prompt}"',
  deepseek: 'deepseek "{prompt}"',
  doubao: 'doubao "{prompt}"',
};

const BIN_ALIASES = { copaw: "qwenpaw" };

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
