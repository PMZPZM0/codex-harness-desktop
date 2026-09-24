/** resolveImagePath（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function resolveImagePath(input: string): string | null {
  if (!input) return null;
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
