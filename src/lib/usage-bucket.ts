/** usageBucket（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function usageBucket(tokenUsage: any, scope: "last" | "total") {
  if (!tokenUsage) return null;
  const camel = scope === "last" ? "lastTokenUsage" : "totalTokenUsage";
  const snake = scope === "last" ? "last_token_usage" : "total_token_usage";
  return tokenUsage?.[scope] ?? tokenUsage?.[camel] ?? tokenUsage?.[snake] ?? tokenUsage?.info?.[snake] ?? null;
}
