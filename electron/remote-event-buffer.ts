/**
 * 手机远控的事件缓冲（11-06 P0-3）：给轮询接口提供**可续传的游标**。
 *
 * 为什么不用时间戳当游标：`at > since` 在同一毫秒内会**漏事件**（响应里的 now 与事件 at 撞上），
 * 而且客户端时钟/服务端时钟一有偏差就整段漂。改用单调递增的 seq：
 *   · 客户端只带 `since=<seq>`，服务端回 `lastSeq` + `events`；
 *   · 缓冲是环形（默认 400 条），**游标比缓冲里最老的还老** ⇒ `dropped=true`，
 *     由客户端提示「断线期间有过程没收到」并重新拉一次消息，而不是静默留空洞；
 *   · 兼容老页面：`since` 大于 1e12 视为时间戳，退回 `at > since`（老页面刷新后不会全空）。
 *
 * 单独成叶子模块：remote.ts 依赖 electron，守卫 require 不了，这里才能真跑断言。
 */
export type RemoteEvent = { threadId: string; kind: string; text: string; data?: any };
export type BufferedEvent = RemoteEvent & { at: number; seq: number };
export type EventSlice = { events: BufferedEvent[]; lastSeq: number; dropped: boolean };

const TIMESTAMP_FLOOR = 1e12;

/** 建一个有上限的事件缓冲（带自增序号，满了丢最旧），供手机端重连补发。 */
export function createEventBuffer(limit = 400) {
  const items: BufferedEvent[] = [];
  let seq = 0;
  return {
    push(event: RemoteEvent, at = Date.now()): BufferedEvent {
      const entry: BufferedEvent = { ...event, at, seq: (seq += 1) };
      items.push(entry);
      if (items.length > limit) items.splice(0, items.length - limit);
      return entry;
    },
    /** `cursor` 兼容两种：> 1e12 视为时间戳（老页面），否则视为 seq。 */
    since(cursor: number): EventSlice {
      const value = Number(cursor) || 0;
      const byTime = value > TIMESTAMP_FLOOR;
      const events = items.filter((entry) => (byTime ? entry.at > value : entry.seq > value));
      const firstSeq = items.length ? items[0].seq : seq + 1;
      const dropped = !byTime && value > 0 && value < firstSeq - 1;
      return { events, lastSeq: seq, dropped };
    },
    get lastSeq() {
      return seq;
    },
    get size() {
      return items.length;
    },
  };
}
