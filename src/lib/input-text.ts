/** inputText（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { isImagePart } from "./prompt-images";

export function inputText(input: any[]) {
  return input.filter((part) => part.type === "text").map((part) => part.text).join("\n") || `${input.filter(isImagePart).length} 个图片附件`;
}
