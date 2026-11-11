/** resolveImagePath（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function resolveImagePath(input: string): string | null {
  if (!input) return null;
  /* 11-11：引擎图片 part 可能是 file:///D:/… 形态，先还原成本地路径（灯箱的「打开位置 / 复制」要用）。 */
  if (/^file:/i.test(input)) {
    let p = input.replace(/^file:\/\//i, "").replace(/^file:\//i, "");
    if (/^localhost\//i.test(p)) p = p.slice("localhost/".length);
    try { p = decodeURIComponent(p); } catch { return null; }
    if (/^\/[a-zA-Z]:[\\/]/.test(p)) p = p.slice(1);
    return p || null;
  }
  if (input.startsWith("harness-image://")) {
    try {
      let p = new URL(input).searchParams.get("path") ?? "";
      // URLSearchParams 已解一层；双编码的 path 还剩一层（%5C 等）
      if (!/^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith("/")) { try { p = decodeURIComponent(p); } catch { return null; } }
      return p || null;
    } catch { return null; }
  }
  if (/^[a-zA-Z]:[\\/]/.test(input) || input.startsWith("/")) return input;
  return null;
}
