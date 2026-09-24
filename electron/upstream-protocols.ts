/**
 * 上游协议表（叶子模块，2026-09-24 断环用）。
 *
 * 原在 main.ts：`upstreamProtocols` Map + `normalizeUpstreamProtocol` + `syncUpstreamProtocols`。
 * `bridgeDial`（main.ts）读这张表、`main/01-model-catalog.ts` 写这张表 ⇒ 两边都曾反向依赖 main.ts。
 * 抽成叶子模块后双向都变成正向依赖，环断。
 *
 * 语义与原实现逐字一致：BridgeMode 三态（chat / responses / anthropic），其余一律回落 "auto"。
 */
export type BridgeMode = "auto" | "chat" | "responses" | "anthropic";

export const upstreamProtocols = new Map<string, BridgeMode>();

export function normalizeUpstreamProtocol(value: unknown): BridgeMode {
  return value === "chat" || value === "responses" || value === "anthropic" ? value : "auto";
}

/** 用模型档案刷新协议表（写模型 / 切模型后调用）。 */
export function syncUpstreamProtocols(list: { provider?: string; upstreamProtocol?: unknown }[]) {
  upstreamProtocols.clear();
  for (const entry of list) {
    if (entry?.provider) upstreamProtocols.set(entry.provider, normalizeUpstreamProtocol(entry.upstreamProtocol));
  }
}
