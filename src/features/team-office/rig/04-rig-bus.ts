/**
 * 业务 ↔ 渲染解耦总线（team-office 域 rig，09-30 v17 —— 约束 2）。
 *
 * ⛔ 纪律：**业务代码里搜不到任何 play()/setState()** —— 业务只发事件，渲染层订阅后自己
 *    决定播什么。这样动画怎么演（帧切换 / 骨骼 / 将来的 Spine）换实现都不碰业务。
 *
 * 事件清单（⛔ 新增事件先在这里登记类型，别散字符串）：
 *   agent:state      —— 成员状态变化（running / idle），payload = { key, running }
 *   agent:taskDone   —— 任务完成（触发 handup 举手机），payload = { key }
 *   agent:dispatch   —— 点设施派单（触发 walk），payload = { key, spot }
 *   agent:arrive     —— 到达设施（触发 interact），payload = { key, spot }
 *   agent:openThread —— 点击角色进会话（渲染层自己处理，不发业务）
 */
export type RigEvent =
  | { type: "agent:state"; key: string; running: boolean }
  | { type: "agent:taskDone"; key: string }
  | { type: "agent:dispatch"; key: string; spot: string }
  | { type: "agent:arrive"; key: string; spot: string };

type Handler = (e: RigEvent) => void;

const handlers = new Set<Handler>();

export function onRigEvent(h: Handler): () => void {
  handlers.add(h);
  return () => { handlers.delete(h); };
}

export function emitRigEvent(e: RigEvent): void {
  for (const h of handlers) h(e);
}
