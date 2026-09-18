// 输入框内联图片占位符解析：把 prompt 里的 [图片:<path>] 标记拆成文本段 + 图片段。
// 设计对齐 WorkBuddy：图片 chip 内联在文字光标处，粘贴在哪就出现在哪。
// 纯函数，供输入框覆盖层渲染与发送管线共用。
//
// ⛔ 09-18 起 token 格式与解析**统一由 composer-attachments.mjs 实现**（那里同时管图片与文件）。
//    本文件只做转发，保留图片专用的窄 API 供消息渲染层使用。别再在这里另写一份正则 ——
//    两份解析必然漂移，症状是"图片正常、文件时灵时不灵"且无任何报错。
import {
  ATTACHMENT_IMAGE,
  attachmentToken,
  promptImagePaths as sharedPromptImagePaths,
  splitAttachmentSegments,
  stripAttachmentTokens,
} from "./composer-attachments.mjs";

// ⛔ 09-18 删掉了两个**历史死代码**：`insertImageToken` / `removeImageToken`。
//    它们是"输入框里自己插/删图片 token"时代的遗留，实际调用点早已换到
//    `insertComposerAttachments`（往 contentEditable 插 chip）+ `serializeComposerDom`
//    （从 DOM 反解 token）——`git grep` 全仓零调用点。留着只会让人以为还有第二条插入路径。
//    当前需要插附件走 composer-attachments.mjs 的 attachmentToken。

/** 占位符格式：[图片:路径]。路径经 encodeURIComponent 编码以容忍空格/中文。 */
export function imageToken(path: string) {
  return attachmentToken(ATTACHMENT_IMAGE, path);
}

export type PromptSegment = { kind: "text"; text: string } | { kind: "image"; path: string };

/** 把含占位符的 prompt 拆成有序段；未知格式（含 `[文件:…]`）原样保留为文本。 */
export function splitPromptSegments(prompt: string): PromptSegment[] {
  return splitAttachmentSegments(prompt, { kinds: [ATTACHMENT_IMAGE] }) as PromptSegment[];
}

/** prompt 中出现过的全部图片路径（按出现顺序去重）。 */
export function promptImagePaths(prompt: string): string[] {
  return sharedPromptImagePaths(prompt);
}

/** 发送用：从文本中剥离占位符标记（图片已按位置单独取出），并清理多余空行。 */
export function stripImageTokens(prompt: string) {
  return stripAttachmentTokens(prompt, [ATTACHMENT_IMAGE]);
}

/**
 * 图片 part 类型归一：宿主发送时构造的是 `localImage`（驼峰），但引擎事件/回读里的
 * 同一个 part 会变成 `local_image`（下划线）；粘贴的 data URL 图则是 `image` + image_url。
 * 三种形态都必须识别，否则服务端消息替换乐观气泡后图片「凭空消失」（09-08 实测反馈）。
 */
export function isImagePart(part: any): boolean {
  return part?.type === "localImage" || part?.type === "local_image" || part?.type === "image";
}

/** 图片 part 的显示来源：path（本地文件）或 url（data:/http URL）。 */
export function imagePartSrc(part: any): string | undefined {
  if (part?.type === "image") return part?.image_url ?? part?.url;
  return part?.path;
}

/**
 * 编辑重发/排队重发时把引擎回传的图片 part 归一化回宿主发送形态：
 * path 型统一回 localImage（宿主验证过的发送格式），data URL 型保留 image + image_url
 * （引擎输入接受 input_image data URL，rollout 实证）。非图片 part 返回 null。
 */
export function normalizeImagePartForSend(part: any): any | null {
  if (!isImagePart(part)) return null;
  if (part.type === "image") return { type: "image", image_url: part.image_url ?? part.url };
  return part.path ? { type: "localImage", path: part.path } : null;
}
