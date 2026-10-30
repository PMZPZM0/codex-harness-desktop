/**
 * 引擎 provider id 的**保留名**处理（独立模块：主进程、渠道机器人、团队服务都要用；
 * 放在 main.ts 里会让它们循环依赖）。
 *
 * 背景（09-19 真实用户事故）：把供应商 id 存成 `openai` 会写出 `[model_providers.openai]`，
 * 引擎**整份拒绝加载 config.toml**：
 *   `model_providers contains reserved built-in provider IDs: \`openai\`.
 *    Built-in providers cannot be overridden.`
 * 症状是"发消息就报错"，且**与用哪个模型无关**（配 DeepSeek 官网也照样挂）——
 * 因为坏的是配置文件本身，不是模型。
 */

/** 引擎内置保留、不允许覆盖的 provider id（引擎报错原文里点名 `openai`）。 */
export const RESERVED_PROVIDER_IDS = new Set(["openai"]);

/** 统一内置通道的 provider id：config.toml 顶层恒写它，切供应商不需要会话迁移。
 *  与渲染层 `src/lib/provider-continuity.mjs` 的 HARNESS_PROVIDER_ID 同源（两套进程各自的常量）。 */
export const HARNESS_PROVIDER_ID = "harness";

/** 新建会话时给引擎的 provider 绑定（与桌面端 providerConfig 同口径）。
 *
 *  ⛔⛔ 10-30 用户实测「手机首页直接发消息会失败」的根因：手机建会话时传的是**原始供应商 id**
 *    （如 `custom964`），而引擎当前生效 provider 是统一的 `harness` ⇒ 第一轮 `turn/start` 被拒：
 *    `This chat uses custom964, but your current provider is harness`。
 *    ⛔ 一律绑 HARNESS_PROVIDER_ID + 内联该会话的上游配置；官方订阅是伪供应商，什么都不传
 *    （引擎走内置 openai + ChatGPT 登录凭据，任何内联 provider 定义都会触发密钥校验报错）。 */
export function harnessProviderConfig(model: { name?: string; baseUrl?: string; provider?: string } | null | undefined) {
  if (!model || model.provider === "openai-official") return {} as Record<string, unknown>;
  return {
    modelProvider: HARNESS_PROVIDER_ID,
    config: {
      model_provider: HARNESS_PROVIDER_ID,
      model_providers: {
        [HARNESS_PROVIDER_ID]: {
          name: model.name || HARNESS_PROVIDER_ID,
          base_url: model.baseUrl || "",
          env_key: "CODEX_HARNESS_API_KEY",
          wire_api: "responses",
          requires_openai_auth: false,
        },
      },
    },
  } as Record<string, unknown>;
}

/** 把保留 id 迁到安全 id（`openai` → `openai-custom`，正是引擎报错里建议的写法）。
 *  幂等：非保留 id 原样返回。所有"把 id 写进引擎配置"的地方都必须先过这个函数。 */
export function safeProviderId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  return RESERVED_PROVIDER_IDS.has(raw.toLowerCase()) ? `${raw}-custom` : raw;
}

/** 删掉 config.toml 文本里**保留 id** 的 provider 段（整段连表头一起删）。
 *  用于启动自愈：旧版本已经写坏的配置必须清掉，否则引擎永远拒载。 */
export function stripReservedProviderTables(text: string): string {
  const lines = String(text ?? "").split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const head = line.match(/^\s*\[\[?\s*model_providers\.([A-Za-z0-9_-]+)/);
    if (head) {
      skipping = RESERVED_PROVIDER_IDS.has(head[1].toLowerCase());
      if (skipping) continue;
    } else if (skipping && /^\s*\[/.test(line)) {
      skipping = false;   // 走到下一个段头 → 不再跳过
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}
