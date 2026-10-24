import { defaultUrlTransform } from "react-markdown";

// 只为 img 放行栅格图片与内置贴纸（bubu://），不放开链接或 HTML/SVG data URL。
export function markdownUrlTransform(url: string, key: string, node: { tagName: string }) {
  if (node.tagName === "img" && key === "src" && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(url)) return url;
  // 一二布布表情包：`bubu://<id>`（Markdown 渲染层再解析成内置资源；未知 id 渲染层回退 alt 文本）
  if (node.tagName === "img" && key === "src" && /^bubu:\/\/[a-z-]+$/i.test(url)) return url;
  return defaultUrlTransform(url);
}
