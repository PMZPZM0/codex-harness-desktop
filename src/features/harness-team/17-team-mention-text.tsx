/**
 * 群消息正文里的 @ 提及渲染（11-07 用户令：「所有艾特统一改为真实艾特」）。
 *
 * ⛔⛔ 用户原话：「消息开头的一处艾特需显示为真实艾特，其余位置出现的艾特均为假艾特且被重复展示；
 *    请将所有艾特统一改为真实艾特……多个艾特按出现顺序依次解析并逐一渲染，不可一次性全部输出或错乱顺序」。
 *
 * 旧实现在两处各走一半，截图上就是那个样子：
 *   · 用户消息：`mentions` 渲染成一排**前缀 chip**，正文里的 `@承枢` 又原样被 Markdown 画出来
 *     ⇒ 同一条消息出现两个「@承枢」（一真一假）；
 *   · 伙伴回复：正文里的 `@问需：` 只是纯文字（不可点、没头像）。
 *
 * ⇒ 唯一口径：**只从正文出**。`linkifyMentions`（纯函数，有真值表单测）按出现顺序把每个
 *    `@名字` 换成 Markdown 链接，这里再把链接画成「头像 + 用户名」的胶囊。
 *    ⛔ 不再单独渲染 `mentions` 前缀（那必然重复）；⛔ 不在视图里手写正则。
 *    ⛔ 头像是按 id 取**真身**（群主 ⇒ 用户中心头像与真名；成员 ⇒ 智能体头像），不是首字圆圈。
 */
import type { ReactNode } from "react";
import { Markdown, MD_COMPONENTS, MentionScopeContext } from "../markdown";
import { linkifyMentions, mentionIdOfHref } from "../../lib/team-mention-render.mjs";
import { MemberAvatar } from "./13-team-avatar";

/** 画头像用的成员形状（`03` 的 faceOf/faceOfId 产物同形）。 */
export type MentionFace = {
  id: string;
  kind?: string;
  name?: string;
  targetKind?: string;
  targetKey?: string;
};

/** 一枚「头像 + 名字」的提及胶囊。
 *  ⛔ 群消息正文、引用行、以及 Markdown 作用域（成员互 @）**共用这一个实现** ——
 *    用户 11-09：「成员之间相互艾特也要有我艾特他们一样得效果」。⛔ 别再各画一套。 */
export function TeamMentionChip({ id, name, faceOfId, onPick, size = 16 }: {
  id: string;
  name: string;
  faceOfId: (id: string) => MentionFace;
  onPick: (id: string) => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      className="team-at"
      title={`@${name} · 点一下加进本轮 @`}
      onClick={(event) => { event.preventDefault(); onPick(id); }}
    >
      <MemberAvatar member={faceOfId(id)} size={size} className="team-at__avatar" />
      <span className="team-at__name">{name}</span>
    </button>
  );
}

/** 把正文里的 @ 名字渲染成 chip（可点开资料），不是简单字符串。 */
export function TeamMentionText({
  text,
  candidates,
  faceOfId,
  nameOf,
  onPick,
  excludeId,
  className = "markdown team-msg__body-text",
}: {
  /** 原始正文（已剥播报稿） */
  text: string;
  /** @ 候选：`{ id, name }`（群成员 + 团成员 + 群主） */
  candidates: { id: string; name: string }[];
  /** 按 id 取画头像用的成员 */
  faceOfId: (id: string) => MentionFace;
  /** 按 id 取用户名（群主 = 用户中心真名） */
  nameOf: (id: string) => string;
  /** 点一下提及 = 加进本轮 @（⛔ 不自动派活） */
  onPick: (id: string) => void;
  /** 不把自己 @ 自己算成提及 */
  excludeId?: string;
  className?: string;
}): ReactNode {
  /* ⛔ 不 memo：闭包要拿到**本次渲染**的成员/目录（memo 住旧闭包会把提及指向旧对象）。 */
  const components = {
    ...MD_COMPONENTS,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const id = mentionIdOfHref(href);
      if (!id) {
        /* 普通链接保持主对话同一行为（⛔ 不要因为群聊覆盖了 a 就让外链失效）。 */
        return (
          <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.codex.openExternal(href); }}>
            {children}
          </a>
        );
      }
      const name = nameOf(id) || String(children ?? "").replace(/^@/, "");
      return <TeamMentionChip id={id} name={name} faceOfId={faceOfId} onPick={onPick} />;
    },
  };
  return (
    <div className={className}>
      {/* ⛔⛔ 本组件**自己已经 linkify 过**，必须把外层的提及作用域屏蔽掉：
          否则 Markdown 会再 linkify 一遍，把 `[@观澜](#tm-x)` 套成两层链接（渲染成乱码）。 */}
      <MentionScopeContext.Provider value={null}>
        <Markdown components={components}>{linkifyMentions(text, candidates, { excludeId })}</Markdown>
      </MentionScopeContext.Provider>
    </div>
  );
}
