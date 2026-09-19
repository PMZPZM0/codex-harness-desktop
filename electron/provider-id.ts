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
