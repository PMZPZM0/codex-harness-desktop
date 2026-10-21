/**
 * 任务清单的「展示口径」—— 回合状态胶囊（`TurnStatusCapsule`）与设置页共用一份，
 * ⛔ 不许在组件里再写第二份合并逻辑。
 *
 * 为什么需要它（10-22 用户截图实测）：胶囊「步骤 0/10」列出**十行**，而磁盘上 `task-list.json`
 * 只有 **五条** —— 每一步都成对出现。根因是同一条 `task_add` 被两路写入/重放：
 * 引擎重放时 call id 可能变，渲染层那条「按 id 去重」（`lib/tool-call-dedupe.mjs`）拦不住；
 * store 的幂等窗口（`electron/rpa-store.ts` 的 addTask）也只能盖住 2 秒内的紧邻重复。
 * ⇒ 显示层必须再兜一层：**同一句话只出现一次**。
 *
 * 归并口径：
 *   · 键 = `text`（任务清单里"同一件事"的文字就是身份；模型/AI 改写措辞属于新的一步）；
 *   · 冲突时保留**状态最靠后**的那条（done > doing > todo）—— 丢进度比重复更糟；
 *   · 顺序仍按**首次创建时间**（胶囊从上往下读 ①②③④），不按保留下来那条的时间。
 */

/** 状态权重：越靠后越"完成"。未知状态按 todo 算（⛔ 别让它顶掉 done）。 */
const STATE_RANK = { todo: 0, doing: 1, done: 2 };

/**
 * @param {Array<{ id?: unknown; text?: unknown; status?: unknown; createdAt?: unknown }>} taskList
 *   store 原样的清单（顺序是 updatedAt 倒序）
 * @returns {Array<{ id: string; text: string; state: string; createdAt: number }>} 去重后按创建顺序
 */
export function mergeTaskSteps(taskList) {
  const rows = (Array.isArray(taskList) ? taskList : [])
    .map((task) => ({
      id: String(task?.id ?? ""),
      text: String(task?.text ?? ""),
      state: String(task?.status ?? "todo"),
      createdAt: Number(task?.createdAt ?? 0),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
  const byText = new Map();
  for (const row of rows) {
    const prev = byText.get(row.text);
    if (!prev) { byText.set(row.text, row); continue; }
    if ((STATE_RANK[row.state] ?? 0) > (STATE_RANK[prev.state] ?? 0)) byText.set(row.text, { ...row, createdAt: prev.createdAt });
  }
  return [...byText.values()].sort((a, b) => a.createdAt - b.createdAt);
}
