/**
 * 团队模式 · 运行过程（11-06）
 *
 * 用户要求：把**对话框那套运行过程**搬到群里一条消息的下面，默认折叠；
 * 只有最终正文作为正常消息出现在群里，过程不进消息流；折叠头文字跟着过程内容更新。
 *
 * 复用口径（⛔ 群视图不另写一套）：
 *   · 过程/正文分组：`src/lib/turn-fold.ts` 的 `classifyUnit`
 *   · 折叠头文案：`src/lib/dialog-flow-title.ts` 的 `dialogFlowStepTitle`（跟随最新一步 + 共 N 步）
 *   · 折叠块本体：`src/features/session-queue` 的 `FoldGroup`（`.wb-fold--summary` 皮肤、默认收起）
 *   · 过程项卡片：同域的 `ItemView`（命令 / 编辑 / 技能 / 思考卡，与主对话逐项一致）
 *   · 图片点开灯箱：正文由主对话的 `Markdown` 渲染，它内部走 `openImageLightbox`
 *     ⇒ **文件只留灯箱预览**，群里不再挂 `InlineCards` / `FileResultCards` 那套文件卡。
 *
 * 数据：群日志只落最终正文（"只有正文正常消息发送出来"）；过程按 `threadId` 用通用
 *   `codex:request("thread/turns/list", { itemsView:"full" })` 从**真身子会话**按需回读，
 *   ⛔ 不把过程塞进群日志、⛔ 不造 turnId/itemId。拉不到就干脆不画折叠块（不留空壳）。
 */
import { useEffect, useMemo, useState } from "react";
import { FoldGroup, ItemView } from "../session-queue";
import { classifyUnit, topToolGroup } from "../../lib/turn-fold";
import { dialogFlowStepTitle } from "../../lib/dialog-flow-title";
import { pickTurnOf } from "../../lib/team-fold.mjs";
import type { TeamTurn } from "../../lib/team-fold.mjs";

type Props = {
  threadId: string;
  /** 这条群消息的落盘时刻（挑回合用） */
  at: number;
  /** 群日志里的最终正文（与回合 agentMessage 比对，挑回合最硬的判据） */
  bodyText: string;
  /** 群头「展开过程 / 收起过程」的全局默认值；切换时父层用 key 重挂本块 */
  defaultOpen?: boolean;
  /** 运行中：折叠头加"正在…" */
  running?: boolean;
  /** 追问：把该伙伴 @ 上（父层已有动作） */
  onAskAgain?: () => void;
};

/** 同一个子会话的多条群消息只拉一次；失败的删掉缓存，下次还能重试。 */
const turnsCache = new Map<string, Promise<TeamTurn[]>>();

function turnsOf(threadId: string): Promise<TeamTurn[]> {
  const hit = turnsCache.get(threadId);
  if (hit) return hit;
  /* ⛔ 空结果/失败不能永久缓存：引擎刚落盘时可能还没索引到该回合，
     永久缓存 [] 会让过程块**永远不出现**（直到重启应用）。
     ⇒ 负结果保留 30s 再失效：既不会每次重挂都打一次 IPC，也留了重试机会。 */
  const invalidate = () => {
    const timer = setTimeout(() => turnsCache.delete(threadId), 30_000);
    // 浏览器渲染层没有 unref，用可选链兼容
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  const task = window.codex
    .request("thread/turns/list", { threadId, itemsView: "full", limit: 8, sortDirection: "desc" })
    .then((res: { data?: unknown }) => {
      const list = Array.isArray(res?.data) ? (res.data as TeamTurn[]) : [];
      if (!list.length) invalidate();
      return list;
    })
    .catch(() => {
      invalidate();
      return [] as TeamTurn[];
    });
  turnsCache.set(threadId, task);
  return task;
}

export function TeamProcess({ threadId, at, bodyText, defaultOpen = false, running = false, onAskAgain }: Props) {
  const [turns, setTurns] = useState<TeamTurn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!threadId || threadId.startsWith("group:")) { setLoading(false); return; }
    setLoading(true);
    void turnsOf(threadId).then((list) => {
      if (!alive) return;
      setTurns(list);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [threadId]);

  const turn = useMemo(() => pickTurnOf(turns, at, bodyText), [turns, at, bodyText]);

  /** 过程项 = 工具/命令/编辑/技能/思考；正文（agentMessage）不进折叠，由父层正常渲染。 */
  const units = useMemo(() => {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    return items
      .filter((i) => i && i.type && i.type !== "userMessage")
      .map((i, index) => {
        const item = { ...i, id: String(i.id ?? `it_${index}`), type: String(i.type ?? "other") } as { id: string; type: string; [key: string]: unknown };
        return { item, kind: classifyUnit(item) };
      })
      .filter((u) => u.kind === "foldable" || u.kind === "thinking");
  }, [turn]);

  /* ⛔ 没有过程项 / 数据没拉到 ⇒ 不画空壳：折叠块不是装饰，点开必须有东西。 */
  if (loading || !units.length) return null;

  /* 折叠头随内容更新：主对话「简洁对话流」同款（跟随最新一步 + 共 N 步）。 */
  const title = dialogFlowStepTitle(units) || "运行过程";
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };
  /* 群里的"引用"= 把这个伙伴 @ 上再问一轮；⛔ 不写系统剪贴板（用户没预期这个副作用） */
  const quoteText = () => { onAskAgain?.(); };

  return (
    <div className="team-process">
      <FoldGroup
        title={title}
        leadGroup={topToolGroup(units) ?? "other"}
        variant="summary"
        running={running}
        defaultOpen={defaultOpen}
        autoFold={false}
        animateTitle={running}
      >
        <div className="team-process__items">
          {units.map((u, i) => (
            <ItemView
              key={String(u.item.id ?? i)}
              item={u.item}
              hideFooter
              onCopy={copy}
              onQuote={quoteText}
              onFork={undefined}
              onImageCopy={copy}
              onEditSubmit={undefined}
              onOpenFile={undefined}
              onOpenThread={undefined}
              onApplyPlan={undefined}
            />
          ))}
        </div>
      </FoldGroup>
    </div>
  );
}
