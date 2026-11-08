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
 * ⛔⛔ 11-08 三改（用户截图，红框圈住用户气泡里的「剪承 运行中」）：
 *   「这个过程模式下，就不用在用户消息下面展示这个了，只有占位模式才显示这个，
 *     而这个显示不好看，上下太宽了，我要是那种很窄的，很小的头像+名字提醒」
 *   ⇒ **过程模式一律不画**（过程已经在成员自己的流式卡里：正在写 / 正在思考 + 折叠块，
 *     再在用户气泡下挂一份就是重复，而且那行带边框带内边距、上下很宽）；
 *   ⇒ **只有占位模式画**，且收成很窄的一粒：小头像 + 名字 + 呼吸点，⛔ 不再带「处理中…」长文案。
 *
 * 独立板块：视图只接线（谁在跑 / 名字 / 头像 / threadId 都由调用方给）。
 */
import type { LiveRun } from "./02-team-store";
import { MemberAvatar } from "./13-team-avatar";

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
};

/** 占位模式：飞书式小图标（小头像 + 名字 + 呼吸点）。⛔ 不铺底、不占整行高度、不带长文案。 */
function PlaceholderFeedback({ partners, faceOfId }: Pick<RunFeedbackProps, "partners" | "faceOfId">) {
  if (!partners.length) return null;
  return (
    <div className="team-run-feedback is-placeholder" aria-live="polite" aria-label="伙伴正在处理">
      {partners.map((p) => (
        <span className="team-run-feedback__chip" key={p.memberId} title={`${p.name} 正在处理`}>
          <MemberAvatar member={faceOfId(p.memberId)} size={14} className="team-run-feedback__avatar" />
          <strong>{p.name}</strong>
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

/** 用户气泡下的运行反馈：**只有占位模式**画小图标；过程模式返回 null（过程在成员流式卡里）。 */
export function TeamRunFeedback({ mode, partners, faceOfId }: RunFeedbackProps) {
  if (mode !== "placeholder") return null;
  return <PlaceholderFeedback partners={partners} faceOfId={faceOfId} />;
}
