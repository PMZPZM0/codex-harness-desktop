/**
 * nuphus MCP 的**运行期环境变量**接线（唯一来源）。
 *
 * 背景（09-20 定位，用户报「视觉插件配置好了总是不生效」）：
 *   内置「视觉辅助插件」（设置 → 插件 → 内置插件）配好之后，走 `harness-media.mjs` 的
 *   `describe_image` 能用；但 nuphus 自带的 `desktop_vision` **一直硬报**
 *     `NUPHUS_MCP_VISION_API_KEY required: set this environment variable to your vision model API key (BYOK)`
 *   —— 因为 `[mcp_servers.nuphus]` 过去只写了 command / args / startup_timeout_sec，
 *   **从来没有 env 段**：插件里配的 baseUrl / apiKey / model 根本没进 nuphus 进程。
 *   取证：全仓 `NUPHUS_` 只有 `NUPHUS_BIN`、`NUPHUS_MCP_HUD`（都只给命令行兜底用）。
 *
 * ⛔ nuphus 0.2.3 的契约（从二进制实测字符串，不是文档推测）：
 *   NUPHUS_MCP_VISION_PROVIDER    ∈ `auto` | `openai` | `anthropic`（其它值直接报错拒绝）
 *   NUPHUS_MCP_VISION_API_KEY     非空
 *   NUPHUS_MCP_VISION_MODEL       非空（示例：gpt-4o-mini / qwen-vl-max / claude-sonnet-4-5）
 *   NUPHUS_MCP_VISION_BASE_URL    **必须 https**（http 只允许 localhost/127.0.0.1 测试端点）；默认 `https://api.openai.com/v1`
 *   NUPHUS_MCP_VISION_MAX_TOKENS  1..=32768（可选，不传走它自己的默认）
 *   协议：openai → `${BASE_URL}/chat/completions` + `Authorization: Bearer`，读回 `choices[].message`
 *   ⇒ 与内置视觉插件（OpenAI 兼容 /chat/completions + Bearer，见 harness-media.mjs）**同形**，
 *     所以 provider 固定 `openai`，不需要额外选项。
 *
 * ⛔ 引擎侧格式已实证（09-20 探针，独立 CODEX_HOME + 假 stdio MCP 把自己 env 落盘）：
 *   `[mcp_servers.<名>.env]` 子表被引擎正常解析，且变量**真的到达子进程**
 *   （4 个哨兵值全部命中，引擎 stderr 无 "Invalid configuration"）。
 *   别改成内联 `env = { ... }` 或别的写法 —— 现在这套是验过的。
 */

/** 内置视觉插件的配置形状（= userData/builtin-plugins.json 的 `vision` 段）。 */
export type VisionPluginConfig =
  | { enabled?: boolean; baseUrl?: string; apiKey?: string; model?: string }
  | undefined;

/** 内置视觉插件与 nuphus 都走 OpenAI 兼容协议，provider 恒定。 */
export const NUPHUS_VISION_PROVIDER = "openai";

/**
 * 视觉插件配置 → nuphus 进程需要的 `NUPHUS_MCP_VISION_*`。
 *
 * 返回**有序键值对**（调用方负责 TOML 转义与拼装），未配置 / 被停用时返回空数组
 * ⇒ 调用方整段 env 都不写（不要写一段半截的 env，那只会让 nuphus 报一句更难懂的错）。
 *
 * ⚠️ BASE_URL 不做「合规预筛」：nuphus 对非 https 的报错原文本身就点名了变量
 *    （`NUPHUS_MCP_VISION_BASE_URL must use https …: <值>`），比我们在这里悄悄丢掉、
 *    让它回落 `api.openai.com` 要好懂得多。
 */
export function nuphusVisionEnv(vision: VisionPluginConfig): Array<[string, string]> {
  if (!vision || vision.enabled === false) return [];
  const apiKey = String(vision.apiKey ?? "").trim();
  const model = String(vision.model ?? "").trim();
  const baseUrl = String(vision.baseUrl ?? "").trim();
  // 三项缺一即视为「没配好」：nuphus 侧同样要求三者齐全。
  if (!apiKey || !model || !baseUrl) return [];
  return [
    ["NUPHUS_MCP_VISION_PROVIDER", NUPHUS_VISION_PROVIDER],
    ["NUPHUS_MCP_VISION_API_KEY", apiKey],
    ["NUPHUS_MCP_VISION_MODEL", model],
    ["NUPHUS_MCP_VISION_BASE_URL", baseUrl],
  ];
}

/** config.toml 里承载上面这些变量的子表名（写出侧与漂移判定共用，别在两边各写一次字面量）。 */
export const NUPHUS_VISION_ENV_TABLE = "[mcp_servers.nuphus.env]";

/**
 * 「nuphus 视觉 env 是否需要重写 config.toml」——纯函数，预检直接跑行为断言。
 *
 * 为什么要独立一条漂移判据：env 段是修完「视觉插件不生效」之后才有的，而用户改插件里的
 * key / model 时，`developer_instructions` 的过期判据（`visionPlugin` 那个布尔）**完全不动**
 * ⇒ 不重写 ⇒ nuphus 仍拿着旧 key，用户看到的还是「配置好了不生效」。
 *
 * ⛔ 两个分支的判据**必须不同**（09-20 代码审查抓到的真缺口）：
 *   · 需要 env 时**带注册前提**：nuphus 没注册我们本来就不写，不加前提会恒判漂移
 *     ⇒ 每次启动整份重写 config.toml（09-16 踩过这类事故）。
 *   · 不需要 env 时**不带前提**：TOML 里 `[mcp_servers.X.env]` 会**隐式创建** `mcp_servers.X`
 *     表 ⇒ 残留一个没有 command 的空服务器段；而「从不重写」会让它永远留下来。
 *     这条分支必然收敛：重写一次该段就被 `preserveUserConfig` 丢掉（已实测），下次不再命中。
 */
export function nuphusVisionEnvDrift(opts: {
  vision: VisionPluginConfig;
  /** nuphus 当前是否会被注册（= shouldRegisterNuphus + 二进制存在 + 覆盖表启用，与写出侧同源） */
  registered: boolean;
  /** 现有 config.toml 全文 */
  configText: string;
  /** TOML 字符串转义：由调用方注入（与写出侧用**同一个**实现，否则判定永远对不上） */
  escape: (value: string) => string;
}): boolean {
  const wanted = nuphusVisionEnv(opts.vision);
  if (wanted.length) {
    if (!opts.registered) return false;
    return !wanted.every(([key, value]) => opts.configText.includes(`${key} = "${opts.escape(value)}"`));
  }
  return opts.configText.includes(NUPHUS_VISION_ENV_TABLE);
}
