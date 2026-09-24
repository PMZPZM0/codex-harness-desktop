/**
 * app-view/helpers/paths（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：路径收集 / 用量统计 / file:// URL 转换
 * 符号（3）：collectKnownPaths / usageCounterSnapshot / toFileUrl
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 */
import { UsageCounterSnapshot } from "../../../features/status";
import { usageInputTokens } from "../../../lib/usage-input-tokens";
import { usageCachedTokens } from "../../../lib/usage-cached-tokens";
import { usageNumber } from "../../../lib/usage-number";



export /** 大 diff 的行级虚拟化（09-14，学 WorkBuddy 的 tool-diff 行虚拟化）：只挂可视区 ± overscan 的行。
 *  diff 每行自带 +/- 前缀，逐行判定着色是准确的、不需要跨行语法上下文——
 *  这正是它比「虚拟化整个代码块」安全的原因（后者要靠 SyntaxHighlighter 的跨行状态）。
 *  ⚠️ 虚拟化后 DOM 里只有可视行：Ctrl+F / 全选复制拿不到屏幕外的行，所以只在 diff 且行数 > 阈值时启用。 */


/** 命令执行卡片（1:1 复刻 WorkBuddy ExecuteCommandCompactRenderer）：
 * 收起态单行 [终端图标][动词][命令文本][状态][箭头]，运行中命令文本走「流光扫过」动画；
 * 展开态 bash 卡片：bash 标题 + 命令原文 + 尾部截断输出（mono），空输出成功态显示「运行成功 ✓」。 */


// 插件表与组件表必须提在模块级：写在 JSX 内联会每次渲染产生新数组/新对象，
// ReactMarkdown 会认为组件类型变了，把整棵 Markdown 子树卸载重建 —— 这正是
// 流式出字时代码块/图片每帧闪烁的根因。提为常量后只做文本节点 diff。

// ── 语法高亮结果缓存（09-18）───────────────────────────────────────────────────
// 「切到内容多的会话卡 1~3.6 秒」的根因：切换会话时消息列表**卸载再挂载**，`MdCode` 虽是
// `memo` 也救不了（memo 只在组件保持挂载时生效），于是每段代码都重新高亮一遍 ——
// CDP CPU profile 实证 `createElement`（bundle 内压缩名 `Ql`）单函数自耗 **2251ms**，
// 而切换耗时 ≈ 目标会话 DOM 规模 × 0.15ms（r=0.974，实测 666 元素 6ms / 23162 元素 3651ms）。
// 修法 = 给库的 `renderer` prop（默认实现就是那个递归建元素的函数）接一层按内容寻址的 LRU；
// 同一段代码第二次渲染直接复用上次的元素树。详见 src/lib/code-highlight-cache.mjs。

/** 造一个带缓存的 renderer。key 由调用方按「语言+代码+主题+行号+换行」算好传进来
 *  （必须覆盖所有影响高亮产物的输入，见 highlightCacheKey 的实现说明）。
 *  ⛔ 返回的元素树是**同一次计算的结果**，React 元素不可变、可在多处挂载，因此外观与
 *  不缓存时完全一致；`rows` 长度做二次校验，万一 key 与内容不一致（理论上不会）就自愈重算。 */


/** 元素是否已进入「视口邻近区」。`enabled=false` 直接返回 true（不懒加载）。 */

/** 代码块：必须是模块级稳定组件。主题/字体由代码设置驱动，组件内部自己订阅 store，
 * 这样切换主题只重渲染代码块本身，不会让 Markdown 整棵树重建（流式出字时也在复用节点）。 */

/** 文件预览只读代码视图：与对话代码块同源渲染（主题/字体/字号/行号/换行全复用 code-settings），
 *  修复「文件预览里代码高亮不生效」——之前是裸 <code> 标签，无语法解析。 */


/** 把 markdown 切成块：只在「围栏代码块之外」的空行处切分。
 *  流式出字时只有最后一块在增长，前面各块内容不变 —— 配合 MdBlock 的 memo（字符串按值比较），
 *  已完成的块不会重新走 remark 解析。整篇重解析的 O(全文) 降到 O(最后一块)，
 *  这是长回复越往后越卡的主因。 */

/** 单块渲染：props 是字符串，memo 按值比较 —— 内容不变就完全跳过解析与 diff */


// 模块级组件（WidgetCard / widget iframe）读取当前主题，由 App 主体随 theme 变化更新。


/** 递归收集对象里所有字符串中的 Windows 绝对路径，登记 basename → 绝对路径（后出现的覆盖先前的） */
function collectKnownPaths(source: unknown, map: Map<string, string>, depth = 0): void {
  if (!source || depth > 8) return;
  if (Array.isArray(source)) { for (const value of source) collectKnownPaths(value, map, depth + 1); return; }
  if (typeof source === "object") { for (const value of Object.values(source as Record<string, unknown>)) collectKnownPaths(value, map, depth + 1); return; }
  if (typeof source !== "string") return;
  for (const match of source.matchAll(/([A-Za-z]:[\\/][^\s<>:"|?*]+\.[A-Za-z0-9]{1,5})/g)) {
    const abs = match[1];
    const base = abs.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    if (base) map.set(base, abs);
  }
}

export /** 粘贴文本的大窗口预览 + 编辑（09-18 用户：「点击这个txt chip，要支持打开大窗口预览，
 *  而且要可以编辑，方便我修改」）。
 *
 *  两条落盘纪律：
 *  ① **只有应用自己保存的粘贴文本才可编辑**：内容由主进程 `pasted-text:read` 返回，
 *     它带了"是否属应用目录"的判定（`editable`）——不靠渲染层拿路径去猜，否则用户自己目录里
 *     同名的 .txt 也会被当成可编辑，一保存就改了他的文件。
 *  ② **关窗即存**：Esc / 点遮罩 / 点关闭，只要内容被改过就自动保存（并提示），不弹"未保存"
 *     确认框 —— 编辑的是应用自己的临时文本，丢改动比多存一次更糟。 */







/** 过程折叠组（对齐 WorkBuddy cr-collapse summary/completed/process 三种皮肤）
 * autoFold：组内首个单元完成后由「内联渲染」切换为折叠组时，先挂载为展开再于下一帧收起，
 * 让 CSS 高度过渡真正跑起来（否则组件以 collapsed 直接挂载，没有过渡、视觉上硬切一下） */

/** 运行计时的起点表（模块级单例）：按回合 id 记忆，**跨卸载存活**。
 *  ⛔ 起点绝不能只存在组件内部 —— 切会话会把消息区整体卸载再挂载，组件内的 useRef/useState
 *  随之归零，于是「切出去看一眼、切回来」计时从 0 重数（09-18 用户实测）。详见 run-clock.mjs。
 *  ⚠️ App 里另外还有 `turnStartedAtRef`（记录 turn/started 时刻，给 reasoning 耗时结算用），
 *  职责看着重叠、但**不合并**：那张表是引擎事件驱动的（起点取 `turn/started` 那一刻），
 *  且埋在 1MB 主组件里、无上限、不可离线断言；本表是 UI 计时显示自持的纯逻辑（可测 + 有上限）。
 *  合并会让「reasoning 耗时结算」与「界面报时」互相牵制，改一处影响另一处。 */

/** 运行中计时只使用本地秒表，不读取引擎时间戳，避免秒/毫秒单位混淆。
 *  ⛔ 09-18 用户实测「这段文字会出现在『正在处理』后面，跟消息下面重复了」：
 *  「正文已完整，等待模型收尾」这份状态**只在底部运行状态行说一次**（它有专属话语池），
 *  计时条只管报时 —— 两边各说一遍就是同一屏里重复两处。
 *  ⛔ 09-18 用户实测「切出去再切回来，时间就重置了」：起点必须取自 RUN_CLOCK（按回合记忆），
 *  不能是 `useRef(Date.now())` —— 那样每次重挂载都从 0 开始。 */

/** 连续同类工具限流：默认只展示最新三条，旧条目留在原位置并可展开。 */


/** 消息折叠状态机（对齐 WorkBuddy assistant-fold/fold.ts）：
 * 流式与完成态共用 buildSegments 分段，输出【同构扁平 keyed children】（fold-首单元id / item id），
 * 完成瞬间结构对得上 → 不重挂、动画不重播。
 * 流式：连续 ≥2 个可折叠单元 → 未到正文前收「lead 组 + 最新一条内联」；到正文后整段收意图摘要组（小折叠）；
 * 完成：首段工具组换「已完成 · 用时 X」皮肤；其余工具段用意图摘要标题（收起态，可展开看过程）；
 *       正文（含中间解说）与深度思考卡、plan/图片卡按流序内联常显——思考卡全程保持同一 DOM 节点，
 *       live→done 的自动收起动画才能播出来（否则回合结束被吸进折叠组卸载重挂，表现就是「闪一下就没了」）。 */


// ── 数据管理 / 缓存清理（设置 → 数据与统计 → 数据管理） ──







function usageCounterSnapshot(usage: any): UsageCounterSnapshot {
  return {
    input: usageInputTokens(usage),
    cached: usageCachedTokens(usage),
    output: usageNumber(usage, "outputTokens", "output_tokens", "completionTokens", "completion_tokens"),
    total: usageNumber(usage, "totalTokens", "total_tokens"),
  };
}

export /** 卸载技能进度（与安装对称）：folder=目录名、name=展示名；engineRemoved=引擎是否已确认移除。 */
/** 本地绝对路径 → file:// URL（webview 内置浏览器可直接渲染本地 HTML） */
function toFileUrl(p: string): string {
  const norm = p.replace(/\\/g, "/");
  return norm.startsWith("/") ? `file://${norm}` : `file:///${norm}`;
}