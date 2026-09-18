/**
 * 语法高亮的「元素树缓存」——修复「切到内容多的会话要卡 1~3.6 秒」（09-18 用户：「切换运行
 * 会话会有一些卡顿延迟」）。
 *
 * ── 根因（CDP CPU profile 实证，不是猜） ────────────────────────────────────────
 * `react-syntax-highlighter` 的 `createElement`（bundle 里压缩成 `Ql`）会把每个 token 递归
 * 建成一个 React 元素。真机 profile：**`Ql` 单函数自耗 2251ms**，第二名只有 48ms 左右，
 * 且伴随大量 `appendChild`/`createTextNode`。切换会话时整个消息列表**卸载再挂载**，
 * `MdCode` 虽是 `memo` 也救不了（memo 只在组件保持挂载时生效）——每段代码都重新高亮一遍。
 * 逐会话实测：切换耗时 ≈ 目标会话 DOM 规模 × 0.15ms（r=0.974）：
 * 666 元素 = 6ms、8001 = 703ms、13554 = 1951ms、23162 = **3651ms**。
 *
 * ── 修法 ───────────────────────────────────────────────────────────────────
 * 库本身支持 `renderer` prop（`renderer({rows, stylesheet, useInlineStyles})`），默认实现正是
 * 上面那个递归建元素的函数。于是给它接一层**按内容寻址的 LRU**：同一段代码（同语言/主题/
 * 行号/换行设置）第二次渲染直接复用上次算好的元素树，跳过整段递归。
 * React 元素是不可变描述，同一棵树可以在多处挂载，因此这是**纯计算优化、零外观变化**——
 * 复用的一定是"同一次计算的结果"，不存在渲染不一致。
 *
 * ⛔ 流式（逐字追字）期间不要接：code 每帧都在变，key 每帧都 miss，白付哈希与淘汰开销。
 *   调用方按「行数/字符数够大 + 不在追字」决定是否接入（见 App.tsx 的三处接线）。
 */

/** 缓存键：必须覆盖**所有影响高亮产物**的输入。
 *  库内部的行拆分由 `code / language / showLineNumbers / wrapLines / wrapLongLines /
 *  lineProps / startingLineNumber / lineNumberStyle` 决定，其中本项目只用到前三个 + wrapLongLines；
 *  主题走 `stylesheet`（只影响颜色，不影响行结构，但影响产物元素，必须进键）。
 *  用 `\u0000` 分隔，避免「语言名与代码拼接产生歧义」这类串键。 */
export function highlightCacheKey({ language, code, theme, lineNumbers, wrapLongLines }) {
  return [
    String(language ?? ""),
    String(theme ?? ""),
    lineNumbers ? "1" : "0",
    wrapLongLines ? "1" : "0",
    String(code ?? ""),
  ].join("\u0000");
}

/** LRU 缓存（Map 的插入顺序即最近使用顺序）。
 *  @param maxEntries  最多缓存多少段代码
 *  @param maxTotalChars 缓存内容的总字符上限（防止"很多大块"把内存吃满）
 *  @param minCodeChars 小于这个长度的代码块不缓存（本来就不贵，缓存只增加内存与哈希开销）
 *  @param maxCodeChars 大于这个长度的不缓存（单块上限，防一段巨块独吞预算）
 *
 *  ⛔ 上限别设小了：真机实测有个会话 **13346 个元素里 11163 个（84%）来自同一个 66838 字
 *  的代码块**，第一版把单块上限设成 60000 → 恰好吃不到缓存，那个会话每次切换照样高亮 ~1.4 秒。
 *  现在的默认值（单块 200k / 总量 600k 字符）是照"够覆盖真实会话里出现过的大块"定的。 */
export function createHighlightCache({ maxEntries = 300, maxTotalChars = 600000, minCodeChars = 800, maxCodeChars = 200000 } = {}) {
  const map = new Map();
  let totalChars = 0;
  let hits = 0;
  let misses = 0;
  const evictOverflow = () => {
    while (map.size > maxEntries || totalChars > maxTotalChars) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
      totalChars -= oldest.length;   // key 由 code 拼成，长度即"这份缓存占的内容量"
    }
  };
  return {
    /** 是否值得缓存这段代码（长度落在窗口内） */
    shouldCache(code) {
      const n = String(code ?? "").length;
      return n >= minCodeChars && n <= maxCodeChars;
    },
    get(key) {
      const hit = map.get(key);
      if (hit === undefined) {
        misses += 1;
        return undefined;
      }
      hits += 1;
      // 提到最新（LRU）
      map.delete(key);
      map.set(key, hit);
      return hit;
    },
    set(key, value) {
      if (map.has(key)) {
        map.delete(key);
        totalChars -= key.length;
      }
      map.set(key, value);
      totalChars += key.length;
      evictOverflow();
    },
    get size() {
      return map.size;
    },
    stats() {
      return { size: map.size, totalChars, hits, misses, maxEntries, maxTotalChars, minCodeChars, maxCodeChars };
    },
    clear() {
      map.clear();
      totalChars = 0;
      hits = 0;
      misses = 0;
    },
  };
}
