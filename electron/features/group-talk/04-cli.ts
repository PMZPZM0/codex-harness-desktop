/**
 * 群聊里的 CLI 成员 = **直接由本地 CLI 进程回复**（11-09 用户令：「我不是要调用 cli…要他转交干什么，
 * 效率太慢了，我要的是直接本地 CLI 回复」）。
 *
 * ⛔ 不走引擎会话、不让主会话模型"转交/代跑"：群消息直接喂给本机 CLI 的单轮非交互命令
 *    （`claude -p "…" / qwen -p "…" …`），CLI 的 stdout 就是这位成员的群回复。
 * ⛔ 环境与「@ 调度 CLI」同口径：增强 PATH + 主会话供应商/Key/模型（cliModelEnv）+ 独立 CODEX_HOME；
 *    Key 只进子进程环境，不进提示词、不落盘。
 * ⛔ 没装 = 如实回「本机没有安装 X + 安装入口」，绝不拿主会话模型顶替。
 * ⛔ 流式：stdout 逐块广播 group-talk-live delta，群里"正在写"逐字上屏（与引擎成员同手感）。
 */
import { spawn } from "node:child_process";
import { safeStorage } from "electron";
import { binOnPath, cliCodexHome, cliCodexHomeReady, cliModelEnv, cliProcessEnv, readUsableCliAgents, type CliAgentDef } from "../../cli-agents";
import { readCustomModel } from "../../main/01-model-catalog";
import { isLocalBaseUrl, cliProtocolOf } from "../../../src/lib/cli-provider-config.mjs";
import { cliPermissionTierOf, cliPromptCommandFor, fillCliPromptTemplate } from "../../../src/lib/cli-command.mjs";
import type { TalkMember } from "./01-channel";

export type TalkCliPlan =
  | { installed: true; cli: CliAgentDef; shellEnv: Record<string, string> }
  | { installed: false; text: string };

/** 非 CLI 成员返回 null（调用方据此完全走旧的引擎会话路径，零影响）。 */
export async function planTalkCli(member: TalkMember): Promise<TalkCliPlan | null> {
  if (member?.targetKind !== "cli") return null;
  const key = String(member?.targetKey ?? "").trim();
  const agents = await readUsableCliAgents().catch(() => [] as CliAgentDef[]);
  const cli = agents.find((a) => String(a.id) === key) ?? null;
  if (!cli) {
    return { installed: false, text: `找不到 CLI 智能体「${key || member.name}」。请到「设置 → 开发工具 → CLI 智能体」确认后再 @ 我。` };
  }
  const installed = await binOnPath(cli.bin).catch(() => false);
  if (!installed) {
    return {
      installed: false,
      text: `本机没有安装 ${cli.name}（命令 \`${cli.bin}\` 不在 PATH）。安装方式：到应用「设置 → 开发工具 → CLI 智能体」点「一键安装」${cli.installCmd ? `（命令：${cli.installCmd}）` : ""}。装好后再 @ 我，回复你的就是真的 ${cli.name} 本地进程。`,
    };
  }
  const custom = await readCustomModel().catch(() => null);
  const provider = custom?.provider ?? "openai";
  const apiKey = custom?.encryptedKey && safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(custom.encryptedKey, "base64"))
    : "";
  const shellEnv: Record<string, string> = {
    /* ⛔ 按这个 CLI 的**协议族**注入（11-10 用户报障「群里 CLI 成员都用不了」）：
       Claude Code 只认 ANTHROPIC_*（给它 OPENAI_* 等于没配 ⇒ `Not logged in`），
       Kimi 走 config.toml 的 api_key_env、Codex 走自己的 home，Gemini 系认 GOOGLE_GEMINI_*。 */
    ...cliModelEnv({ provider, baseUrl: custom?.baseUrl, model: custom?.model, local: isLocalBaseUrl(custom?.baseUrl), protocol: cliProtocolOf(cli.bin) }, apiKey),
    ...(cliCodexHomeReady() ? { CODEX_HOME: cliCodexHome() } : {}),
  };
  return { installed: true, cli, shellEnv };
}

/** CLI 输出里的 ANSI 颜色/光标控制（kimi / iflow 这类会带）——不剥掉会在群里显示乱码方块。 */
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = (value: string) => value.replace(ANSI_RE, "");
/** 可能承载"正文"的字段（各 CLI 的 JSON 包裹形状不一：QwenPaw=response、OpenClaw=result/text、事件流=delta…）。 */
const TEXT_KEYS = ["response", "text", "output", "result", "message", "content", "answer", "reply", "delta", "completion", "final", "summary"];

/** 深度取第一段文本（先 known keys，再递归对象/数组；⛔ 不把 usage/status 这类 meta 当正文）。 */
function pickText(node: unknown, depth = 0): string {
  if (depth > 4 || node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    for (const value of node) { const hit = pickText(value, depth + 1); if (hit.trim()) return hit; }
    return "";
  }
  if (typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  for (const key of TEXT_KEYS) if (key in obj) { const hit = pickText(obj[key], depth + 1); if (hit.trim()) return hit; }
  return "";
}

function tryJson(text: string): unknown {
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

/** CLI 的机器可读输出要把正文剥出来（11-09 用户截图：QwenPaw 直接回了一坨
 *  `{status, elapsed_seconds, response, usage}` JSON）。⛔ 覆盖同类：OpenClaw `--json`、
 *  Comate `--display event-stream`（NDJSON 事件流）等，最后再退回原始文本。 */
function unwrapCliStdout(raw: string): string {
  const clean = stripAnsi(String(raw ?? "")).trim();
  if (!clean) return "";
  const whole = tryJson(clean);
  if (whole !== undefined) return pickText(whole).trim() || clean;
  /* NDJSON / 事件流：逐行解析，汇总文本字段（兼容"累计重复"与"增量 delta"两种事件形态）。 */
  const objects = clean.split(/\r?\n/).map((line) => tryJson(line)).filter((value) => value !== undefined);
  if (objects.length) {
    const parts = objects.map((value) => pickText(value).trim()).filter(Boolean);
    if (parts.length) {
      let merged = "";
      for (const part of parts) merged = part.includes(merged) ? part : merged + part;
      if (merged.trim()) return merged.trim();
    }
  }
  return clean;
}

/** 正在跑的 CLI 子进程（按 `群id::成员id` 登记）：群里点「停止」要能真的把它们杀掉
 *  （⛔ 引擎的 turn/interrupt 管不到本机进程）。 */
const activeChildren = new Map<string, Set<import("node:child_process").ChildProcess>>();

/** 停掉 CLI 直跑进程：给 memberId 只杀那位成员，不给就杀该群全部；返回杀掉的个数。 */
export function killTalkCliRuns(groupId: string, memberId?: string): number {
  const gid = String(groupId ?? "");
  if (!gid) return 0;
  const prefix = `${gid}::`;
  const exact = memberId ? `${prefix}${memberId}` : "";
  let n = 0;
  for (const [key, set] of [...activeChildren]) {
    if (exact ? key !== exact : !key.startsWith(prefix)) continue;
    activeChildren.delete(key);
    for (const child of set) {
      try { child.kill("SIGKILL"); n += 1; } catch { /* 已退出 */ }
    }
  }
  return n;
}

/**
 * 失败原因 → 人话提示（11-10 用户截图：群里只有一坨 `provider.connection_error` / 400 JSON，
 * 看不出该做什么）。⛔ 只**追加**一行，不吞原始报错 —— 用户/模型仍能读到原文。
 * ⛔ 这些是"症状→下一步"，不是猜根因：命中不了就只留原文。
 */
const FAILURE_HINTS: Array<[RegExp, string]> = [
  [/Not logged in|Please run \/login/i,
    "这个 CLI 还没登录。应用会自动把当前供应商注入给它；若仍报未登录，先在本机终端跑一次 `{bin}` 完成它自己的登录（或在「设置 → 账号与模型」确认供应商可用）。"],
  [/provider\.connection_error|Connection error|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connect ETIMEDOUT/i,
    "连不上模型服务：当前供应商地址（或它依赖的本地代理）没有在运行。到「设置 → 账号与模型」确认供应商可用，或把供应商切到能用的那个。"],
  [/"code":\s*400|Error code: 400|bad request/i,
    "模型服务拒了这次请求（400）：多半是模型名或协议与当前供应商不匹配。切一个支持该 CLI 协议的供应商，或换用与该供应商兼容的 CLI。"],
  [/"code":\s*401|401 Unauthorized|invalid api key|authentication_error/i,
    "鉴权失败（401）：当前供应商的 Key 无效或已过期，到「设置 → 账号与模型」更新。"],
  /* 11-10 实测（用户截图）：Qwen Code 默认按 Gemini 协议拼 /v1beta/…，中转回的就是这一句。
     ⛔ 不能笼统说"网络问题"——它其实是**协议不匹配**，换供应商或换 CLI 才对。 */
  [/Method Not Allowed|"status":\s*405|Error code: 405/i,
    "协议不匹配（405）：这个 CLI 用的是当前供应商不支持的协议（例如它只讲 Gemini 协议，而供应商只开 OpenAI / Anthropic）。换一个与该供应商兼容的 CLI，或把供应商换成支持它协议的那个。"],
  /* 各家自己的账号体系（Comate 的 license、OpenClaw 的 gateway 配对等）—— 主会话的 Key 帮不上。 */
  [/No license or token provided|configure gateway\.auth|please set an auth method/i,
    "这个 CLI 要它自己的账号授权（不是模型 Key 能替代的）：到它自己的登录 / 配置流程里授权一次，或换用能跟随主会话的 CLI。"],
  [/EADDRINUSE|address already in use/i,
    "端口被占用：这个 CLI 上次可能没退干净。等几秒重试；还不行就重启一下应用再发。"],

  [/command not found|不是内部或外部命令|ENOENT/i,
    "命令行入口找不到：到「设置 → 开发工具 → CLI 智能体」确认这个 CLI 已安装。"],
];

function cliFailureHint(text: string, cli: CliAgentDef): string {
  for (const [pattern, hint] of FAILURE_HINTS) {
    if (pattern.test(text)) return hint.replace("{bin}", cli.bin || cli.name);
  }
  return "";
}

/** 直接起本地 CLI 子进程跑单轮命令，stdout 即回复；onDelta 逐块上屏。 */
export async function runTalkCliDirect(
  cli: CliAgentDef,
  input: string,
  options: { scopeId?: string; cwd?: string; shellEnv?: Record<string, string>; onDelta?: (text: string) => void; timeoutMs?: number },
): Promise<{ ok: boolean; text: string }> {
  const tier = cliPermissionTierOf(cli.permissionTier);
  const template = cliPromptCommandFor(cli.bin, tier) || `${cli.bin} -p "{prompt}"`;
  const command = fillCliPromptTemplate(template, input);
  const env = { ...cliProcessEnv(), ...(options.shellEnv ?? {}) };
  const isWin = process.platform === "win32";
  return await new Promise((resolve) => {
    let out = "";
    let errOut = "";
    let settled = false;
    /* JSON 信封（QwenPaw 这类）在流式阶段看着就是一坨代码 —— 先攒住判断，是 JSON 就不上屏。 */
    let head = "";
    let streaming = false;
    const child = spawn(isWin ? "cmd" : "/bin/sh", [isWin ? "/c" : "-c", command], {
      cwd: String(options.cwd ?? "").trim() || process.cwd(),
      env,
      windowsHide: true,
      /* ⛔⛔ stdin 必须忽略（11-10 实测）：Claude Code 在 `-p` 下看到「打开的 stdin」会等 3 秒
         打一句 `no stdin data received in 3s` 再继续，且这条路径的正文可能整段丢掉
         （群里表现就是「成员回了但没有内容」）。CLI 单轮不需要任何标准输入。 */
      stdio: ["ignore", "pipe", "pipe"],
      ...(isWin ? { windowsVerbatimArguments: true } : {}),
    });
    /* 按 `群id::成员id` 登记，供「停止」杀掉；⛔ 不登记就没有任何办法中断本机 CLI。 */
    const groupKey = String(options.scopeId ?? "");
    if (groupKey) {
      const set = activeChildren.get(groupKey) ?? new Set();
      set.add(child);
      activeChildren.set(groupKey, set);
    }
    const untrack = () => {
      if (!groupKey) return;
      const set = activeChildren.get(groupKey);
      if (set) { set.delete(child); if (!set.size) activeChildren.delete(groupKey); }
    };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } }, options.timeoutMs ?? 600_000);
    /* ⛔ stdout/stderr 上限：CLI 刷屏（-v / 事件流）时不能无限吃内存。 */
    const MAX_OUT = 8 * 1024 * 1024;
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (out.length < MAX_OUT) out += text;
      if (!streaming) {
        head += text;
        const trimmed = head.trimStart();
        if (!trimmed) return;
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) return;   // JSON 信封：等收尾解析
        streaming = true;
        options.onDelta?.(head);
        return;
      }
      options.onDelta?.(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => { if (errOut.length < MAX_OUT) errOut += chunk.toString("utf8"); });
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      untrack();
      const text = unwrapCliStdout(out.trim() || errOut.trim());
      /* 失败时补一行"下一步"（原文照留）；成功就一个字符都不加。 */
      const hint = ok && out.trim() ? "" : cliFailureHint(`${text}\n${errOut}`, cli);
      const body = text || "（CLI 没有输出）";
      resolve({ ok: ok || Boolean(text), text: hint ? `${body}\n\n—— ${hint}` : body });
    };
    child.on("error", (error) => { errOut += String(error?.message ?? error); finish(false); });
    child.on("close", (code) => finish(code === 0));
  });
}
