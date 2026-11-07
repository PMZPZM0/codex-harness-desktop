/** 消息发送者身份 · 单一真相源（见 message-origin.mjs） */

export type SenderKind = "user" | "supervisor" | "automation" | "member" | "system";

export type Sender = {
  kind: SenderKind;
  id: string;
  name: string;
  label: string;
  isUser: boolean;
  isSuperior: boolean;
};

export type SenderInput = {
  kind?: string;
  id?: string;
  name?: string;
  [key: string]: unknown;
};

export type DispatchContext = {
  source?: string;
  name?: string;
  callerName?: string;
  supervisor?: string;
  originThreadId?: string;
  [key: string]: unknown;
};

export const SENDER_KINDS: SenderKind[];
export function senderLabelOf(raw: unknown): string;
export function normalizeSender(raw: unknown): Sender;
export function senderFromDispatch(input?: DispatchContext): Sender;
export function senderLineOf(raw: unknown): string;
export function taskLineOf(raw: unknown, query: unknown): string;
export function parseSenderFromText(text: unknown): Sender | null;
export function stripSenderMeta(text: unknown): string;
export const OLD_TASK_LABEL: RegExp;
