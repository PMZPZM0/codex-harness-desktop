/** 输入框附件占位符（图片 / 文件）的公共机制。 */
export const ATTACHMENT_IMAGE: "image";
export const ATTACHMENT_FILE: "file";

export type AttachmentKind = "image" | "file";
export type AttachmentSegment =
  | { kind: "text"; text: string }
  | { kind: "image" | "file"; path: string };

export function attachmentToken(kind: AttachmentKind, path: unknown): string;
export function imageToken(path: unknown): string;
export function fileToken(path: unknown): string;
export function splitAttachmentSegments(
  text: unknown,
  options?: { kinds?: AttachmentKind[] },
): AttachmentSegment[];
export function attachmentPaths(text: unknown, kind: AttachmentKind): string[];
export function promptImagePaths(text: unknown): string[];
export function promptFilePaths(text: unknown): string[];
export function stripAttachmentTokens(text: unknown, kinds?: AttachmentKind[]): string;
export function insertAttachmentToken(
  text: unknown,
  start: number,
  end: number,
  token: string,
): { text: string; caret: number };
export function removeAttachmentToken(text: unknown, kind: AttachmentKind, path: unknown): string;

/** 粘贴文本超过这个字数就转成 .txt 文件 chip（默认 200）。 */
export const PASTED_TEXT_TO_FILE_THRESHOLD: number;
export function shouldSavePastedTextAsFile(text: unknown, threshold?: number): boolean;
