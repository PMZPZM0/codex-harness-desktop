/**
 * 未知回合的 item 承接（渲染层流式归约的**唯一**兜底判据）。
 *
 * 背景（09-23 用户实测：「排队消息自动发出时对话框里不出现那条消息，agent 只短暂显示正在回复然后就结束」）：
 *   用**真实 app-server**（独立 CODEX_HOME + mock 上游，09-23 本机实测）拿到的事件序列是：
 *     · `turn/started` 的回合快照 `items=[]`；`turn/completed` 的回合快照 `items=[agentMessage]`
 *       —— 引擎**从不在这两处带 userMessage**，用户消息只走 `item/started` / `item/completed`；
 *     · 排队消息是**引擎自己**启动成新回合的（`thread/queue/changed` → `turn/started`，队列随之清空），
 *       应用侧 `thread/queue/list` 多半拿到空数组 ⇒ **应用不参与建回合**；
 *     · ⇒ 「回合容器」只能由事件流自己建立：`turn/started` 到达时经 mergeTurn 建。
 *
 *   于是只要 userMessage 的 item 事件比 `turn/started` **早**到达渲染层（同一 tick 内连续投递一串
 *   事件，顺序抖动真实存在），旧实现 `mergeItem` 对未知回合**静默丢弃**该 item：用户消息再无补救
 *   机会（`turn/completed` 的快照里没有它），界面上只剩一个「没有用户消息的回复」。
 *   正常发送之所以没事：send 路径先用 `turn/start` 响应 + `hydrateTurnUserMessage` 把回合落进本地
 *   （外面还叠一层乐观气泡）。排队自动启动 / 立即注入 / 自动续接 / 引擎自启动都没有这层保护
 *   ⇒ **必须由归约层兜住**（本模块就是那一层）。
 *
 * 判据：**只用 userMessage 建回合**。
 *   · 回合必以用户消息开始（上面的事件顺序实证），所以它总是该回合的第一个 item；
 *   · 只认 userMessage ⇒ 绝不会造出「没有用户消息的孤儿回合」（那是 09-19 修过的另一类 bug：
 *     `turn/completed` 只给产出条目，拿它建回合就会渲染成"凭空多出来一条回复"）。
 *
 * @param {{ id: string }[]} turns 本地已有回合（判存在性）
 * @param {string} turnId 事件归属的回合 id
 * @param {{ type?: string } | null | undefined} item 触发本次归约的 item
 * @returns {null | { id: string, status: string, items: any[] }} null = 不建（调用方保持原行为）
 */
export function adoptUnknownTurn(turns, turnId, item) {
  const id = typeof turnId === "string" ? turnId : "";
  if (!id) return null;                                   // 没有回合 id：无从归属，别造匿名回合
  if (!item || typeof item !== "object") return null;
  if (item.type !== "userMessage") return null;           // 只认用户消息（见上「判据」）
  if (!Array.isArray(turns)) return null;
  if (turns.some((turn) => turn && turn.id === id)) return null;   // 回合已存在 ⇒ 走正常合并
  return { id, status: "inProgress", items: [item] };
}
