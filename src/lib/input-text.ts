/** inputText（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { isImagePart } from "./prompt-images";

/** 从一条消息的 parts 拼出纯文本；只有图片时返回「N 个图片附件」，用于列表/标题展示。 */
export function inputText(input: any[]) {
  return input.filter((part) => part.type === "text").map((part) => part.text).join("\n") || `${input.filter(isImagePart).length} 个图片附件`;
}
