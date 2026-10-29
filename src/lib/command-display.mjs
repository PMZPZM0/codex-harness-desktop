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
  if (!SHELL_NAMES.test(basename(token))) {
    // ⛔ 整条命令被一层引号包住（引擎偶尔这么记）⇒ 脱掉再处理：否则 action/purpose 会把
    //   整段脚本当成一个"字符串字面量"（实测表头直接显示整段脚本）。
    //   ⛔ 只脱**真正包住整条命令**的那层：`'a' + 'b'` 这种表达式首尾也是引号，脱了就改写原意。
    const q = original[0];
    if ((q === '"' || q === "'") && original.length > 2 && original.endsWith(q)) {
      const inner = unwrapQuotes(original);
      if (inner && inner !== original && !inner.includes(q)) return stripShellLauncher(inner);
    }
    return original;
  }
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
 */export function shortenPath(value, max = 48) {
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
  const literals = [...withoutAssign.matchAll(/"([^"\n]{2,60})"|'([^'\n]{2,60})'/g)]
    .map((m) => m[1] ?? m[2] ?? "")
    // ⛔ 整条脚本被一层引号包住时，**外层引号**会被当成一个"字面量"（实测：表头变成整段脚本）。
    //   ⇒ 含引号 / 语句分隔 / 插值的候选一律不当用途标签，继续找里面真正的标签字面量。
    .filter((value) => !/["'`]/.test(value) && !/[;|]|\$\(|\$\{/.test(value));
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

/* ── 命令的**动作短语**（10-21 新增，参照 WorkBuddy 的工具标题形态）────────────────────
 * WorkBuddy 的命令卡表头是**一句人话**（「加静音同步断言并跑守卫」「写增量同步脚本」），
 * 命令原文只在小字/展开里。本项目的表头此前是「动词 + 用途/目标」（「已运行 npm run check」），
 * 差的是**动作短语**这一层：看得出"在操作什么"，但看不出"这一步在干什么"。
 *
 * ⛔ 语义来源的限制（必须写清楚，别指望它能变成 WorkBuddy 那样精准）：
 *   WorkBuddy 那句标题是**模型在工具调用时给的 description**（LLM 生成，所以能写「为什么」）；
 *   本项目拿到的只有引擎的 `command` 字面（引擎的 commandExecution 不带 action/description），
 *   所以这一层只能是**模式识别**：规则覆盖本仓高频命令，认不出就返回空串。
 *   ⇒ 认不出时调用方退回原有 hint（用途 · 目标 / 剥壳命令），**绝不编一个假动作**。
 *
 * ⛔ 与 `commandPurpose` 的分工：purpose = 从**脚本输出标签**提炼的用途（数据驱动）；
 *   action = 从**命令模式**认出的动作（模式驱动）。有 action 优先 action（更贴"在干什么"）。
 */

/** 路径末段（去掉引号与目录） */
function actName(value) {
  return String(value ?? "").replace(/^["']|["']$/g, "").split(/[\\/]/).pop() || "";
}

/** 去掉扩展名 */
function actStem(value) {
  return actName(value).replace(/\.(?:mjs|cjs|js|ts|tsx)$/i, "");
}

/** 常见脚本名 → 动作（本仓脚本的语义映射；认不出就「跑脚本 <名>」） */
function scriptAction(target) {
  const name = actStem(target);
  if (!name) return "";
  if (/^11[a-z0-9]*-/.test(name)) return `跑守卫 ${name.split("-")[0]}`;
  if (/^check-(?:preflight|bag-types|dead-imports|require-paths)$/.test(name)) return "跑检查";
  if (/^gen-/.test(name)) return "重生成产物";
  if (/^(?:accept|e2e)/.test(name)) return "跑界面验收";
  const short = name.length > 18 ? `${name.slice(0, 18)}…` : name;
  return `跑脚本 ${short}`;
}

/**
 * 单条命令 → 动作短语（不含复合拆分）。命中即返回，认不出返回空串。
 * ⛔ 规则顺序即优先级：越具体越靠前（`scripts/guards/x.mjs` 要先于通用 `node <脚本>`）。
 */
const ACTION_RULES = [
  // 本仓守卫 / 预检 / 验收（最具体，必须排在通用 node 之前）
  [/scripts[\\/]guards[\\/]([\w.-]+)\.mjs/i, (m) => `跑守卫 ${String(m[1]).split("-")[0]}`],
  [/scripts[\\/]check-preflight\.mjs/i, () => "跑预检"],
  [/scripts[\\/]accept\.mjs/i, () => "跑界面验收"],
  [/scripts[\\/]deploy-cloud-ui\.mjs/i, () => "部署云端界面"],
  [/scripts[\\/]logs\.mjs\s+new/i, () => "记结论档案"],
  [/scripts[\\/]logs\.mjs\s+reindex/i, () => "重建日志索引"],
  [/scripts[\\/]logs\.mjs\s+(?:verify|dedupe)/i, () => "校验日志库"],
  // npm scripts（先具体后通用）
  [/npm\s+run\s+check\b/i, () => "跑全量检查"],
  [/npm\s+run\s+lint\b/i, () => "跑 lint"],
  [/npm\s+run\s+build:electron/i, () => "构建主进程"],
  [/npm\s+run\s+build:vite/i, () => "构建界面"],
  [/npm\s+run\s+build\b/i, () => "构建"],
  [/npm\s+run\s+gen:/i, () => "重生成产物"],
  [/\bnpm\s+test\b|\bnpm\s+run\s+test\b/i, () => "跑测试"],
  [/npm\s+run\s+([\w:.-]+)/i, (m) => `跑 ${m[1]}`],
  [/\bnpm\s+(?:install|ci|i)\b/i, () => "装依赖"],
  // node 脚本
  [/\bnode\s+(?:--experimental-strip-types\s+|--no-warnings\s+)*(?:"([^"]+)"|'([^']+)'|(\S+))/i,
    (m) => {
      const target = m[1] ?? m[2] ?? m[3] ?? "";
      // ⛔ 裸开关不是脚本名（实测：`node --version` 显示成「跑脚本 --version」）——
      //   交给后面的通用子命令（→「看 node 版本」）或原文兜底。
      return target.startsWith("-") ? "" : scriptAction(target);
    }],
  // git
  [/\bgit\s+commit\b/i, () => "提交改动"],
  [/\bgit\s+push\b/i, () => "推送远端"],
  [/\bgit\s+status\b/i, () => "看改动状态"],
  [/\bgit\s+diff\b/i, () => "看改动差异"],
  [/\bgit\s+log\b/i, () => "看提交历史"],
  [/\bgit\s+tag\b/i, () => "打版本标签"],
  [/\bgit\s+apply\b/i, () => "应用补丁"],
  [/\bgit\s+(?:checkout|restore)\b/i, () => "恢复文件"],
  [/\bgit\s+add\b/i, () => "暂存改动"],
  [/\bgit\s+(?:clone|fetch|pull)\b/i, () => "同步仓库"],
  [/\bgit\s+branch\b/i, () => "看分支"],
  // 写文件（heredoc / 覆盖写）
  [/(?:cat|tee)\s*>+\s*(?:"([^"]+)"|'([^']+)'|(\S+))/i, (m) => `写文件 ${actName(m[1] ?? m[2] ?? m[3]) || ""}`.trim()],
  [/Set-Content|Out-File|WriteAllText|WriteAllLines|WriteAllBytes|writeFileSync|appendFileSync/i, () => "写文件"],
  // node 内联脚本（`node -e …`）：排在写文件之后 —— 内联代码里写文件时上面已判成「写文件」
  [/\bnode\s+(?:-e|--eval|-p|--print)\b/i, () => "跑 node 脚本"],
  // 读文件：带上文件名（实测「已查看 Get-Content -LiteralPath "…config.toml"」看不出在读什么）
  [/(?:Get-Content|ReadAllText|ReadAllLines|readFileSync)\b(?:\s+-\w+)*\s+["']?([^"'\s|;<>]+)/i,
    (m) => { const name = actName(m[1]); return name ? `读文件 ${name}` : "读文件"; }],
  [/\bcat\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i,
    (m) => { const name = actName(m[1] ?? m[2] ?? m[3]); return name ? `读文件 ${name}` : ""; }],
  // 列目录（实测 `dir` 只剩「已查看 dir」）
  [/^(?:dir|ls|Get-ChildItem)\b/i, () => "看目录内容"],
  // 增删移拷
  [/Remove-Item[^|\n]*-Recurse|\brm\s+-r|\brm\s+-rf/i, () => "删目录"],
  [/Remove-Item\b|\brm\s+/i, () => "删文件"],
  [/Move-Item\b|\bmv\s+/i, () => "移动文件"],
  [/Copy-Item\b|\bcp\s+/i, () => "复制文件"],
  [/New-Item[^|\n]*-ItemType\s+Directory|\bmkdir\b/i, () => "建目录"],
  // 网络 / 远程
  [/\bcurl\b|Invoke-WebRequest|Invoke-RestMethod/i, () => "请求接口"],
  [/\bscp\b/i, () => "上传文件"],
  [/\bssh\b/i, () => "远程执行"],
];

/** 通用 CLI 的子命令 → 中文短语（10-29 用户：「把运行命令映射成这种中文展示，改条命令是干嘛的」）。
 *  ⛔ 只看**前几个 token**（argv 段），不扫整段脚本：脚本里 status 作为变量名/路径很常见，
 *     扫全量会误判语义。认不出返回空串，调用方继续走「命令原文」兜底。 */
const CLI_SUBCOMMANDS = [
  [/^(?:status|health|doctor|ping)$/i, (b) => (b ? `看 ${b} 状态` : "看状态")],
  [/^(?:config|settings|profile|conf)$/i, (b) => (b ? `看 ${b} 配置` : "看配置")],
  [/^(?:login|signin|sign-in)$/i, (b) => (b ? `${b} 登录` : "登录")],
  [/^(?:logout|signout|sign-out)$/i, (b) => (b ? `${b} 退出登录` : "退出登录")],
  [/^(?:auth|authorize|token)$/i, (b) => (b ? `${b} 鉴权` : "鉴权")],
  [/^(?:list|ls|dir)$/i, (b) => (b ? `列 ${b} 清单` : "列清单")],
  [/^(?:version|-v|--version)$/i, (b) => (b ? `看 ${b} 版本` : "看版本")],
  [/^(?:help|-h|--help)$/i, (b) => (b ? `看 ${b} 帮助` : "看帮助")],
  [/^(?:install|add)$/i, (b) => (b ? `装 ${b}` : "安装")],
  [/^(?:uninstall|remove)$/i, (b) => (b ? `卸 ${b}` : "卸载")],
  [/^(?:update|upgrade)$/i, (b) => (b ? `更新 ${b}` : "更新")],
  [/^(?:test|spec)$/i, (b) => (b ? `跑 ${b} 测试` : "跑测试")],
  [/^(?:build|compile)$/i, (b) => (b ? `构建 ${b}` : "构建")],
  [/^(?:dev|serve|start)$/i, (b) => (b ? `起 ${b} 服务` : "起服务")],
  [/^(?:deploy|publish)$/i, (b) => (b ? `发布 ${b}` : "发布")],
];

function genericCliAction(body) {
  const tokens = String(body).split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  let bin = "";
  let start = 0;
  for (let i = 0; i < tokens.length && i < 4; i++) {
    const t = tokens[i].replace(/^["']|["']$/g, "");
    if (!t || t.startsWith("-")) continue;
    if (/[\\/]/.test(t) && !/\.(?:exe|cmd|bat)$/i.test(t)) continue;
    bin = (t.split(/[\\/]/).pop() || "").replace(/\.(?:exe|cmd|bat)$/i, "").replace(/^feishu-?cli$/i, "飞书CLI");
    start = i + 1;
    break;
  }
  if (!bin) return "";
  for (let i = start; i < tokens.length && i < start + 4; i++) {
    const token = tokens[i].replace(/^["']|["']$/g, "");
    if (!token || /[\\/]/.test(token)) break;
    for (const [re, make] of CLI_SUBCOMMANDS) {
      if (re.test(token)) {
        const phrase = String(make(bin) ?? "").trim();
        if (phrase) return phrase;
      }
    }
  }
  return "";
}

/** 单段命令求动作（内部用，不做复合拆分） */
function actionOfOne(text) {
  const body = stripShellLauncher(text);
  if (!body) return "";
  for (const [pattern, make] of ACTION_RULES) {
    const hit = pattern.exec(body);
    if (hit) {
      const value = String(make(hit) ?? "").trim();
      if (value) return value;
    }
  }
  /* 规则表没命中（任意第三方 CLI，如 feishu auth status）⇒ 按 argv 子命令给一句中文。
     ⛔ 认不出仍然返回空串：调用方显示「已运行 + 剥壳命令原文」，绝不编一个假动作。 */
  return genericCliAction(body);
}

/** 只在引号外拆 `&&` / `;`（⛔ 不能裸 split：`node -e "a;b"` 会被拆成两段，
 *  拼出「跑 node 脚本并写文件」这种把一段代码当两步的说法）*/
function splitTopLevel(text) {
  const parts = [];
  let buf = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      else if (ch === "\\" && quote === '"' && i + 1 < text.length) buf += text[++i];
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === ";") { parts.push(buf); buf = ""; continue; }
    if (ch === "&" && text[i + 1] === "&") { parts.push(buf); buf = ""; i++; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * 命令 → **动作短语**（≤ max 字，命令卡表头的标题）。
 *
 * 复合命令（`a && b`、`a; b`）拆开各自求动作，两个都认得出时拼成「A并B」
 * （本仓最常见的形态：`npm run build && npm run check` → 「构建并跑全量检查」）。
 *
 * @param {string} command 引擎给的 `item.command`（可带 shell 启动器外壳）
 * @param {number} [max] 短语长度上限（默认 24）
 * @returns {string} 认不出返回空串（调用方退回原 hint，绝不显示假动作）
 */
export function commandAction(command, max = 24) {
  const text = stripShellLauncher(command);
  if (!text) return "";
  // 复合拆分：只拆 `&&` / `;`（⛔ 不拆 `|` 管道 —— 它是同一条处理链，拆开语义就错了；
  // ⛔ 也不拆引号里的 —— `node -e "a;b"` 是一段代码，不是两步命令）
  const parts = splitTopLevel(text);
  const actions = [];
  for (const part of parts.slice(0, 3)) {
    const action = actionOfOne(part);
    if (action && !actions.includes(action)) actions.push(action);
    if (actions.length >= 2) break;
  }
  let out = "";
  if (actions.length === 1) out = actions[0];
  else if (actions.length >= 2) {
    const joined = `${actions[0]}并${actions[1]}`;
    // 拼完太长就只留第一个动作（表头是一行，宁可少说也不挤）
    out = joined.length <= max ? joined : actions[0];
  } else {
    out = actionOfOne(text);
  }
  if (!out) return "";
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/**
 * 写文件类命令的**行数统计**（10-29 用户令：「编辑文件 / 修改文件 / 生成文件，只要动了文件
 * 后面都要加 +N -M」）。
 *
 * ⛔⛔ 只给**数得出来**的数字：
 *   · `added` = 这条命令**写入的内容行数**（heredoc / here-string / 数组字面量逐条数；
 *     实在认不出就按 1 行算 —— 一次 `Set-Content` 至少写了一行）；
 *   · `deleted` = 只有能确定时才给：追加（`-Append` / `>>`）确定是 0；
 *     **覆盖写一律返回 null**（旧文件原来有多少行，命令执行后就无从得知，历史会话更不可能回读）。
 *     ⛔ 不编 `-0` —— 假数字比没有数字更糟（用户会拿它判断"改了多少"）。
 * 返回 null = 这条命令不写文件（调用方不渲染统计）。
 * @param {string} command 引擎给的命令字面（带不带 shell 启动器外壳都行）
 * @returns {{ added: number, deleted: number | null } | null}
 */
export function commandWriteStats(command) {
  const text = stripShellLauncher(command);
  if (!text) return null;
  /* 写文件的判据与 commandIntentOf 的 "modify" 同源，但**不含** `mkdir` / `Remove-Item` /
     `Rename-Item` 这类不产生行数的动作（给它们标 +1 就是编）。 */
  const writes = /Set-Content|Out-File|Add-Content|WriteAllText|WriteAllLines|WriteAllBytes|writeFileSync|appendFileSync|\btee\b|(?<![0-9=<>])>(?![>&])/i.test(text);
  if (!writes) return null;

  let added = 0;
  // bash heredoc：`cat > f <<'EOF' … EOF`
  const heredoc = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?\r?\n([\s\S]*?)\r?\n\s*\1/.exec(text);
  if (heredoc) added = heredoc[2].split(/\r?\n/).filter((line) => line.trim()).length;
  // PowerShell here-string：`@" … "@` / `@' … '@`
  if (!added) {
    const here = /@["']\r?\n([\s\S]*?)\r?\n["']@/.exec(text);
    if (here) added = here[1].split(/\r?\n/).filter((line) => line.trim()).length;
  }
  // 数组字面量：`@('a','b')` / `('a','b')`（本仓最常见的多行写入形态）
  if (!added) {
    const arr = /@\(([\s\S]*?)\)/.exec(text);
    if (arr) added = (arr[1].match(/'[^']*'|"[^"]*"/g) ?? []).length;
  }
  if (!added) added = 1;

  /* 追加写的三种形态：PowerShell `-Append`、shell `>>`、以及自带追加语义的 API
     （`Add-Content` / `appendFileSync`）—— 追加不会删任何东西，所以 deleted 能确定是 0。 */
  const appended = /-Append\b|>>|Add-Content|appendFileSync/i.test(text);
  return { added: Math.max(1, added), deleted: appended ? 0 : null };
}

/**
 * 这条命令自己 `cd` 到哪儿了。
 *
 * ⛔⛔ 10-30 用户实测（截图 + rollout 双重证据）：会话 cwd 是 `D:/测试`，模型却在命令里
 * `cd 'D:/Codex Harness Desktop'; $f = '.\src\lib\command-display.mjs'; …` ⇒ 卡片把这条**相对**
 * 路径按**会话目录**拼成 `D:/测试/src/lib/command-display.mjs`，点开就是「文件不存在或不可读」。
 * 文件其实在 `D:/Codex Harness Desktop\src\lib\`。⇒ 相对路径必须以**命令自己的 cd 目录**为基准。
 *
 * 只认**绝对路径**的 cd：`cd ..` / `cd src` 推不出真目录，返回 "" （宁可退回旧行为，也不猜）。
 * 只看命令**开头**那一段：`; cmd1; cd B; cmd2` 里的 cd B 属于后续步骤，拿它当基准会张冠李戴。
 * @param {string} command
 * @returns {string} 绝对目录；推不出来返回 ""
 */
export function commandWorkdir(command) {
  const text = stripShellLauncher(command);
  if (!text) return "";
  const hit = text.match(/^\s*(?:cd|chdir|set-location|sl|pushd)\s+(?:-path\s+|--\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/i);
  const dir = String(hit?.[1] ?? hit?.[2] ?? hit?.[3] ?? "").trim().replace(/^["']|["']$/g, "");
  // 绝对路径：盘符 / UNC / 根斜杠。其余（含 `..`、`src`）一律不认。
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(dir) ? dir : "";
}

/**
 * 命令里的相对目标 → 绝对路径（用**命令自己的 cd 目录**，不是会话目录）。
 * 已是绝对路径、或命令没 cd、或路径含 `..`（可能逃出 cd 目录）时原样返回，交给下游兜底。
 * @param {string} command
 * @param {string} target
 * @returns {string}
 */
export function resolveCommandTarget(command, target) {
  const raw = String(target ?? "").trim();
  if (!raw) return raw;
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(raw)) return raw;
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(raw)) return raw;
  const dir = commandWorkdir(command);
  if (!dir) return raw;
  const base = dir.replace(/[\\/]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  const rel = raw.replace(/^\.\.[\\/]/, "").replace(/^\.\//, "").replace(/^\.\\/, "").replace(/^[\\/]+/, "");
  if (!rel) return raw;
  return `${base}${sep}${rel.replace(/[\\/]+/g, sep)}`;
}
