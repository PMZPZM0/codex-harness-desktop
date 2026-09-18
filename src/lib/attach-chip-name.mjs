// 用户消息附件 chip 的显示名：图片 part 有三种形态（path / data URL / http URL），
// 显示名必须**永远像文件名**，绝不能把 base64 尾巴当名字。
// 纯函数、零依赖，供 scripts/check-preflight.mjs 离线断言。

/** 取路径最后一段（自带一份实现，避免把 App.tsx 内部的 basename 抽出来牵动大量调用点）。 */
function lastSegment(value) {
  return String(value ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
}

/**
 * @param part 图片 part（可能有 path 字段）
 * @param src  imagePartSrc(part) 的结果（可能是 data:... / http(s)://... / 本地路径）
 * @returns 用于 chip 显示的名字
 */
export function attachChipName(part, src) {
  const s = String(src ?? "");
  // ① 首选 part.path：有它说明这是本地文件形态，basename 一定有意义
  const fromPath = lastSegment(part?.path);
  if (fromPath && !fromPath.startsWith("data:")) return fromPath;
  // ② data URL：没有文件名可言 —— ⛔ 绝不能对它取 basename
  //    （实测 `basename(dataUrl)` 会返回 `q842iQAAAABJRU5ErkJggg==` 这种 base64 尾巴）
  if (s.startsWith("data:")) return "粘贴的图片";
  // ③ http(s) URL：取末段并剥掉 query/hash
  if (/^https?:\/\//i.test(s)) {
    const seg = lastSegment(s.split(/[?#]/)[0]);
    return seg || "图片";
  }
  // ④ 本地路径（含 file:// 与 Windows 盘符）
  const fromSrc = lastSegment(s.replace(/^file:\/\//i, ""));
  if (fromSrc && !fromSrc.startsWith("data:")) return fromSrc;
  return "图片";
}
