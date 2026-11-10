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
import { safeStorage } from "electron";
import { readCustomModel } from "./main/01-model-catalog";
import { binOnPath, cliCodexHome, readCliAgents } from "./cli-agents";
import { CLI_KEY_ENV, cliProtocolOf, codexConfigToml, iflowSettingsJson, isLocalBaseUrl, kimiConfigToml, stripV1Suffix } from "../src/lib/cli-provider-config.mjs";

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

/* ── 单个 CLI 的写入实现（唯一实现，全量同步与「单点按键」共用，⛔ 不写第二份）──────
   每个函数都自己判「装了没 / 值够不够」，返回 true = 真的写了文件。 */

async function writeCodexConfig(baseUrl: string, model: string): Promise<boolean> {
  if (!(await binOnPath("codex"))) return false;
  return writeManaged(path.join(cliCodexHome(), "config.toml"), codexConfigToml({ baseUrl, model }));
}

/** Kimi Code（11-10 修）：原来「非本机中转就跳过」，导致切到外部供应商后 config.toml 里
 *  仍焊着上一次的本机中转地址（实测本机中转端口没人监听 ⇒ 群里永远
 *  `provider.connection_error`）。现在**每次都写**：
 *    · 本机中转 ⇒ api_key 占位符（不校验）；
 *    · 外部供应商 ⇒ api_key_env = CLI_KEY_ENV，Key 只经派活子进程环境给出，⛔ 配置里没有明文。 */
async function writeKimiConfig(baseUrl: string, model: string): Promise<boolean> {
  if (!(await binOnPath("kimi"))) return false;
  const file = path.join(os.homedir(), ".kimi-code", "config.toml");
  const next = isLocalBaseUrl(baseUrl)
    ? kimiConfigToml({ baseUrl, model, apiKey: "harness-local" })
    : kimiConfigToml({ baseUrl, model, apiKeyEnv: CLI_KEY_ENV });
  return writeManaged(file, next, true);
}

/** iFlow CLI（11-10 实测 0.5.19）：环境变量只够过 auth 判定（IFLOW_API_KEY），baseUrl / model
 *  必须落在 `~/.iflow/settings.json` 顶层（字段白名单见 iflowSettingsJson 的注释）。
 *  ⛔ 该文件必然含明文 Key —— 这是 iFlow 官方唯一的跟随方式；拿不到 Key 就什么都不写。 */
async function writeIflowConfig(baseUrl: string, model: string): Promise<boolean> {
  if (!(await binOnPath("iflow"))) return false;
  const apiKey = await currentProviderApiKey();
  if (!apiKey) return false;
  const file = path.join(os.homedir(), ".iflow", "settings.json");
  const raw = await fs.readFile(file, "utf8").then((text) => JSON.parse(text)).catch(() => null);
  const next = iflowSettingsJson(raw, { baseUrl, model, apiKey });
  return Boolean(next) && (await writeManaged(file, next, true));
}

/** 同步一次。失败一律吞掉（同步是旁路，不许影响启动 / 派活）；
 *  ⛔ 每个 CLI 独立 catch —— 一个写挂（EACCES 等）不许连累后面的。 */
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
    if (await writeCodexConfig(baseUrl, model)) updated.push("codex"); else skipped.push("codex");
  });

  /* ⛔⛔ Gemini 不在这里落盘（11-10 实测）：它只会拼 Gemini 协议（`/v1beta/…`），而我们的
     供应商是 OpenAI / Anthropic 协议 ⇒ 写 `selectedType: gemini-api-key` 反而把它从
     「用自己 Google 登录还能跑」改成「拿一个跑不通的 key 去撞 405」。
     协议对不上就不硬凑 —— 让它用自己的登录态，弹窗里如实标注。 */
  await attempt("kimi", async () => {
    if (await writeKimiConfig(baseUrl, model)) updated.push("kimi"); else skipped.push("kimi");
  });
  await attempt("iflow", async () => {
    if (await writeIflowConfig(baseUrl, model)) updated.push("iflow"); else skipped.push("iflow");
  });
  return { updated, skipped };
}

/**
 * **单点同步**（11-10 用户令：「可以根据每个CLI特殊情况，定制模型同步按键」）。
 *
 * 每个 CLI 的跟随方式本来就不同（谁写配置、谁要明文 Key、谁只能自己登录），所以按键也按条给：
 *   · claude / iflow ⇒ 写含 Key 的文件（界面上要先二次确认）；
 *   · codex / kimi   ⇒ 写不含 Key 的配置；
 *   · 其它（env / own）⇒ 没有可写的文件，返回「不需要按键」的说明，⛔ 不假装同步过。
 */
export async function syncOneCliProvider(targetId: string): Promise<{ ok: boolean; name: string; detail: string }> {
  const list = await readCliAgents().catch(() => []);
  const agent = list.find((entry) => String(entry.id) === String(targetId));
  if (!agent) return { ok: false, name: String(targetId), detail: "找不到这个 CLI" };
  const name = agent.name;
  const bin = String(agent.bin ?? "").toLowerCase();
  if (!bin || !(await binOnPath(bin).catch(() => false))) {
    return { ok: false, name, detail: `本机没检测到 \`${bin || agent.name}\`，先去安装再同步` };
  }
  const custom = await readCustomModel().catch(() => null);
  const baseUrl = String(custom?.baseUrl ?? "").trim();
  const model = String(custom?.model ?? "").trim();
  if (!baseUrl || !model) return { ok: false, name, detail: "还没配置供应商或模型" };

  if (bin === "claude") {
    const r = await syncClaudeProvider({ baseUrl, model, apiKey: await currentProviderApiKey() });
    return { ok: r.ok, name, detail: r.detail };
  }
  if (bin === "iflow") {
    const done = await writeIflowConfig(baseUrl, model);
    return done
      ? { ok: true, name, detail: "已写入 ~/.iflow/settings.json（selectedAuthType=openai-compatible + Key，仅本机）" }
      : { ok: false, name, detail: "写入失败：可能读不到当前供应商的 Key，或该文件不可写" };
  }
  if (bin === "codex") {
    const done = await writeCodexConfig(baseUrl, model);
    return done
      ? { ok: true, name, detail: "已重写应用自己的 cli-codex-home/config.toml（不含 Key）" }
      : { ok: false, name, detail: "没写成：文件内容已是最新，或该目录不可写" };
  }
  if (bin === "kimi") {
    const done = await writeKimiConfig(baseUrl, model);
    return done
      ? { ok: true, name, detail: "已重写 ~/.kimi-code/config.toml（外部供应商用 api_key_env，Key 不落盘）" }
      : { ok: false, name, detail: "没写成：文件内容已是最新，或该目录不可写" };
  }
  return {
    ok: true,
    name,
    detail: "这个 CLI 不需要写文件 —— 派活时自动注入环境变量；如果它要自己的账号，请按它自己的登录流程授权",
  };
}

/* ── 「同步给 CLI 智能体」弹窗（11-10 用户令：「在模型配置界面加一个同步给 CLI 智能体配置功能，
      Claude 比较特殊，就单独按键同步，其他也是已安装的 cli 就都识别出来，按键做成弹窗模式」）────

   ⛔ Claude Code 为什么单独一档：它**没有可跟随的配置文件约定**（不读 OPENAI_*，也不像
     kimi / gemini 那样有一份 provider 段让我们写），唯一能让它「以后一直跟着走」的地方是
     `~/.claude/settings.json` 的 `env` 段（Claude Code 官方设置文件）。别的 CLI 走
     config.toml / settings.json / 环境变量，它要单独按键、单独写，并明确告诉用户
     「会把 Key 明文写进本机 ~/.claude/settings.json」—— 不做隐性落盘。
   ⛔ 其余 CLI 分三类：config（写配置文件）/ env（派活时注入环境变量）/ own（用它自己的模型配置）。
     同步动作只对前两类生效，own 类如实标注「不跟随主会话」，不假装同步过。 */

/** `keyed` = 写配置文件且**含明文 Key** 的跟随方式（Claude / iFlow 这类没有间接引用机制）。
 *  `claude` 单独存在是因为它在界面上要独占一块（用户点名「Claude 比较特殊，就单独按键同步」）。 */
export type CliSyncKind = "claude" | "keyed" | "config" | "env" | "own";

/** 当前供应商的明文 Key（**只给同步函数用**，⛔ 绝不经 IPC 回传渲染层）。
 *  ⛔ 放在这个模块而不是 features/** 里：【266】禁止域文件直取 safeStorage
 *     （触碰系统密钥库的能力必须留在内核侧模块）。 */
export async function currentProviderApiKey(): Promise<string> {
  const custom = await readCustomModel().catch(() => null);
  return custom?.encryptedKey && safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(custom.encryptedKey, "base64"))
    : "";
}

export type CliSyncTarget = {
  id: string;
  name: string;
  bin: string;
  installed: boolean;
  kind: CliSyncKind;
  /** 同步会发生什么（界面上一行说明） */
  action: string;
  /** 当前状态（人话） */
  status: string;
};

/** 每个 CLI 的同步方式与现状（rendering 层只展示，判定全在这里）。 */
export async function inspectCliSyncTargets(): Promise<{
  provider: { name: string; model: string; host: string; local: boolean; ready: boolean };
  targets: CliSyncTarget[];
}> {
  const custom = await readCustomModel().catch(() => null);
  const baseUrl = String(custom?.baseUrl ?? "").trim();
  const model = String(custom?.model ?? "").trim();
  let host = "";
  try { host = baseUrl ? new URL(baseUrl).host : ""; } catch { host = ""; }
  const local = isLocalBaseUrl(baseUrl);

  const agents = await readCliAgents().catch(() => []);
  const targets: CliSyncTarget[] = [];
  for (const agent of agents) {
    if (agent.enabled === false) continue;
    const installed = agent.bin ? await binOnPath(agent.bin).catch(() => false) : false;
    if (!installed) continue;   // 用户令：只识别**已安装**的
    const bin = String(agent.bin ?? "").toLowerCase();
    const protocol = cliProtocolOf(bin);
    if (bin === "claude") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "claude",
        action: `写入 ~/.claude/settings.json 的 env（含 Key，仅本机生效）`,
        status: await claudeSettingsState(baseUrl, model),
      });
      continue;
    }
    if (bin === "codex" || bin === "kimi") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "config",
        action: "按当前供应商重写它自己的配置文件（Key 不落盘）",
        status: "跟随当前供应商（启动 / 切供应商 / 安装后自动同步）",
      });
      continue;
    }
    if (bin === "gemini") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "own",
        action: "用它自己的 Google 账号，或指向一个支持 Gemini 协议的中转",
        status: "当前供应商只提供 OpenAI / Anthropic 协议 —— 实测 gemini 拼 /v1beta/… 会被拒（405）；"
          + "要让它跟随，得把供应商换成 Gemini 协议端点。命令已带 --skip-trust，仍可用它自己的登录",
      });
      continue;
    }
    if (bin === "iflow") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "keyed",
        action: "写 ~/.iflow/settings.json（selectedAuthType=openai-compatible + Key，仅本机）",
        status: "跟随当前供应商（该 CLI 只支持把自己的配置文件写全，环境变量不够）",
      });
      continue;
    }
    if (bin === "qwenpaw") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "own",
        action: "用它自己的模型配置（qwenpaw models）",
        status: "不跟随主会话：它不读 OPENAI_*，用的是自己配的 provider",
      });
      continue;
    }
    if (bin === "qwen") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "env",
        action: "派活时注入 OPENAI_*，命令自动带 --auth-type openai",
        status: "派活时自动注入（它默认按 gemini 协议拼路径，会撞 405，所以固定带 auth-type）",
      });
      continue;
    }
    /* 11-10 实测：这几个拿主会话的 Key **用不了**，它们要的是自己的账号/网关 —— 如实标注，
       ⛔ 不写进「跟随」那一档（否则用户以为同步过了，进群还是失败）。 */
    if (bin === "comatecli") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "own",
        action: "用它自己的百度 license / ptoken",
        status: "不跟随主会话：实测报「No license or token provided」，需要在它自己的登录体系里授权",
      });
      continue;
    }
    if (bin === "openclaw") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "own",
        action: "用它自己的 gateway 配置",
        status: "不跟随主会话：实测要求 gateway.auth 配对（token/password），不是模型 Key 能替代的",
      });
      continue;
    }
    if (bin === "qoder") {
      targets.push({
        id: agent.id, name: agent.name, bin: agent.bin, installed, kind: "own",
        action: "用它自己的登录态",
        status: "不跟随主会话：实测在主会话 Key 下报错，需要按它自己的 login 流程授权",
      });
      continue;
    }
    targets.push({
      id: agent.id, name: agent.name, bin: agent.bin, installed,
      kind: protocol === "native" ? "own" : "env",
      action: "派活时注入对应协议的环境变量（不落盘）",
      status: protocol === "native" ? "用它自己的登录态" : "派活时自动注入，无需配置",
    });
  }
  return {
    provider: { name: String(custom?.name ?? custom?.provider ?? "(未配置)"), model, host, local, ready: Boolean(baseUrl && model) },
    targets,
  };
}

/** `~/.claude/settings.json` 里有没有指向**当前**供应商的 env（只读判定，不写）。 */
async function claudeSettingsState(baseUrl: string, model: string): Promise<string> {
  const file = path.join(os.homedir(), ".claude", "settings.json");
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as { env?: Record<string, unknown> };
    const base = String(raw?.env?.ANTHROPIC_BASE_URL ?? "").trim();
    const name = String(raw?.env?.ANTHROPIC_MODEL ?? "").trim();
    if (!base) return "未同步（派活时会临时注入，本机终端直跑不会跟随）";
    if (base === stripV1Suffix(baseUrl) && (!model || name === model)) return "已同步到当前供应商";
    return `已同步到其它供应商（${name || "未写模型"}），与当前配置不一致`;
  } catch {
    return "未同步（派活时会临时注入，本机终端直跑不会跟随）";
  }
}

/** Claude 单独同步：把当前供应商写进 `~/.claude/settings.json` 的 env 段（合并，不动其它键）。
 *  ⛔ key 会明文落进这个文件 —— 由用户按「同步 Claude Code」按钮显式触发，不自动做。 */
export async function syncClaudeProvider(input: { baseUrl: string; model: string; apiKey: string }): Promise<{ ok: boolean; detail: string }> {
  const baseUrl = String(input?.baseUrl ?? "").trim();
  const model = String(input?.model ?? "").trim();
  const apiKey = String(input?.apiKey ?? "").trim();
  if (!baseUrl || !model) return { ok: false, detail: "还没配置供应商或模型" };
  if (!apiKey) return { ok: false, detail: "读不到当前供应商的 Key（可能未保存或系统加密不可用）" };
  const file = path.join(os.homedir(), ".claude", "settings.json");
  const raw = await fs.readFile(file, "utf8").then((text) => JSON.parse(text)).catch(() => null);
  const current = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const env = current.env && typeof current.env === "object" ? (current.env as Record<string, unknown>) : {};
  const next = {
    ...current,
    env: {
      ...env,
      ANTHROPIC_BASE_URL: stripV1Suffix(baseUrl),
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
    },
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { ok: true, detail: `已写入 ${file}（Key 明文，仅本机）` };
}

/** 「全部同步」：Claude 走 settings.json，其余按各自方式重跑一遍自动同步。 */
export async function syncAllCliProviders(input: { apiKey: string }): Promise<{ ok: boolean; results: Array<{ name: string; ok: boolean; detail: string }> }> {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const custom = await readCustomModel().catch(() => null);
  const baseUrl = String(custom?.baseUrl ?? "").trim();
  const model = String(custom?.model ?? "").trim();
  const agents = await readCliAgents().catch(() => []);
  const hasClaude = agents.some((entry) => entry.enabled !== false && String(entry.bin).toLowerCase() === "claude");
  if (hasClaude && (await binOnPath("claude").catch(() => false))) {
    const r = await syncClaudeProvider({ baseUrl, model, apiKey: String(input?.apiKey ?? "") });
    results.push({ name: "Claude Code", ok: r.ok, detail: r.detail });
  }
  const r = await syncCliAgentProviderConfig();
  if (r.updated.length) results.push({ name: "配置文件同步", ok: true, detail: `已重写：${r.updated.join(" / ")}` });
  if (r.skipped.length) results.push({ name: "跳过", ok: true, detail: r.skipped.join(" / ") });
  return { ok: results.every((entry) => entry.ok), results };
}
