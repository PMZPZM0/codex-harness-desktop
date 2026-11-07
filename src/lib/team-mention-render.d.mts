/** `team-mention-render.mjs` 的类型声明（⛔ 规则只在 .mjs 里，这里只描述形状）。 */

export interface MentionCandidate {
  id: string;
  name: string;
}

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; id: string; name: string; raw: string };

/** 正文 → 文本段 / 提及段（严格按出现顺序）。 */
export function splitMentionSegments(
  text: string,
  candidates: MentionCandidate[],
  options?: { excludeId?: string },
): MentionSegment[];

/** 正文 → 把 `@名字` 改写成 Markdown 链接（渲染层据此画成带头像的提及）。 */
export function linkifyMentions(
  text: string,
  candidates: MentionCandidate[],
  options?: { excludeId?: string },
): string;

/** 提及链接的 href → 目标 id（不是提及链接返回空串）。 */
export function mentionIdOfHref(href: string | undefined | null): string;
