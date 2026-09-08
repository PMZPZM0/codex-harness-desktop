import { defaultUrlTransform } from "react-markdown";

// 只为 img 放行栅格图片，不放开链接或 HTML/SVG data URL。
export function markdownUrlTransform(url: string, key: string, node: { tagName: string }) {
  if (node.tagName === "img" && key === "src" && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(url)) return url;
  return defaultUrlTransform(url);
}
