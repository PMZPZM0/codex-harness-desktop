// src/lib/command-display.mjs
//
// 命令的**展示形态**（纯函数，不依赖 React / DOM / Electron ⇒ 预检守卫可直接 import 真实现跑断言）。
//
// 为什么需要剥壳（09-23 用户实测「图一看着很变扭」）：
//   引擎执行的命令是**宿主自己包过一层 shell 启动器**的形态 —— 真机原样：
//     "D:\Codex Harness Desktop-refactor\resources\tools\pwsh\pwsh.exe" -Command "Get-Content -Lit…"
//   于是界面上每一行都以同一段 ~90 字符的绝对路径开头（`resources/tools/pwsh/pwsh.exe` + `-Command "`），
//   真正想看的命令被挤到看不见，一屏里重复十几遍同样的前缀。
//   ⛔ 剥壳只用于**展示**：明细里那份可复制的完整命令必须保持引擎原文（用户要能照着复现），
//      不要拿本模块的结果去替换 `item.command` 本身。
//
// 剥壳是"尽力而为"的：认不出来就**原样返回**，绝不猜（宁可显示带壳的原文，也不能把用户的命令改错）。

/** shell 启动器的可执行名（引擎侧可能带路径、带引号、带 .exe） */
const SHELL_NAMES = /^(?:pwsh|powershell|cmd|bash|sh|zsh|wsl)(?:\.exe)?$/i;

/** 启动器后可跟的开关；白名单式识别，遇到不认识的就停止剥壳（避免吃掉真实命令的一段）。 */
const VALUE_SWITCHES = /^-(?:executionpolicy|enc|encodedcommand|inputformat|outputformat|configuration|workingdirectory|wd|workingdir)$/i;
const BARE_SWITCH = /^-(?:no(?:profile|logo)|noprofile|nologo|noninteractive|interactive|noprofile|login|norc|command|c|lc|i|s)$/i;
/** cmd.exe 的 `/c` 风格开关 */
const SLASH_SWITCH = /^\/[a-z]+$/i;

/** 取路径末段（用于判断启动器名字） */
function basename(value) {
  return String(value).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(value);
}

/** 去掉一层成对引号，并反转义 pwsh 的 `\"` / `\\`（只在成对引号内做，避免误伤裸命令） */
function unwrapQuotes(text) {
  const value = String(text ?? "").trim();
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first === "'" && last === "'") return value.slice(1, -1).replace(/''/g, "'");
  if (first === '"' && last === '"') {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\{2}/g, "\\");
  }
  return value;
}

/**
 * 剥掉 shell 启动器外壳，返回"用户真正想跑的那条命令"。
 * 认不出来 ⇒ 原样返回（含首尾空白已 trim）。
 * @param {string} command 引擎给的 `item.command`
 * @returns {string}
 */
export function stripShellLauncher(command) {
  let original = String(command ?? "").trim();
  if (!original) return "";
  // ⛔ 逗号形态（09-23 真机发现）：新引擎运行时把启动器记成 `C:\…\pwsh.exe,-Command "…"` ——
  //   逗号当分隔符。不先归一成空格，后面逐段剥开关的流程整个失配（剥不动 ⇒ 展示/目标全废）。
  //   只在「第一段以 .exe 结尾且是 shell 名」时才把逗号换成空格，绝不误伤别的命令。
  const commaHead = original.match(/^([^\s,]+?),/);
  if (commaHead && /\.exe$/i.test(commaHead[1]) && SHELL_NAMES.test(basename(commaHead[1]))) {
    original = original.slice(0, commaHead[1].length) + " " + original.slice(commaHead[1].length + 1);
  }
  // `& "path" -Command …` / `"path" -Command …` / `pwsh -Command …`
  const head = original.match(/^(?:&\s*)?(?:"([^"]*)"|'([^']*)'|(\S+))/);
  if (!head) return original;
  const token = head[1] ?? head[2] ?? head[3] ?? "";
  if (!SHELL_NAMES.test(basename(token))) return original;
  let rest = original.slice(head[0].length).trim();
  // 逐个吃掉启动器开关（`-NoProfile` / `-ExecutionPolicy Bypass` / `-lc` …），遇到第一个非开关就停
  for (;;) {
    const next = rest.match(/^(\S+)/);
    if (!next) return original;
    const flag = next[1];
    if (VALUE_SWITCHES.test(flag)) {
      const after = rest.slice(flag.length).trim().match(/^(\S+)/);
      // 值开关后面必须还有一个"值"（否则视为命令本体，不要吞）
      if (!after || after[1].startsWith("-")) return original;
      rest = rest.slice(flag.length).trim().slice(after[1].length).trim();
      continue;
    }
    if (BARE_SWITCH.test(flag) || SLASH_SWITCH.test(flag)) {
      rest = rest.slice(flag.length).trim();
      continue;
    }
    break;
  }
  const payload = unwrapQuotes(rest);
  // 剥完是空串说明"壳里没东西"⇒ 退回原文，别显示空
  return payload || original;
}

/**
 * 从命令里取一个**文件目标**（用于折叠块的意图摘要 topic，如「修改文件、运行命令：…/01-seg.tsx」）。
 * 取不到就返回空串 —— 调用方据此退回「运行命令」这类无目标文案
 * （⛔ 不要把整条命令当目标兜底，那正是"又长又乱"的来源）。
 *
 * 判据：像文件（带扩展名）且带路径分隔符（或盘符）的第一段。带空格的路径一起收进来
 * （我们的工作区目录名 `Codex Harness Desktop-refactor` 就带空格）。
 */
export function commandTarget(command, max = 48) {
  const text = stripShellLauncher(command);
  if (!text) return "";
  // ⛔ 盘符前缀必须**紧跟着分隔符**（`D:\` / `D:/`）：写成 `[A-Za-z]:` 时，URL 里的
  //    `https://…` 会被当成 `s:` 盘符，摘要变成「运行 s://api.pptoken.org」（真机实测到的笑话）。
  //   ⛔ 盘符只吃 `D:`、分隔符留给后面的分组（写成 `D:\` 会把那个 `\` 吃掉，
  //      于是带空格的路径 `D:\Codex Harness…` 匹配不到 —— 实测）。
  // ⛔ 扩展名字符集必须含 `-` 且加**尾部负向断言**（09-24 真机：`.codex-harness` 被截成
  //    `.codex` —— 扩展名遇 `-` 就停，界面上是半截路径；负向断言防在同一 token 中间匹配）。
  // ⛔ 路径各段必须允许**中文**（09-24 实测：`markitdown D:/x/报告.pdf` 取不到目标 ——
  //    段字符集只有 ASCII，中文文件名整段失配，技能/命令"怎么用的"就只剩技能名）。
  //   ⛔ 续段必须**允许空格**（09-24：写成单一字符集时 `Codex Harness Desktop-refactor` 断在
  //      空格处 ⇒ 匹配从后半段开始，盘符和前两段全丢，只剩 `Desktop-refactor/src/App.tsx`）。
  const SEG = "[A-Za-z0-9_.@%~+\\u4e00-\\u9fff-]";
  const SEGP = "[A-Za-z0-9_.@%~+\\u4e00-\\u9fff -]";
  const matches = text.match(new RegExp(`(?:[A-Za-z]:(?=[\\\\/]))?${SEG}*(?:[\\\\/]${SEGP}*)*\\.[A-Za-z0-9][A-Za-z0-9_-]{0,11}(?![A-Za-z0-9_-])`, "g")) ?? [];
  for (const raw of matches) {
    const candidate = raw.trim();
    // 形如 `1.seg` 这种"小数/版本号"排除：必须真的带分隔符
    if (!/[\\/]/.test(candidate)) continue;
    // ⛔ URL 不是文件目标（`https://a.b.org/v1/x.json` ⇒ 摘要退回「运行命令」）
    if (/\w+:\/\//.test(candidate)) continue;
    return shortenPath(candidate, max);
  }
  return "";
}

/**
 * 路径的展示形态：统一成正斜杠，**超长时从左边截**（保尾 ⇒ 文件名永远可见）。
 * 例：`D:\a\src\features\app-state\parts\part09\01-seg.tsx` → `…/features/app-state/parts/part09/01-seg.tsx`
 */
export function shortenPath(value, max = 48) {
  // ⛔ 多分隔符要压缩（09-24 真机截图：`D://Codex Harness Desktop-refactor//.codex` —— 脚本里
  //   写的是 `D://…//` 这种双斜杠，直接归一成正斜杠会把这些双斜杠原样带到界面上）。
  const normalized = String(value ?? "").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (normalized.length <= max) return normalized;
  const parts = normalized.split("/").filter(Boolean);
  let tail = "";
  for (let index = parts.length - 1; index >= 0; index--) {
    const next = `/${parts[index]}${tail}`;
    if (next.length + 1 > max) break;
    tail = next;
  }
  return tail ? `…${tail}` : `…${normalized.slice(-max)}`;
}

/** 明细行（`.cmd-command`）用的单行命令：剥壳 + 压空白 + 超长保头截断。 */
export function displayCommand(command, max = 160) {
  const text = stripShellLauncher(command).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/* ── 命令的**二级意图**（09-23 用户：「正文中间怎么全是运行命令，编辑文件、读取、检索没有嘛」）──
 * Codex 引擎里读文件 / 搜代码 / 改文件大多也走 shell 命令（Get-Content / Select-String /
 * apply_patch / node -e writeFileSync…），而 foldAtomOf 原本把 commandExecution 一律标成
 * 「运行命令」⇒ 芯片标题清一色同义词。这里从**命令内容**里认出它真正在干什么，
 * 让折叠摘要拆成 修改/定位/查看/运行 四档。认不出 ⇒ 照旧 "command"（绝不硬猜）。
 * ⛔ 判据是**词法**的（只看命令字面），不做任何执行/解析 —— 与本文件其余纯函数同一纪律。 */

const INTENT_ORDER = [
  /** 修改（写/删/改文件）—— 放最前：一条命令又读又写时，效果以写为准 */
  [
    "modify",
    /apply_patch|Set-Content|Add-Content|Out-File|WriteAllText|WriteAllLines|WriteAllBytes|writeFileSync|appendFileSync|copyFileSync|renameSync|rmSync|mkdirSync|unlinkSync|mkdtempSync|Remove-Item|Rename-Item|Move-Item|New-Item|\[IO\.File\]::Write|\bsed\s+(?:-\w+\s+)*-i\b|\bgit\s+rm\b|\bdel\s+\/|\brm\s+(?:-r?f?\s+)["'.\/\w]/i,
  ],
  /** 定位/检索（搜内容、列目录找东西） */
  [
    "search",
    /Select-String|findstr|\bgrep\b|\brg\b|\bfind\s+(?:\.|[^-])|Glob\b|Get-ChildItem(?:\s+-Recurse)|\bwhere\.exe\b|\bwhich\b/i,
  ],
  /** 查看（读文件、看目录、探状态） */
  [
    "read",
    /Get-Content|ReadAllText|ReadAllLines|readFileSync|\bcat\b|\bhead\b|\btail\b|\btype\s+\S|Test-Path|Get-Item\b|Get-ChildItem|Get-FileHash|\bwc\s+-l\b|\bdir\b|\bls\b/i,
  ],
] /** @type {Array<[string, RegExp]>} */

/**
 * 从命令字面认出意图档位：`"modify" | "search" | "read" | "command"`。
 * 顺序即优先级：modify > search > read > command（又读又写的命令按效果归 modify）。
 * @param {string} command 引擎给的 `item.command`（带不带启动器外壳都行）
 * @returns {string}
 */
export function commandIntentOf(command) {
  const text = stripShellLauncher(command);
  if (!text) return "command";
  for (const [intent, pattern] of INTENT_ORDER) {
    if (pattern.test(text)) return intent;
  }
  return "command";
}

/**
 * 命令的「用途标签」：从脚本里提炼**在做什么**，用于命令行卡片的表头
 * （09-24 用户附截图：「这个还是显示已运行没有显示具体的真实映射」—— 卡片只有
 * 「已运行 + 一大段脚本原文」，看不出目的）。
 *
 * 判据（都是字面级，不执行任何东西）：
 *  ① 先丢掉变量赋值段（`$ws='D:\…';` —— 值通常是路径，不是"在做什么"）；
 *  ② 优先取含中日韩文字的字符串字面量 —— 脚本里的输出标签就是作者自己写的用途
 *     （真机例：`"=== 结构 ==="` → 「结构」、`"=== 捕获链日志（末 8 行）==="` → 「捕获链日志（末 8 行）」）；
 *  ③ 退而取第一个"像话"的字面量（非路径、非裸开关、≥2 字符）；
 *  ④ 都没有就返回空串 —— 调用方退回 `displayCommand` 截断展示，绝不硬编一个假标签。
 * @param {string} command 引擎给的 `item.command`
 * @param {number} [max] 标签长度上限（默认 40）
 * @returns {string}
 */
export function commandPurpose(command, max = 40) {
  const text = stripShellLauncher(command);
  if (!text) return "";
  const withoutAssign = text.replace(/\$[\w:.]+\s*=\s*(?:"[^"\n]*"|'[^'\n]*')\s*;?/g, " ");
  const literals = [...withoutAssign.matchAll(/"([^"\n]{2,60})"|'([^'\n]{2,60})'/g)].map((m) => m[1] ?? m[2] ?? "");
  const cjk = literals.find((value) => /[\u3400-\u9fff]/.test(value));
  const pick = cjk
    ?? literals.find((value) => !/[\\/]/.test(value) && !value.trim().startsWith("-") && value.trim().length >= 2);
  if (!pick) return "";
  const cleaned = pick.replace(/^[=\-*#\s]+|[=\-*#\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/** 意图 → 中文动词（命令行卡片的表头动词；`command` 档保持原样「运行」）。 */
export const INTENT_VERB = { read: "查看", search: "定位", modify: "编辑", command: "运行" };
