/**
 * 运行计时的「起点记忆」——修复「切走再切回来，正在处理的时间重置了」（09-18 用户实测）。
 *
 * ── 根因 ─────────────────────────────────────────────────────────────────────
 * 「正在处理 N 秒」的起点原先只存在组件内部的 `useRef(Date.now())`。而切换会话会把消息区
 * **整体卸载再挂载**（与「切会话重复语法高亮」是同一个机制，见 code-highlight-cache.mjs）：
 * 组件一卸载 ref 就没了，重新挂载时又取一次 `Date.now()` ⇒ 计时从 0 重数。
 * 于是「切出去看一眼别的会话、切回来」会看到时间倒退，而不是接着走。
 *
 * ── 修法 ─────────────────────────────────────────────────────────────────────
 * 起点按**回合 id** 记忆在一个跨挂载存活的表里：同一回合无论重挂载多少次，拿到的都是
 * 第一次的那个起点，因此切走期间流逝的时间也被正确计入（这正是用户期望的语义：
 * 「这个任务从开始处理到现在多久了」）。
 *
 * 沿用既有决策：**只用本地秒表，不读引擎时间戳**（`Turn.startedAt` 存在，但单位是秒还是
 * 毫秒历史上混过，读它会引入单位歧义；本地起点无歧义且不依赖引擎是否上报）。
 *
 * ⛔ 两个必须自己兜住的边界：
 *   ① **没有 id 时不能崩**，也不能把不同回合算成同一个（退化为"不记忆"，只保证当次正确）。
 *   ② **条目必须能被清理**：回合结束后由调用方 `forget`；另有容量上限做兜底，
 *      防止"只跑不停的会话"把表撑大（溢出的按最久未用淘汰）。
 */

/** 默认上限：够覆盖同时挂载的回合 + 一批刚跑完的（正常远达不到，纯兜底）。 */
export const RUN_CLOCK_MAX_ENTRIES = 400;

/**
 * 造一个计时起点表。
 * @param maxEntries 最多记多少个回合的起点（超出按最久未用淘汰）
 */
export function createRunClock({ maxEntries = RUN_CLOCK_MAX_ENTRIES } = {}) {
  const starts = new Map();

  /** 取该回合的起点；该回合第一次问的时候"就是现在"。
   *  幂等：同一回合重复调用只会返回同一个起点（不会把计时一次次后移）。 */
  function startOf(turnId, now = Date.now()) {
    const key = String(turnId ?? "");
    // 没有 id：退化成"不记忆"，只保证这一次调用返回一个稳定起点（不能让不同回合共用一条）
    if (!key) return now;
    const hit = starts.get(key);
    if (hit !== undefined) {
      // LRU：命中后提到最新（否则"长期在跑的会话"会被新回合挤掉）
      starts.delete(key);
      starts.set(key, hit);
      return hit;
    }
    starts.set(key, now);
    while (starts.size > maxEntries) {
      const oldest = starts.keys().next().value;
      if (oldest === undefined) break;
      starts.delete(oldest);
    }
    return now;
  }

  return {
    /** 该回合已运行的秒数（负值/系统时钟回拨一律夹到 0，不显示"-3 秒"）。 */
    elapsedSeconds(turnId, now = Date.now()) {
      const elapsed = now - startOf(turnId, now);
      return Math.max(0, Math.floor(elapsed / 1000));
    },
    /** 起点本身（毫秒时间戳）。回合结束时也可用它算总耗时。 */
    startOf,
    /** 回合结束后清掉，避免表里堆积已经不会再显示的回合。 */
    forget(turnId) {
      const key = String(turnId ?? "");
      if (!key) return false;
      return starts.delete(key);
    },
    /** 该回合是否已有起点（用于断言"切回来复用的是老起点"，而不是重新开表）。 */
    has(turnId) {
      const key = String(turnId ?? "");
      return key ? starts.has(key) : false;
    },
    get size() {
      return starts.size;
    },
    clear() {
      starts.clear();
    },
  };
}
