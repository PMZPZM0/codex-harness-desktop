/**
 * CLI 智能体「跟随主会话供应商/模型」的落盘同步（11-07 用户令：
 *   「用户安装 cli 就全部自动配置，跟着供应模型来；用户切换供应商也自动配置更新」）。
 *
 * 两种跟随方式：
 *   · **环境变量**（派活时注入，见 cli-agents.cliModelEnv）：OpenAI / Anthropic / Gemini 三套；
 *   · **配置文件**（本模块，落盘一次、切供应商时重写）：
 *       - Codex：写应用自己的 `<userData>/cli-codex-home/config.toml`（⛔ 不碰用户 ~/.codex），
 *         provider 指向当前供应商，Key 只写环境变量名（OPENAI_API_KEY），文件里没有明文；
 *       - Gemini：`~/.gemini/settings.json` 合并「用 API Key 认证」（否则非交互报 Invalid auth method）；
 *       - Kimi：`~/.kimi-code/config.toml` 的 provider/model 段。
 *   ⛔⛔ 11-10 修：「只有本机中转才写 Gemini/Kimi」是错的 —— 切到外部供应商后这两份配置
 *      会**永远停在旧的本机中转地址**（实测 kimi 焊死 本机中转端口，无监听 ⇒ 群里
 *      `provider.connection_error`，用户报「CLI 成员都用不了」）。现在每次都重写当前供应商：
 *      外部的 Key 通过 `api_key_env`（Kimi）/ 环境变量（Gemini）给出，⛔ 配置文件里永不含明文 Key。
 *   ⛔ 首次改动前留 `<file>.harness.bak`；内容相同不重写（幂等）。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readCustomModel } from "./main/01-model-catalog";
import { binOnPath, cliCodexHome } from "./cli-agents";
import { CLI_KEY_ENV, codexConfigToml, isLocalBaseUrl, kimiConfigToml, mergeGeminiSettings } from "../src/lib/cli-provider-config.mjs";

export type CliProviderSyncResult = { updated: string[]; skipped: string[] };

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

/** 写受管文件：内容相同不写；`backup` 时首次改动前留一份 .harness.bak。 */
async function writeManaged(file: string, content: string, backup = false): Promise<boolean> {
  if (!content) return false;
  const current = await fs.readFile(file, "utf8").catch(() => null);
  if (current === content) return false;
  if (backup && current !== null) {
    const bak = `${file}.harness.bak`;
    if (!(await exists(bak))) await fs.copyFile(file, bak).catch(() => undefined);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
  return true;
}

/** 同步一次。失败一律吞掉（同步是旁路，不许影响启动 / 派活）；
 *  ⛔ 每个 CLI 独立 catch —— Gemini 写挂（EACCES 等）不许连累后面的 Kimi。 */
export async function syncCliAgentProviderConfig(): Promise<CliProviderSyncResult> {
  const updated: string[] = [];
  const skipped: string[] = [];
  let custom: Awaited<ReturnType<typeof readCustomModel>>;
  try {
    custom = await readCustomModel();
  } catch { return { updated, skipped: ["未配置供应商"] }; }
  const baseUrl = String(custom?.baseUrl ?? "").trim();
  const model = String(custom?.model ?? "").trim();
  if (!baseUrl || !model) return { updated, skipped: ["未配置供应商"] };

  const attempt = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch { skipped.push(name); }
  };

  await attempt("codex", async () => {
    if (!(await binOnPath("codex"))) { skipped.push("codex"); return; }
    if (await writeManaged(path.join(cliCodexHome(), "config.toml"), codexConfigToml({ baseUrl, model }))) updated.push("codex");
  });

  /* Gemini CLI 的 settings.json 只写「用 API Key 认证 + 模型名」，**不含 Key**（Key 走环境变量
     GEMINI_API_KEY）⇒ 本机中转和外部供应商都安全、都该写。原来的「只有本机中转才写」会让
     切到外部供应商后这份配置永远停在旧模型上。 */
  await attempt("gemini", async () => {
    if (!(await binOnPath("gemini"))) { skipped.push("gemini"); return; }
    const file = path.join(os.homedir(), ".gemini", "settings.json");
    const raw = await fs.readFile(file, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    const merged = `${JSON.stringify(mergeGeminiSettings(raw, { model }), null, 2)}\n`;
    if (await writeManaged(file, merged, true)) updated.push("gemini");
  });
  /* Kimi Code（11-10 修）：原来「非本机中转就跳过」，导致切到外部供应商后 config.toml 里
     仍焊着上一次的本机中转地址（实测 本机中转端口 已经没人监听 ⇒ 群里永远
     `provider.connection_error: Connection error`）。现在**每次都写**：
       · 本机中转 ⇒ api_key 占位符（不校验）；
       · 外部供应商 ⇒ api_key_env = CLI_KEY_ENV，Key 只经派活子进程环境给出，⛔ 配置里没有明文。 */
  await attempt("kimi", async () => {
    if (!(await binOnPath("kimi"))) { skipped.push("kimi"); return; }
    const file = path.join(os.homedir(), ".kimi-code", "config.toml");
    const next = isLocalBaseUrl(baseUrl)
      ? kimiConfigToml({ baseUrl, model, apiKey: "harness-local" })
      : kimiConfigToml({ baseUrl, model, apiKeyEnv: CLI_KEY_ENV });
    if (await writeManaged(file, next, true)) updated.push("kimi");
  });
  return { updated, skipped };
}
