/**
 * 悬浮播报板块（10-31 立）的对外出口。
 * 当前只有 AppView 顶层挂载（`BroadcastHost` + `BroadcastCollector`）与采集器；
 * 需要从别处推一条播报时用 `pushBroadcast`（⛔ 别 import 组件去渲染第二份）。
 */
export { BroadcastHost } from "./BroadcastHost";
export { BroadcastCollector } from "./collector";
export {
  pushBroadcast,
  markBroadcastSeen,
  toggleBroadcastPanel,
  setBroadcastOpen,
  type BroadcastItem,
  type BroadcastKind,
  type BroadcastTone,
} from "./store";
