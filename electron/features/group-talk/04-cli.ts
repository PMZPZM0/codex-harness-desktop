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
import { isLocalBaseUrl } from "../../../src/lib/cli-provider-config.mjs";
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
    ...cliModelEnv({ provider, baseUrl: custom?.baseUrl, model: custom?.model, local: isLocalBaseUrl(custom?.baseUrl) }, apiKey),
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
      resolve({ ok: ok || Boolean(text), text: text || "（CLI 没有输出）" });
    };
    child.on("error", (error) => { errOut += String(error?.message ?? error); finish(false); });
    child.on("close", (code) => finish(code === 0));
  });
}
