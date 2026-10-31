import { DEFAULT_GROUP_TEXT, foldAtomOf } from "./turn-fold";
import type { FoldUnit } from "./turn-fold";

/**
 * 「对话流：简洁」的块头文案（10-31 用户令）：
 *   正文之间的所有过程收成一个块，块头**一直显示最新一步在干什么**（跟着流实时换），
 *   而不是笼统的「编辑文件 6 次」—— 后者看起来像"这段已经结束了"，可它通常还在跑。
 *
 * ⛔ 纯函数放 lib 的做法与 turn-fold 一致：守卫能直接 import 断言，也能被 .mjs 预检跑。
 * ⛔ 取「最后一条**非思考**单元」：思考不是"动作"，拿它当块头会一直是「深度思考…」，
 *    看不出这一步到底在编辑哪个文件 / 跑什么命令。
 */
export function dialogFlowStepTitle(group: FoldUnit[], waitingForApproval?: boolean): string {
  const steps = group.filter((unit) => unit.item.type !== "reasoning");
  const last = steps[steps.length - 1];
  // 整段只有思考 ⇒ 只能这么说；等确认时换成等待文案（否则用户以为卡住了）
  if (!last) return waitingForApproval ? "等待确认…" : "深度思考…";
  const atom = foldAtomOf(last.item, waitingForApproval);
  const text = DEFAULT_GROUP_TEXT[atom.group] ?? DEFAULT_GROUP_TEXT.other;
  const base = atom.object ? text.topic.replace("{t}", atom.object) : text.noTopic;
  const prefix = atom.status === "running" ? "正在" : atom.status === "waiting" ? "等待确认 · " : "";
  // 尾部步数只在 >1 时出现：「共 1 步」纯属噪音
  const tail = steps.length > 1 ? ` · 共 ${steps.length} 步` : "";
  return `${prefix}${base}${tail}`;
}
