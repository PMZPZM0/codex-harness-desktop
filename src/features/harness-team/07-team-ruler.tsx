/**
 * 团队模式 · 消息刻度尺（11-06 第三版：⛔ 不再自己画尺子，直接复用主对话 `MessageRuler`）
 *
 * 用户：「刻度线太小了，刻度线可以放滚轮左边，跟主对话框一样的效果」「聊天框渲染组件和
 *        输入框渲染组件跟对话框共用一套就行了，刻度线也是」。
 *
 * ⇒ 这里只做**数据适配**：群日志投影 `GroupMessageRow[]` → `RulerMark[]`，
 *   其余（刻度 DOM / 14px 槽 / 波浪 / 放大镜 / 面板滚轮 / 点击跳转 / 声音 / 滑窗）
 *   全部走主对话那一份代码与那一份 CSS（`.message-ruler`），⛔ 不再有第二套皮肤。
 *
 * ⛔ 三个群专属口径（不改动主对话默认值，只在这里显式放宽）：
 *   · requireScrollable=false：群消息常常只有两三条，主对话"内容不满一屏就隐藏尺子"会让尺子永远不出现；
 *   · narrowThreshold=0：群面板被成员栏挤窄是常态，不该因此隐藏；
 *   · side="right"：群滚动条在消息流右缘，尺子贴它**左边**（CSS `.message-ruler.is-right`）。
 */
import { useMemo } from "react";
import type { RefObject } from "react";
import { MessageRuler } from "../session-turn";
import type { RulerMark } from "../session-turn";
import type { GroupMessageRow } from "./01-team-types";

/** 群里刻度只对应**人发的消息**（伙伴回复是产出，不是会话锚点），与主对话 userMessage 同口径。 */
function toMarks(rows: GroupMessageRow[]): RulerMark[] {
  return rows
    .filter((r) => r.authorKind === "human" && String(r.text ?? "").trim())
    .map((r) => ({
      id: r.key,
      /* onJump 收到 turnId；群没有回合概念 ⇒ 直接放 itemId（对应 [data-item]）。 */
      turnId: r.itemId,
      itemId: r.itemId,
      type: "user" as const,
      label: `${new Date(r.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} ${String(r.text).replace(/\s+/g, " ").slice(0, 80)}`,
    }));
}

export function TeamRuler({
  rows,
  scrollRef,
  containerRef,
}: {
  rows: GroupMessageRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const marks = useMemo(() => toMarks(rows), [rows]);
  const onJump = (itemId: string) => {
    const el = scrollRef.current;
    if (!el || !itemId) return;
    const node = el.querySelector<HTMLElement>(`[data-item="${CSS.escape(itemId)}"]`);
    /* ⛔ 目标可能还没进分页窗口 —— 那就什么都不做，别装作跳过去了 */
    if (node) node.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  return (
    <MessageRuler
      turns={[]}
      marksOverride={marks}
      onJump={onJump}
      scrollRef={scrollRef}
      containerRef={containerRef}
      requireScrollable={false}
      narrowThreshold={0}
      side="right"
    />
  );
}
