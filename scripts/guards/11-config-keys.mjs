/**
 * 预检守卫组：11-config-keys —— config.toml 顶层键的所有权闭环。
 *
 * 为什么单独成组：这类事故**整份配置废掉**（引擎 `Invalid configuration; using defaults`
 * ⇒ 供应商/模型全丢 = 应用不可用），是最高危的一类；且它与渲染层/行为无关，放 06 里
 * 语义不搭。2026-09-28 一天之内被用户现场抓到两次（unrecognized key、duplicate key），
 * 故独立成组并写成**结构性判据**（不是逐键硬编码）。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, codeOnly, join, ok, fail, readFileSync } from "./_ctx.mjs";

export async function run() {
  console.log(C.bold("\n【190】config.toml 顶层键所有权闭环"));

  const applySrc = readFileSync(join(ROOT, "electron", "features", "custom-model-apply.ts"), "utf8");
  const tomlSrc = readFileSync(join(ROOT, "electron", "config-toml.ts"), "utf8");
  const bootSrc = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");

  /* ① 白名单完整性 —— 事故链的核心：写入器写顶层新键但没登记 ⇒ 旧值被当「用户键」保留
        ⇒ 同名键两次 ⇒ duplicate key ⇒ 整份配置废掉。
        判据 = 结构性检查「写入器会写的顶层键 ∈ HARNESS_CONFIG_KEYS」。 */
  const registered = new Set(
    [...tomlSrc.matchAll(/HARNESS_CONFIG_KEYS = new Set\(\[([\s\S]*?)\]\)/g)]
      .flatMap((m) => [...m[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((k) => k[1])),
  );
  (registered.size > 5 ? ok : fail)(
    `【190】HARNESS_CONFIG_KEYS 白名单可解析（拿到 ${registered.size} 个键）`
  );
  const writtenTopLevel = [
    "model", "model_provider", "preferred_auth_method", "model_reasoning_effort",
    "model_catalog_json", "model_auto_compact_token_limit", "model_max_output_tokens",
    "model_context_window",
  ].filter((key) => applySrc.includes(key));
  const unregistered = writtenTopLevel.filter((key) => !registered.has(key));
  (unregistered.length === 0 ? ok : fail)(
    `【190】写入器写的每个顶层键都在白名单里（漏登记 ⇒ duplicate key ⇒ 整份配置废掉）`
    + (unregistered.length ? `：缺失 ${unregistered.join(" / ")}` : "")
  );

  /* ② 非法枚举护栏 —— 0.157.1 顶层 `_scope` 只认 total / body_after_prefix。
        写 "model"（旧 provider 段语义）会让**整份配置**解析失败 = 供应商全丢（09-28 现场实证）。 */
  (!/model_auto_compact_token_limit_scope = "model"/.test(applySrc) ? ok : fail)(
    '【190】写入器不在顶层写 _scope = "model"（非法枚举 ⇒ Invalid configuration 整份弃用）'
  );

  /* ③ 压缩阈值只能进 catalog，不许回顶层 —— 11-09 用户令「自动压缩用引擎原生的、改 config 阈值」。
        11-09 隔离探针（0.167.0）实测：catalog 每个模型的 `auto_compact_token_limit` 引擎认；
        **顶层一旦存在就盖掉逐模型值**（顶层 9000000 + 目录 2000 ⇒ 不压）。⇒ 顶层必须为空，
        阈值由 buildModelCatalog 按「该模型窗口 × 比例」写进每个条目。 */
  const applyCode = codeOnly(applySrc);
  (!/model_auto_compact_token_limit\s*=/.test(applyCode) ? ok : fail)(
    "【190】config.toml 顶层不再写自动压缩阈值（顶层会盖掉 catalog 的逐模型值 ⇒ 小窗口模型永远不压）"
  );
  const probeCode = codeOnly(readFileSync(join(ROOT, "electron", "features", "custom-model-probe.ts"), "utf8"));
  (/auto_compact_token_limit:\s*Math\.round\(contextWindow \* compactRatio\)/.test(probeCode) ? ok : fail)(
    "【190】压缩阈值写进 catalog 每个模型（= 该模型 context_window × 设置页比例）"
  );
  const catalogSrc = readFileSync(join(ROOT, "electron", "main", "01-model-catalog.ts"), "utf8");
  (/writeModelCatalogToml\(entry: CustomModelFile, compactRatio\?: number\)/.test(catalogSrc)
    && /buildModelCatalog\(candidate, ratio\)/.test(catalogSrc) ? ok : fail)(
    "【190】catalog 写入器把归一后的比例传进构建器（启动自愈那条路省略时当场读设置）"
  );

  /* ④ 启动自愈必须能把存量坏配置收敛 —— 11-09 起判据反过来：顶层**出现**这些键即残留
        （老版本写过；preserveUserConfig 会丢弃，整份重写一次即收敛）。判据锚「逐行扫 TOML 段位置」，
        不用缩进（⛔ 首版用缩进判定，TOML 段内键本就不缩进 ⇒ 误判 0 残留，已实测踩过）。 */
  (/inTable\s*=\s*true/.test(bootSrc) && /compactKeyResidue = \(\(\) =>/.test(bootSrc) ? ok : fail)(
    "【190】自愈判据按 TOML 段位置逐行扫描（不用缩进区分 —— 段内键不缩进，会误判）"
  );
  (!/topLevelCompactSeen/.test(bootSrc) ? ok : fail)(
    "【190】自愈判据不再要求「顶层必须有阈值」（11-09 起恰好相反：出现即残留）"
  );
  // 11-14：重写条件末尾新增 reaMcpBad ⇒ 旧「compactKeyResidue 紧跟右括号」判据假红。
  // 改为直接验它在 if 条件表达式里（只算不接仍然红）。
  (/if \([^)]*compactKeyResidue[^)]*\)/.test(bootSrc) ? ok : fail)(
    "【190】残留判据真的接进了重写条件（只算不接 = 恒不做）"
  );
  /* ⛔ 坏形态的覆盖面要锚在**判定正则本身**（不是注释）：11-09 起 scope / 顶层阈值都归「残留」，
     判定式是 `model_auto_compact_token_limit(_scope)?\s*=` —— 少掉 `(_scope)?` 就漏掉 scope 坏形态。 */
  (/model_auto_compact_token_limit\(_scope\)\?/.test(bootSrc) ? ok : fail)(
    "【190】自愈覆盖已知坏形态之一：顶层 scope=model（判定正则带 (_scope)?）"
  );
  (/model_max_output_tokens/.test(bootSrc) ? ok : fail)(
    "【190】自愈覆盖已知坏形态之二：顶层 max_output（0.157.1 已忽略该键）"
  );
}
