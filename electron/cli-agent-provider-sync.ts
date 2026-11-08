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
 *   ⛔ 只有**本机中转**才写 Gemini/Kimi 的配置（中转不校验 Key，用占位符）——
 *      外部供应商的真实 Key 绝不落进任何 CLI 配置文件。
 *   ⛔ 首次改动前留 `<file>.harness.bak`；内容相同不重写（幂等）。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readCustomModel } from "./main/01-model-catalog";
import { binOnPath, cliCodexHome } from "./cli-agents";
import { codexConfigToml, isLocalBaseUrl, kimiConfigToml, mergeGeminiSettings } from "../src/lib/cli-provider-config.mjs";

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

  if (isLocalBaseUrl(baseUrl)) {
    await attempt("gemini", async () => {
      if (!(await binOnPath("gemini"))) { skipped.push("gemini"); return; }
      const file = path.join(os.homedir(), ".gemini", "settings.json");
      const raw = await fs.readFile(file, "utf8").then((text) => JSON.parse(text)).catch(() => null);
      const merged = `${JSON.stringify(mergeGeminiSettings(raw, { model }), null, 2)}\n`;
      if (await writeManaged(file, merged, true)) updated.push("gemini");
    });
    await attempt("kimi", async () => {
      if (!(await binOnPath("kimi"))) { skipped.push("kimi"); return; }
      const file = path.join(os.homedir(), ".kimi-code", "config.toml");
      if (await writeManaged(file, kimiConfigToml({ baseUrl, model, apiKey: "harness-local" }), true)) updated.push("kimi");
    });
  } else {
    /* 外部供应商：Gemini/Kimi 的配置需要写真实 Key —— 不落盘（只在派活子进程环境里出现）。 */
    skipped.push("gemini(非本机中转)", "kimi(非本机中转)");
  }
  return { updated, skipped };
}
