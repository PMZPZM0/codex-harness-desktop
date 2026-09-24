/**
 * OpenaiSubscriptionPage 的「usage-parsers」部分（09-22 从同目录 OpenaiSubscriptionPage.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
export function parseOpenaiUsagePanel(data: any): { planType: string; windows: { label: string; usedPercent: number; resetAt?: number; windowSeconds?: number }[]; limitReached: boolean } {
  const rate = data?.rate_limit ?? data;
  const windows: { label: string; usedPercent: number; resetAt?: number; windowSeconds?: number }[] = [];
  for (const key of ["primary_window", "secondary_window", "tertiary_window"]) {
    const win = rate?.[key];
    if (win && typeof win.used_percent === "number") {
      windows.push({
        label: openaiWindowLabel(win.limit_window_seconds),
        usedPercent: Math.min(100, Math.max(0, win.used_percent)),
        resetAt: Number(win.reset_at) || undefined,
        windowSeconds: Number(win.limit_window_seconds) || undefined,
      });
    }
  }
  return { planType: String(data?.plan_type ?? "plus").toUpperCase(), windows, limitReached: Boolean(rate?.limit_reached) };
}

export function openaiResetText(resetAt: number | undefined, now: number): string {
  if (!resetAt) return "";
  const diff = resetAt * 1000 - now;
  if (diff <= 0) return "已重置";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const clock = new Date(resetAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return h > 0 ? `${h} 小时 ${m} 分后重置（${clock}）` : `${m} 分后重置（${clock}）`;
}

export function extractQuotaBars(data: any): { label: string; value: number }[] {
  const bars: { label: string; value: number }[] = [];
  const walk = (node: any, context: string, depth: number) => {
    if (node == null || typeof node !== "object" || depth > 4 || bars.length >= 5) return;
    for (const [key, value] of Object.entries(node)) {
      if (bars.length >= 5) return;
      // 官方窗口结构：{ used_percent, limit_window_seconds } → 用友好窗口名（5 小时窗口/本周窗口）
      if (typeof value === "object" && value && typeof (value as any).used_percent === "number") {
        bars.push({ label: openaiWindowLabel((value as any).limit_window_seconds), value: (value as any).used_percent });
      } else if (typeof value === "number" && /percent/i.test(key) && value >= 0 && value <= 100) {
        bars.push({ label: (context ? context + " · " : "") + String(key).replace(/_/g, " "), value: value });
      } else if (typeof value === "object") {
        walk(value, /percent|ratio|window/i.test(key) ? context : String(key).replace(/_/g, " "), depth + 1);
      }
    }
  };
  walk(data, "", 0);
  return bars;
}

function openaiWindowLabel(seconds?: number): string {
  if (seconds === 604800) return "本周窗口";
  if (seconds === 18000) return "5 小时窗口";
  if (seconds) return `${Math.round(seconds / 3600)} 小时窗口`;
  return "额度窗口";
}
