/** isImagePath（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function isImagePath(path: string) {
  const lower = path.toLowerCase();
  return imageExts.has(lower.slice(lower.lastIndexOf(".")));
}

const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);
