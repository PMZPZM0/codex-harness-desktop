/**
 * cli-agents —— 「CLI 智能体」的数据层（10-29 用户令）。
 *
 * 用户原话：「在开发工具界面新增一个「CLI 智能体」模块，用于统一管理和接入各类 CLI 工具，
 *   支持安装 Claude CLI、OpenClaw CLI、Harness CLI 及其他主流 CLI。要求按类型对已接入的 CLI
 *   进行分类管理，并提供搜索功能…同时将该 CLI 接入到「@」调用体系中，使其与子智能体、专家、
 *   专家团保持一致，可通过 @ 直接调用」。
 *
 * 本文件只做四件事：**内置预置表 · 用户态合并 · 规范化 · 安装检测**。
 *   · 分类口径（三档，可扩展）：coding 编码 CLI / agent 通用智能体 CLI / custom 自建·其他。
 *   · 落盘：`<userData>/cli-agents.json`（只存"用户改过的那部分"，内置表在代码里 ⇒ 升级应用
 *     能带上新预置，同时保留用户对每个条目的启停/改名/命令改动）。
 *   · 检测：`where`（Windows）/ `which`（*nix）看可执行是否在 PATH 上，再尽力取 `--version`。
 *
 * ⛔⛔ **不假装能一键安装**：`installCmd` 只写**核实过的**官方安装命令，核实不了的一律留空并在
 *   界面上说明「按官方文档安装」。绝不编包名 —— 用户复制一条装不上的命令，比不给命令更糟
 *   （本仓纪律：「注释/文案声称的能力」是最危险的假象）。
 * ⛔ 检测失败 = 「未检测到」，不是错误；`--version` 取不到也照常返回 installed=true（PATH 上有就算装了）。
 * ⛔ 模块顶层**不碰 app.getPath**（10-03 事故：被 import 的模块体早于 main.ts 的 setPath 执行，
 *   路径会静默漂移到默认 userData）⇒ 一律在函数内取。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { augmentedPath } from "./toolchain";

/**
 * 子进程用的 PATH。
 *
 * ⛔⛔ mac 适配（10-30 审计）：GUI 进程的 PATH 是**精简的**（darwin 上通常只有
 *   `/usr/bin:/bin:/usr/sbin:/sbin`，没有 `/opt/homebrew/bin`、`~/.npm-global/bin`、nvm 的 bin）。
 *   而 CLI 智能体几乎都装在那些目录里 ⇒ 直接继承 `process.env.PATH` 的话：
 *     · `which claude` 找不到 ⇒ 面板整列显示「未检测到」（装得好好的）；
 *     · `sh -c "claude -p …"` 报 command not found ⇒ 派活必失败。
 *   症状极隐蔽（不报错，只是"没装"），所以**检测与执行必须用同一条增强 PATH**。
 *   `augmentedPath()` 已带 mac 的 homebrew / 随包 node/bin / npm-global，Windows 侧也兼容。
 */
export function cliProcessEnv(): NodeJS.ProcessEnv {
  try { return { ...process.env, PATH: augmentedPath() }; } catch { return process.env; }
}

/** 分类（顺序即界面顺序）。⛔ 渲染层不复制这份字面量 —— 经 `cliagents:list` 一起下发。 */
export const CLI_CATEGORIES = [
  { key: "coding", label: "编码 CLI", hint: "已有代码库上改代码、跑测试、审 PR" },
  { key: "agent", label: "通用智能体 CLI", hint: "能自己拆任务、调工具、跨应用干活" },
  { key: "custom", label: "自建 / 其他", hint: "你们自己的命令行入口，或有自己分发方式的工具" },
] as const;

export type CliAgentCategory = (typeof CLI_CATEGORIES)[number]["key"];

export type CliAgentDef = {
  id: string;
  name: string;
  category: CliAgentCategory;
  /** PATH 上的可执行名（检测与派活提示都用它） */
  bin: string;
  /** 官方安装命令；核实不到的留空串（界面会改成「按官方文档安装」） */
  installCmd: string;
  /**
   * mac 专用安装命令（可空）。
   * ⛔ 只在「同一条命令在 mac 上确实跑不通」时才写：例如 pip 系（mac 上多数环境只有
   *   pip3 / python3 -m pip，裸 `pip` 常是 command not found）。读取时按平台替换成
   *   installCmd，界面与复制按钮都拿不到这条 —— 用户不需要知道有两份。
   */
  installCmdMac: string;
  /** 官方文档 / 仓库地址（可空） */
  docs: string;
  /** 一句话用途（面板副标题 + @ 候选说明） */
  description: string;
  /** 派活时追加给模型的「怎么用它」提示（可空 ⇒ 只用 description） */
  promptHint: string;
  /** 是否允许调度（默认 true —— 与专家 / 子智能体一致：默认可用，可单独关掉） */
  enabled: boolean;
  /** 内置预置（不可删除，可关停 / 改名 / 改命令） */
  builtin: boolean;
  createdAt: number;
};

/**
 * 内置预置表。
 * ⛔ installCmd 每条都必须核实过官方来源；核实不了的写空串。
 *   - Claude Code：`@anthropic-ai/claude-code`（Anthropic 官方 npm 包）
 *   - Codex CLI：`@openai/codex`（本应用自己就依赖它，包名确定）
 *   - OpenClaw：官方站点安装页写明 `npm i -g openclaw` / `openclaw onboard`
 *   - Gemini CLI：`@google/gemini-cli`
 *   - Aider：PyPI `aider-chat`
 *   - Harness CLI：**本项目/内部分发，没有公开包名 ⇒ 留空**，让用户填自己的可执行名
 */
const BUILTIN_CLI_AGENTS: CliAgentDef[] = [
  {
    id: "builtin-claude-code",
    name: "Claude Code",
    category: "coding",
    bin: "claude",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    installCmdMac: "",
    docs: "https://docs.anthropic.com/en/docs/claude-code",
    description: "Anthropic 官方编码 CLI：读仓库、改代码、跑测试、按任务收口",
    promptHint: "先 `claude -p \"<任务>\"` 跑非交互单轮；需要多轮改代码时用 `claude -p --permission-mode acceptEdits`。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-codex-cli",
    name: "Codex CLI",
    category: "coding",
    bin: "codex",
    installCmd: "npm install -g @openai/codex",
    installCmdMac: "",
    docs: "https://github.com/openai/codex",
    description: "OpenAI 官方编码 CLI：本应用引擎同源，适合在终端里跑一轮独立任务",
    promptHint: "用 `codex exec \"<任务>\"` 跑一次性任务（非交互）；需要只读分析时加 `--sandbox read-only`。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-gemini-cli",
    name: "Gemini CLI",
    category: "coding",
    bin: "gemini",
    installCmd: "npm install -g @google/gemini-cli",
    installCmdMac: "",
    docs: "https://github.com/google-gemini/gemini-cli",
    description: "Google 官方 CLI：长上下文读大仓库、批量分析",
    promptHint: "非交互用 `gemini -p \"<任务>\"`；需要指定目录时在 cwd 里跑。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-aider",
    name: "Aider",
    category: "coding",
    bin: "aider",
    installCmd: "pip install aider-chat",
    installCmdMac: "python3 -m pip install aider-chat",
    docs: "https://aider.chat",
    description: "开源的结对编程 CLI：按文件粒度改代码并自动提交",
    promptHint: "用 `aider --message \"<任务>\" --yes <文件…>` 跑一轮；它默认会 git commit，注意先确认分支。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-openclaw",
    name: "OpenClaw",
    category: "agent",
    bin: "openclaw",
    installCmd: "npm install -g openclaw",
    installCmdMac: "",
    docs: "https://openclaw.ai/install",
    description: "开源个人智能体 CLI：自带网关与多渠道接入，能干跨应用的事",
    promptHint: "先 `openclaw --help` 看清子命令；Windows 官方建议在 WSL2 里跑，装不上就如实回报。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-harness-cli",
    name: "Harness CLI",
    category: "custom",
    bin: "harness",
    installCmd: "",
    installCmdMac: "",
    docs: "",
    description: "自建 / 内部分发的命令行入口 —— 安装方式按你自己的分发，这里填可执行名即可",
    promptHint: "先 `<bin> --help` 摸清用法再动手；取不到帮助就如实回报「没有可用入口」，不要假装跑过。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  /* ── 国产 CLI 智能体（10-31 用户令：「cli 智能体太少了，国内还有很多，比如 qwenpaw，其它再找找」）──
     ⛔ installCmd 只写**已在官方来源核实过**的命令：
       · Qwen Code   = npm @qwen-code/qwen-code（qwen.ai 官方页 / 阿里云文档）
       · QwenPaw     = PyPI qwenpaw（AgentScope 官方 quickstart 的 pip 安装方式）
       · iFlow CLI   = npm @iflow-ai/iflow-cli（platform.iflow.cn 官方快速开始；bin=iflow）
       · Kimi Code   = npm @moonshot-ai/kimi-code（kimi.com 官方 help；bin=kimi）
       · CodeBuddy   = npm @tencent-ai/codebuddy-code（腾讯官方 cnb.cool 仓；bin=codebuddy）
       · Comate CLI  = npm @comate/comatecli（百度官方 npm 包；bin=comatecli）
       · Qoder CLI   = npm @qoder-ai/qodercli（qoder.com/cli 官方；bin=qoder）
       · Trae CLI    = **官方只提供安装脚本**，没有 npm/pip 全局包 ⇒ installCmd 留空、只给文档
         链接（一键安装只认 npm/pip，⛔ 不为它硬塞一条脚本命令）。 */
  {
    id: "builtin-qwen-code",
    name: "Qwen Code",
    category: "coding",
    bin: "qwen",
    installCmd: "npm install -g @qwen-code/qwen-code@latest",
    installCmdMac: "",
    docs: "https://qwen.ai/qwencode",
    description: "阿里通义千问官方终端编码智能体（Gemini CLI 同源）：长上下文读大仓库、改代码、跑测试，国内模型开箱可用",
    promptHint: "非交互用 `qwen -p \"<任务>\"`；首次在项目目录跑一次 `qwen` 走它的登录/`/auth` 流程。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-qwenpaw",
    name: "QwenPaw",
    category: "agent",
    bin: "qwenpaw",
    installCmd: "pip install qwenpaw",
    installCmdMac: "python3 -m pip install qwenpaw",
    docs: "https://qwenpaw.agentscope.io/docs/quickstart/",
    description: "AgentScope 团队开源的国产个人 AI 助手（原 CoPaw）：带技能 / 插件 / 多渠道，本地或云端都能跑",
    promptHint: "先 `qwenpaw --help` 摸清子命令；首次 `qwenpaw init --defaults` 初始化，`qwenpaw app` 起控制台。没有能直接跑单轮的子命令时如实回报，不要假装跑过。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-iflow",
    name: "iFlow CLI",
    category: "coding",
    bin: "iflow",
    installCmd: "npm install -g @iflow-ai/iflow-cli@latest",
    installCmdMac: "",
    docs: "https://platform.iflow.cn/cli/quickstart",
    description: "阿里心流 AI 的免费终端编码智能体（Gemini CLI 同源），国内模型开箱可用",
    promptHint: "非交互用 `iflow -p \"<任务>\"`；登录与模型选择在它的 `/auth` 里配置。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-kimi-code",
    name: "Kimi Code CLI",
    category: "coding",
    bin: "kimi",
    installCmd: "npm install -g @moonshot-ai/kimi-code",
    installCmdMac: "",
    docs: "https://www.kimi.com/help/kimi-code/cli-getting-started",
    description: "月之暗面 Kimi 官方终端编码智能体：长上下文读大仓库、按任务改代码",
    promptHint: "先 `kimi --help` 看非交互参数（`-p` 可跑单轮）；首次要按它自己的登录流程授权。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-codebuddy",
    name: "CodeBuddy Code",
    category: "coding",
    bin: "codebuddy",
    installCmd: "npm install -g @tencent-ai/codebuddy-code",
    installCmdMac: "",
    docs: "https://cnb.cool/codebuddy/codebuddy-code",
    description: "腾讯 CodeBuddy 官方终端编码智能体：读仓库、改代码、跑命令（另带 `cbc` 别名）",
    promptHint: "`codebuddy --help` 看用法；登录按它自己的提示走。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-comate",
    name: "Comate CLI",
    category: "coding",
    bin: "comatecli",
    installCmd: "npm install -g @comate/comatecli",
    installCmdMac: "",
    docs: "https://www.npmjs.com/package/@comate/comatecli",
    description: "百度文心快码 Comate 的交互式终端编码助手",
    promptHint: "`comatecli --help` 看用法；登录与模型选择按它自己的提示走。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-qoder",
    name: "Qoder CLI",
    category: "coding",
    bin: "qoder",
    installCmd: "npm install -g @qoder-ai/qodercli",
    installCmdMac: "",
    docs: "https://qoder.com/cli",
    description: "Qoder 官方 CLI 编码助手：终端里读仓库、改代码、按任务交付",
    promptHint: "`qoder --help` 看用法；首次登录用它的 login 流程。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
  {
    id: "builtin-trae-cli",
    name: "Trae CLI",
    category: "coding",
    bin: "traecli",
    /* ⛔ 官方只给安装脚本（Mac/Linux 一段 sh），没有 npm/pip 全局包 ⇒ 一键安装执行端只认
       npm/pip，这里留空并由面板给「按官方文档安装」+ 文档链接（⛔ 不硬塞脚本命令）。 */
    installCmd: "",
    installCmdMac: "",
    docs: "https://docs.trae.cn/cli_get-started-with-trae-cli",
    description: "字节跳动 Trae CLI：终端编码智能体，可读写仓库、持久化跑命令",
    promptHint: "安装按官方文档（一键脚本，Windows 另有说明）；装完 `traecli --help` 看用法。",
    enabled: true,
    builtin: true,
    createdAt: 0,
  },
];

/** 可执行名的规范化：去掉路径与扩展名，只留命令名（检测与提示都用它）。 */
export function normalizeCliBin(input: unknown): string {
  const raw = String(input ?? "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.replace(/\.(exe|cmd|bat|ps1|sh)$/i, "").trim();
}

/** 一条记录的规范化（坏值一律回落安全默认；id 缺了就给一个稳定不了的新 id）。 */
export function normalizeCliAgent(input: unknown, opts?: { builtin?: boolean; createdAt?: number }): CliAgentDef {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const category = CLI_CATEGORIES.some((entry) => entry.key === src.category)
    ? (src.category as CliAgentCategory)
    : "custom";
  const name = String(src.name ?? "").trim().slice(0, 40) || normalizeCliBin(src.bin) || "未命名 CLI";
  return {
    id: String(src.id ?? "").trim() || `cli-${crypto.randomUUID().slice(0, 8)}`,
    name,
    category,
    bin: normalizeCliBin(src.bin ?? name),
    installCmd: String(src.installCmd ?? "").trim(),
    installCmdMac: String(src.installCmdMac ?? "").trim(),
    docs: String(src.docs ?? "").trim(),
    description: String(src.description ?? "").trim().slice(0, 160),
    promptHint: String(src.promptHint ?? "").trim().slice(0, 400),
    // ⛔ 缺省 true（默认可用）；只有显式 false 才算关掉 —— 与子智能体的 `!== false` 口径一致
    enabled: src.enabled !== false,
    builtin: opts?.builtin === true || src.builtin === true,
    createdAt: Number(src.createdAt ?? opts?.createdAt ?? Date.now()) || Date.now(),
  };
}

/**
 * 内置预置 + 用户态合并（**内置条目永远在**，用户改动覆盖其上）。
 * ⛔ 顺序 = 内置表顺序 + 用户自定义（按 createdAt）；面板再按分类分组，不依赖这里的分组。
 */
export function mergeCliAgents(builtin: CliAgentDef[], saved: unknown): CliAgentDef[] {
  const stored = (Array.isArray(saved) ? saved : []).map((entry) => normalizeCliAgent(entry));
  const byId = new Map(stored.map((entry) => [entry.id, entry]));
  const out: CliAgentDef[] = [];
  for (const preset of builtin) {
    const override = byId.get(preset.id);
    byId.delete(preset.id);
    /* ⛔ 先把预置按平台换成「本机该跑的那条命令」，再盖上用户改动 ——
       顺序反过来会让用户在面板里改过的安装命令被 mac 变体盖回去。 */
    const base = withPlatformCmd(preset);
    out.push(override ? { ...base, ...override, builtin: true, id: preset.id } : { ...base });
  }
  for (const extra of byId.values()) out.push({ ...extra, builtin: false });
  return out;
}

function docFile(): string {
  return path.join(app.getPath("userData"), "cli-agents.json");
}

type Doc = { version: number; items: CliAgentDef[] };

async function readDoc(): Promise<Doc> {
  try {
    const raw = await fs.readFile(docFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Doc>;
    return { version: 1, items: Array.isArray(parsed?.items) ? (parsed.items as CliAgentDef[]) : [] };
  } catch {
    // 首次运行 / 文件坏了：都按"没有用户态"处理 —— 内置预置仍然完整可用
    return { version: 1, items: [] };
  }
}

async function writeDoc(items: CliAgentDef[]): Promise<void> {
  const file = docFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // 只落**用户态**：内置条目只存与预设不同的字段（否则升级应用时预设永远被旧值盖住）
  const presets = new Map(BUILTIN_CLI_AGENTS.map((entry) => [entry.id, entry]));
  const slim = items
    .filter((entry) => entry.builtin)
    .map((entry) => {
      const preset = presets.get(entry.id);
      if (!preset) return entry;
      const diff: Record<string, unknown> = { id: entry.id };
      for (const key of ["name", "category", "bin", "installCmd", "installCmdMac", "docs", "description", "promptHint", "enabled"] as const) {
        if (entry[key] !== preset[key]) diff[key] = entry[key];
      }
      return diff;
    })
    .concat(items.filter((entry) => !entry.builtin));
  await fs.writeFile(file, JSON.stringify({ version: 1, items: slim }, null, 2), "utf8");
}

/** 当前全部 CLI 智能体（内置 + 用户）。 */
export async function readCliAgents(): Promise<CliAgentDef[]> {
  const doc = await readDoc();
  return mergeCliAgents(BUILTIN_CLI_AGENTS, doc.items);
}

/**
 * 单条预置的安装命令按平台替换（10-30 mac 指令适配）。
 *
 * 只有「同一条命令在 mac 上确实跑不通」的条目才带 `installCmdMac`（目前是 pip 系的 Aider：
 * mac 上多数环境只有 `pip3` / `python3 -m pip`，裸 `pip` 常报 command not found）。
 * ⛔ 替换发生在**合并预置时**（用户改动随后覆盖），所以：
 *   · 渲染层 / 复制按钮 / 派活提示拿到的永远是「本机该跑的那一条」，界面不需要分支；
 *   · 用户在面板里改过安装命令 ⇒ 他的值仍然生效（不会被我这条 mac 变体盖回去）。
 */
function withPlatformCmd(preset: CliAgentDef): CliAgentDef {
  return process.platform === "darwin" && preset.installCmdMac
    ? { ...preset, installCmd: preset.installCmdMac }
    : preset;
}

/** 只有**启用**的才进调度目录（关掉的不出现在 @ 候选与工具描述里）。 */
export async function readUsableCliAgents(): Promise<CliAgentDef[]> {
  const list = await readCliAgents();
  return list.filter((entry) => entry.enabled && entry.bin);
}

/** 保存入参（⛔ category 收 string 而非联合类型：IPC 边界上先收再校验，
 *  让 handler 的签名与渲染层 d.ts 用同一份内联结构；非法值由 normalizeCliAgent 回落 custom）。 */
export type CliAgentInput = {
  id?: string;
  name?: string;
  category?: string;
  bin?: string;
  installCmd?: string;
  docs?: string;
  description?: string;
  promptHint?: string;
  enabled?: boolean;
};

/** 新增或更新（有 id 且存在 ⇒ 更新；否则新增）。⛔ 内置条目不可被改名成空、不可删除。 */
export async function saveCliAgent(input: CliAgentInput): Promise<{ ok: boolean; item?: CliAgentDef; error?: string }> {
  const list = await readCliAgents();
  const id = String(input?.id ?? "").trim();
  const existing = id ? list.find((entry) => entry.id === id) : undefined;
  const next = normalizeCliAgent({ ...existing, ...input, id: existing?.id ?? input?.id }, {
    builtin: existing?.builtin === true,
    createdAt: existing?.createdAt ?? Date.now(),
  });
  if (!next.bin) return { ok: false, error: "可执行名不能为空（例如 claude / openclaw）" };
  if (!next.name) return { ok: false, error: "名称不能为空" };
  const dup = list.find((entry) => entry.id !== next.id && entry.name.toLowerCase() === next.name.toLowerCase());
  if (dup) return { ok: false, error: `已经有一个叫「${next.name}」的 CLI 了` };
  const updated = existing ? list.map((entry) => (entry.id === next.id ? next : entry)) : [...list, next];
  await writeDoc(updated);
  return { ok: true, item: next };
}

/** 删除（内置条目只允许关停 —— 删了下次启动还会回来，删它只会让人困惑）。 */
export async function removeCliAgent(id: string): Promise<{ ok: boolean; error?: string }> {
  const list = await readCliAgents();
  const target = list.find((entry) => entry.id === String(id ?? ""));
  if (!target) return { ok: false, error: "找不到这个 CLI" };
  if (target.builtin) return { ok: false, error: "内置项不能删除，可以关掉它（关掉后不再出现在 @ 候选里）" };
  await writeDoc(list.filter((entry) => entry.id !== target.id));
  return { ok: true };
}

export type CliDetectResult = { installed: boolean; path: string; version: string; error: string };

/** 在 PATH 上找可执行（不跑它）。⛔ 不用 shell 拼字符串，避免把用户输入当命令解释。 */
function locateBinary(bin: string): Promise<string> {
  const cmd = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    /* ⛔ env 必须走 cliProcessEnv()：⚠️ GUI 进程 PATH 里没有 /opt/homebrew/bin 等目录，
       不增强的话 mac 上「装了也永远显示未检测到」（见 cliProcessEnv 的说明）。 */
    execFile(cmd, [bin], { timeout: 4000, windowsHide: true, env: cliProcessEnv() }, (error, stdout) => {
      if (error) return resolve("");
      const first = String(stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
      resolve(first);
    });
  });
}

/**
 * 「这个可执行在不在 PATH 上」的唯一实现。
 *
 * ⛔⛔ 平台分叉只许发生在这里（10-30 mac 审计）：`where` 是 Windows 专有命令，mac/linux 上
 *   一律是 `which`。写死 `where` 的症状极隐蔽 —— 不报错，只是**永远返回「未检测到」**
 *   （boss 群「本机 CLI agent」名单在 mac 上会整列判成没装，拉人直接被拒）。
 */
export async function binOnPath(bin: string): Promise<boolean> {
  return Boolean(await locateBinary(bin));
}

/** 尽力取版本号（取不到就空串 —— 装没装由 PATH 决定，不靠版本号判断）。 */
function probeVersion(file: string): Promise<string> {
  return new Promise((resolve) => {
    /* ⛔ 同理走 cliEnv()：CLI 自己是 node/python 脚本，子进程要能再找到 node/python。 */
    execFile(file, ["--version"], { timeout: 5000, windowsHide: true, env: cliProcessEnv() }, (error, stdout, stderr) => {
      const text = String(stdout ?? "") || String(stderr ?? "");
      const hit = /v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(text);
      // ⛔ 超时/非零退出也可能已经打印了版本号 ⇒ 不看 error，只看输出里有没有版本串
      resolve(hit ? hit[0] : error ? "" : text.trim().split(/\r?\n/)[0]?.slice(0, 40) ?? "");
    });
  });
}

/** 检测一个 CLI 是否已装（PATH 查名 + 尽力取版本）。 */
export async function detectCliAgent(input: { id?: string; bin?: string }): Promise<CliDetectResult> {
  let bin = normalizeCliBin(input?.bin);
  if (!bin && input?.id) {
    const list = await readCliAgents();
    bin = list.find((entry) => entry.id === String(input.id))?.bin ?? "";
  }
  if (!bin) return { installed: false, path: "", version: "", error: "这个条目还没有可执行名" };
  const found = await locateBinary(bin);
  if (!found) return { installed: false, path: "", version: "", error: "" };
  return { installed: true, path: found, version: await probeVersion(found), error: "" };
}

/* ── 「装没装」的目录缓存（10-30 用户令：@ 列表要实时反映安装状态） ───────────────
   `buildDispatchCatalog` 每次拉目录都会跑（渲染层打开 @ 面板还会 4s 轮询）——
   每次都 fork 一批 where/which 会让设置页卡顿，所以给「批量检测」加一个**短 TTL** 缓存：
   · 命中条件 = 同一批 bin 且距上次检测 ≤ 5s；
   · 安装 / 卸载 / 保存完成后调用 `invalidateCliInstalledCache()`（cli-install.ts 与 IPC 层），
     下一次拉目录必然重检 —— 这是"实时同步"的另一半（轮询只兜"别处装的"那种场景）。 */
let installedCache: { at: number; key: string; flags: Record<string, boolean> } | null = null;

export function invalidateCliInstalledCache(): void {
  installedCache = null;
}

/** 批量检测（并行、带 5s 缓存）。给调度目录用：每个 CLI 一个 `installed` 布尔。 */
export async function cliInstalledFlags(entries: Array<Pick<CliAgentDef, "id" | "bin">>): Promise<Record<string, boolean>> {
  const key = entries.map((entry) => `${entry.id}:${entry.bin}`).join("|");
  if (installedCache && installedCache.key === key && Date.now() - installedCache.at < 5000) return installedCache.flags;
  const flags: Record<string, boolean> = {};
  await Promise.all(entries.map(async (entry) => {
    flags[entry.id] = entry.bin ? await binOnPath(entry.bin) : false;
  }));
  installedCache = { at: Date.now(), key, flags };
  return flags;
}

/**
 * 「主会话的模型配置自动同步给 CLI 智能体」（10-30 用户令，方便小白不用再配一遍）。
 *
 * 做法：派活时把当前供应商的 base_url / key / model 以**环境变量**注入被委派会话的 shell
 * （`thread/start` 的 `shell_environment_policy.set`，引擎按它构造每次工具调用的环境）——
 * OpenAI 兼容系 CLI（aider / openclaw / 多数自研 CLI）认 `OPENAI_*` 这套惯例就能直接跑，
 * 不用用户再贴一遍 Key。⛔ 两条安全边界：
 *   ① Key 只进**该会话的 shell 环境**，不进提示词 / 不落 rollout（凭据进正文 = 进日志）；
 *   ② 供应商口径对不上（例如 OpenAI 兼容 base_url 配 Claude Code 这种 Anthropic 协议 CLI）时
 *      **不硬凑** —— 没有对应的 env 就不注，CLI 用它自己的账号配置（提示词里如实说）。
 */
export function cliModelEnv(input: { provider?: string; baseUrl?: string; model?: string }, apiKey: string): Record<string, string> {
  const baseUrl = String(input?.baseUrl ?? "").trim();
  const model = String(input?.model ?? "").trim();
  const provider = String(input?.provider ?? "").trim();
  if (!apiKey || (!baseUrl && !model)) return {};
  const env: Record<string, string> = { OPENAI_API_KEY: apiKey };
  if (baseUrl) {
    env.OPENAI_BASE_URL = baseUrl;
    env.OPENAI_API_BASE = baseUrl;
  }
  if (model) env.OPENAI_MODEL = model;
  const looksAnthropic = /anthropic/i.test(`${provider} ${baseUrl}`);
  if (looksAnthropic) {
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
    env.ANTHROPIC_API_KEY = apiKey;
    if (model) env.ANTHROPIC_MODEL = model;
  }
  return env;
}

export { BUILTIN_CLI_AGENTS };

/**
 * 派活时下发给被委派会话的角色提示（CLI 智能体的"身份"就是这段）。
 *
 * ⛔ 三条硬约束（与 dispatch 的告知同口径）：
 *   ① 先自检 CLI 在不在（`--help`），**不在就如实回报** —— 不许假装跑过；
 *   ② 安装命令只**转述**，不自己执行（它可能在用户机器上乱装东西）；
 *   ③ 产出必须带"实际跑了什么命令 + 关键输出"，让发起方看得出它不是编的。
 */
export function buildCliRolePrompt(cli: Pick<CliAgentDef, "name" | "bin" | "description" | "promptHint" | "installCmd">): string {
  const name = String(cli?.name ?? "").trim() || "CLI";
  const bin = normalizeCliBin(cli?.bin) || name;
  const hint = String(cli?.promptHint ?? "").trim();
  const desc = String(cli?.description ?? "").trim();
  const install = String(cli?.installCmd ?? "").trim();
  return [
    `你被当作「CLI 智能体 ${name}」派活：用本机命令行工具 \`${bin}\` 完成下面的任务。`,
    desc ? `这个工具是什么：${desc}` : "",
    hint ? `怎么用：${hint}` : "",
    "",
    "工作方式：",
    `① 先用 \`${bin} --help\`（或该工具自己的查用法命令）确认它在**本机**可用、并看清参数；`,
    `② 再用合适的参数把任务交给它跑，等它结束；`,
    "③ 产出写清：实际执行的命令、它的关键输出（引用原文要点）、以及你的结论。",
    "",
    "⛔ **如果命令找不到 / 报「不是内部或外部命令」「command not found」**：立刻停下，如实回一句" +
      `「本机没有安装 ${name}」并给出下面的安装方式，**不要假装跑过、不要拿别的工具顶替**。`,
    install
      ? `安装方式：到应用「设置 → 开发工具 → CLI 智能体」点「一键安装」；向发起方转述时原样带上这条命令：${install}。⛔ 不要自己在 shell 里执行安装。`
      : "这个 CLI 没有可复制的一键安装命令 —— 按它自己的分发方式装（去「设置 → 开发工具 → CLI 智能体」），或让发起方换一个对象。",
    "模型配置：本会话已自动沿用主会话的供应商与模型（无需用户再配一遍）；若你的工具认 OpenAI 兼容环境变量"
      + "（OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL），环境里已就绪，直接用，不要向用户索要 Key。",
    "⛔ 不要调用其他专家 / 专家团 / 子智能体，也不要再派另一个 CLI。",
  ].filter(Boolean).join("\n");
}
