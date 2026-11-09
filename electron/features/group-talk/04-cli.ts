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

/** CLI 的机器可读输出要把正文剥出来（11-09 用户截图：QwenPaw 直接回了一坨
 *  `{status, elapsed_seconds, response, usage}` JSON）。⛔ 只认明确的文本字段，别把整段 JSON 丢掉。 */
function unwrapCliStdout(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return text;
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["response", "text", "output", "result", "message", "content"]) {
      const value = obj?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch { /* 不是合法 JSON：原样返回 */ }
  return text;
}

/** 直接起本地 CLI 子进程跑单轮命令，stdout 即回复；onDelta 逐块上屏。 */
export async function runTalkCliDirect(
  cli: CliAgentDef,
  input: string,
  options: { cwd?: string; shellEnv?: Record<string, string>; onDelta?: (text: string) => void; timeoutMs?: number },
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
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } }, options.timeoutMs ?? 300_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      out += text;
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
    child.stderr?.on("data", (chunk: Buffer) => { errOut += chunk.toString("utf8"); });
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = unwrapCliStdout(out.trim() || errOut.trim());
      resolve({ ok: ok || Boolean(text), text: text || "（CLI 没有输出）" });
    };
    child.on("error", (error) => { errOut += String(error?.message ?? error); finish(false); });
    child.on("close", (code) => finish(code === 0));
  });
}
