/**
 * 工作伙伴 · 用户消息气泡下的运行反馈（11-08 用户令）
 *
 * 「过程模式，要跟主对话框那样，用户发出去消息，codex 就要出来效果」
 * 「占位模式，为啥我发出去消息，下面没有飞书那种表情 + 成员名字的小图标」
 *
 * ⛔⛔ 之前两种模式的 JSX 都挂在 `live` 流式卡里，而独立窗口里 `live` 常年为空
 *    ⇒ 用户发完消息什么都不出现，两种模式「完全一样没有区别」。
 *    ⇒ 反馈改挂到**用户自己的消息气泡下面**（用户明确要的位置），由 `busy` 名单驱动
 *      （派活一发出就有，跨窗口可靠）；`live` 只作为 threadId 的补充来源。
 *
 * 两种模式：
 *   · process —— 复用主对话同一套 `TeamProcess` 折叠块（默认折叠、可展开看每一步），
 *     ⛔ 不另写一套过程渲染；每位在跑的伙伴一张，跑完整块消失，只留上屏的汇报。
 *   · placeholder —— 飞书式「头像 + 名字 + 处理中」小图标，一行一个/横向排开，
 *     产出上屏后消失。
 *
 * 独立板块：视图只接线（谁在跑 / 名字 / 头像 / threadId 都由调用方给）。
 */
import type { LiveRun } from "./02-team-store";
import { MemberAvatar } from "./13-team-avatar";
import { TeamProcess } from "./09-team-process";

export type RunningPartner = {
  memberId: string;
  name: string;
  threadId?: string;
  startedAt?: number;
};

type Face = { id: string; kind?: string; name?: string; targetKind?: string; targetKey?: string; avatar?: string };

export type RunFeedbackProps = {
  mode: "process" | "placeholder";
  partners: RunningPartner[];
  faceOfId: (id: string) => Face;
  live?: LiveRun[];
};

/** 过程模式：每位在跑的伙伴一张主对话同款折叠块（有 threadId 才画，没拿到就只显示名字）。 */
function ProcessFeedback({ partners, faceOfId }: Pick<RunFeedbackProps, "partners" | "faceOfId">) {
  return (
    <div className="team-run-feedback is-process" aria-live="polite">
      {partners.map((p) => (
        <div className="team-run-feedback__row" key={p.memberId}>
          <div className="team-run-feedback__who">
            <MemberAvatar member={faceOfId(p.memberId)} size={16} className="team-run-feedback__avatar" />
            <strong>{p.name}</strong>
            <em>运行中</em>
          </div>
          {p.threadId ? (
            <TeamProcess threadId={p.threadId} at={p.startedAt ?? 0} bodyText="" running live />
          ) : (
            <p className="team-run-feedback__waiting">正在建立会话…</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** 占位模式：飞书式小图标（头像 + 名字 + 处理中）。⛔ 不铺底、不占整行高度。 */
function PlaceholderFeedback({ partners, faceOfId }: Pick<RunFeedbackProps, "partners" | "faceOfId">) {
  if (!partners.length) return null;
  return (
    <div className="team-run-feedback is-placeholder" aria-live="polite" aria-label="伙伴正在处理">
      {partners.map((p) => (
        <span className="team-run-feedback__chip" key={p.memberId} title={`${p.name} 正在处理`}>
          <MemberAvatar member={faceOfId(p.memberId)} size={16} className="team-run-feedback__avatar" />
          <strong>{p.name}</strong>
          <em>处理中…</em>
          <i className="team-run-feedback__dot" aria-hidden />
        </span>
      ))}
    </div>
  );
}

/** 从 busy 名单 + live 增量构造在跑的伙伴（threadId 优先取 live，没拿到就留空由事件补）。 */
export function runningPartnersOf(
  busy: string[],
  nameOf: (id: string) => string,
  live?: LiveRun[],
): RunningPartner[] {
  const byMember = new Map<string, LiveRun>();
  for (const run of live ?? []) {
    if (run?.memberId && run.status === "running") byMember.set(run.memberId, run);
  }
  return [...new Set(busy ?? [])].map((memberId) => {
    const run = byMember.get(memberId);
    /* ⛔ live 里名字更准（合成 id 在群里查不到目录时不至于露裸 id） */
    const name = run?.name && run.name !== memberId ? run.name : nameOf(memberId);
    return {
      memberId,
      name: name === memberId ? "伙伴" : name,
      threadId: run?.threadId || undefined,
      startedAt: run?.startedAt,
    };
  });
}

export function TeamRunFeedback({ mode, partners, faceOfId }: RunFeedbackProps) {
  if (!partners.length) return null;
  return mode === "process"
    ? <ProcessFeedback partners={partners} faceOfId={faceOfId} />
    : <PlaceholderFeedback partners={partners} faceOfId={faceOfId} />;
}
