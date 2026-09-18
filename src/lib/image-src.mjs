// 图片"显示用 src"的归一化：把本地路径 / data URL / http(s) URL / 已有协议 URL
// 统一成浏览器能直接加载的 src。
// 纯函数、零依赖，供 scripts/check-preflight.mjs 离线断言。
//
// ⛔ 为什么要独立成模块（09-18 代码审查发现）：原先三处都写
//    `path.startsWith("http") ? path : imageUrl(path)`，于是 **data URL 会被当成本地
//    路径**去拼 `harness-image://`，主进程按文件名找不到文件 → 返回占位图 →
//    「预览打不开」（粘贴的图片正是 data URL 形态，引擎回读的 part 也可能是 data URL）。

/** 本地图片的自定义协议 URL 前缀。 */
export const LOCAL_IMAGE_SCHEME = "harness-image://local?path=";

/** 本地路径 → 自定义协议 URL。
 *  ⛔ 必须双重编码：Chromium 对自定义协议 URL 会自行解一层 percent 编码，路径里的 %5C
 *  （反斜杠）被还原成 \ 后在协议层丢失（实测 decoded 变成 C:UsersAdministrator… →
 *  existsSync false → 主进程返回 1x1 透明占位 → 用户看到「透明的图」）。
 *  双编码保证 handler 至少还剩一层可解。**这段逻辑不能改成单编码。** */
export function localImageUrl(path) {
  return `${LOCAL_IMAGE_SCHEME}${encodeURIComponent(encodeURIComponent(String(path ?? "")))}`;
}

/** 任意图片来源 → 可直接放进 <img src> / 灯箱的 src。
 *  已是 data:/blob:/http(s):/harness-image: 的原样返回；其余（本地路径）走协议 URL。 */
export function imageDisplaySrc(source) {
  const s = String(source ?? "");
  if (!s) return "";
  if (/^(data:|blob:|https?:|harness-image:)/i.test(s)) return s;
  return localImageUrl(s);
}
