/**
 * isMacPlatform（从 src/App.tsx 原样搬来，实现未改）。
 * 搬到 lib：本域与 App 其它地方都要用，不能一边一份。
 */


export function isMacPlatform(): boolean {
  const fromPreload = (window as unknown as { codex?: { platform?: string } })?.codex?.platform;
  if (typeof fromPreload === "string" && fromPreload) return fromPreload === "darwin";
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");
}
