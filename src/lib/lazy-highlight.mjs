/**
 * 代码块**懒高亮**（09-18 用户：「不能懒加载嘛，我又没点开看代码高亮，为啥要每次切换都重新加载
 * 一遍呢」）。
 *
 * 背景：语法高亮是"输入相同、结果相同"的纯计算，但很贵（真机 CPU profile：单函数 2.2 秒，
 * 且耗时≈目标会话 DOM 规模 × 0.15ms、r=0.974）。上一步已经用**结果缓存**
 * （code-highlight-cache.mjs）消掉了"同一段代码反复高亮"；剩下的是**首次**进入某个会话时，
 * 一屏之外、甚至折叠在过程组里的代码块也在算 —— 用户没看它，却为它付了时间。
 *
 * 做法：只对**大块**做懒高亮 —— 进入视口邻近区（rootMargin 预载）前渲染"等价外观的纯文本"，
 * 进区后换成真高亮。小块（绝大多数）直接高亮，零行为变化。
 *
 * ⛔ 为什么设阈值而不是全量懒加载：小块高亮本来就便宜（几毫秒），全量懒加载只会让
 *    "滚动时文字颜色跳变"的风险覆盖到所有代码块；只在真正贵的大块上启用，收益最大、风险最小。
 */

/** 超过这个字符数才算"大块"，值得为它做懒加载。
 *  实测：真机那个把切换拖到 3.6 秒的会话里，最长代码块 66838 字符（占该页 11600 个高亮 span 的
 *  96%）。1500 字符以下的高亮都在毫秒级，懒加载收益小于"颜色跳变"的风险。 */
export const LAZY_HIGHLIGHT_MIN_CHARS = 1500;

/** 这段代码值不值得懒加载 */
export function deservesLazyHighlight(code) {
  return String(code ?? "").length >= LAZY_HIGHLIGHT_MIN_CHARS;
}

/**
 * 从 prism 主题对象里取出"容器基样式"，供**未高亮的纯文本兜底**使用。
 *
 * 为什么取这两个键：`react-syntax-highlighter` 的 `SyntaxHighlighter` 就是把主题里的
 * `pre[class*="language-"]` 用在 PreTag 上、`code[class*="language-"]` 用在 CodeTag 上。
 * 兜底时用同一份样式 ⇒ 背景/文字色/字体/行高完全一致，切换高亮时**只有 token 颜色出现**，
 * 不会出现"白底闪一下"。
 */
export function plainCodeStyles(themeStyle) {
  const style = themeStyle ?? {};
  return {
    pre: style['pre[class*="language-"]'] ?? {},
    code: style['code[class*="language-"]'] ?? {},
  };
}
