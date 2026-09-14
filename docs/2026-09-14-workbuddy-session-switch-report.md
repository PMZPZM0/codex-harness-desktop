# WorkBuddy 会话切换为什么这么流畅 —— 逆向分析报告

> 分析对象：本机安装的 WorkBuddy 桌面端（Electron，`resources/app.asar`，2026-09-13 版本）
> 分析方式：静态逆向（asar 拆包 + 产物字符串/结构分析），**非**运行时 profiling
> 分析日期：2026-09-14
> 对照对象：本项目 Codex Harness Desktop

---

## 一、结论（TL;DR）

WorkBuddy 的流畅**不是靠某一个技巧**，而是「协议 → 适配 → 数据 → 渲染」四层各削一刀，让「切会话」这件事在每一层都几乎无成本：

| 层 | 做法 | 消除掉的成本 |
|---|---|---|
| 协议 | `session/load` 下发 `historyEndOffset` 精确切分历史/实时；`session.detach()` 只摘监听器**不断连接** | 切换不重建连接、不误判流式边界 |
| 适配 | 按 `sessionId` 隔离的**多张 Map 缓存**（messageCache / processedOffsets / toolCallIdToMessageId / sessionConfigs / sessionModels / listenedSessionIds）+ `currentActiveSessionPromise` 单飞 | 切回旧会话 = 命中内存缓存，**不重新拉取、不重新解析** |
| 数据 | `MessageLinkedList` 链表（O(1) append、`lastUserNode` 直挂、turn 状态内聚）+ 终态判定收敛成纯函数 | 流式增量不重建数组；不在每帧重新推断「这轮完了没」 |
| 渲染 | TanStack Virtual 虚拟化（消息帧级 + diff 行级）+ **定制 `directDomUpdates`：流式期间用 transform 直写 DOM，绕过 React 重渲** | 长会话只渲染可视区；出字时不触发 React 全量 diff |
| React | React 18.3.1，`memo`/`useMemo` 高密度（367 处）、rAF 合批（596 处）、`useDeferredValue` 可用 | 局部更新不外溢 |
| 冷启动 | 主进程把账号快照塞进 URL query，`index.html` 内联 IIFE **parse 即消费**，跳过 daemon `getAccount()` ≈2.6s 的等待窗口 | 首屏不等后端 IO |
| CSS | `contain: content/strict/layout/paint/size` 108 处、`will-change` 55 处、动画全走 transform/opacity | 布局/绘制影响域被切断 |

一句话：**他们把「切换」从一个 IO 动作，降级成了一次 Map 取值 + 一次虚拟列表区间重算。**

---

## 二、逐层证据

### L0 协议层：切会话不重建连接，历史/实时边界由服务端给准数

`session/load` 的响应里带服务端下发的 offset，用来精确切分「哪些消息属于历史、哪些是实时流」：

```js
// browser-nl6vAv29.js
// 从 session/load response 读取服务端下发的历史末位 offset。
// 服务端（sandbox-proxy）在 `_meta['codebuddy.ai'].historyEndOffset` 下发"客户端实际
// 会收到的最后一条历史消息的 offset"（tailOffset 语义，考虑 chunk 合并）。collectHistoryRaw
// 据此精确判定历史/实时边界，避免 resume tailOffset 竞态把历史 assistant chunk 错标
// mode:stream 导致提前截断。
function readHistoryEndOffset(resp) {
  const val = (resp._meta?.["codebuddy.ai"])?.historyEndOffset;
  return typeof val === "number" ? val : void 0;
}
```

这解决的是「切回去看到半截消息 / 消息重复」类问题——**边界不靠猜**。

同一文件里还有一条很有代表性的健壮性设计：会话空闲久了沙箱被回收，`session/load` 会返回**降级空响应**（不报错但没有任何历史），他们专门识别并退避重试：

```js
// 判据取三者同时缺失（modes / models / historyEndOffset）：真实会话即便历史为空，
// box 也会带上 modes+models
// …线上实测用户手动切走再切回即正常
```

以及连接复用：

```js
// clearSessionCache() 注释
// 使用 session.detach() 而不是 session.disconnect()：
// - detach(): 只移除监听器，不断开连接（适用于连接复用场景）
// - disconnect(): 移除监听器并断开连接
```

**要点**：切会话只做「摘旧监听器 + 挂新监听器」，连接与传输层保持。

### L1 适配层（最关键）：按会话隔离的多张 Map 缓存

`AgentNewAdapter` 的实例字段（loginRedirect-DkQI_psq.js）：

```js
messageCache          = new Map();   // 按 sessionId 隔离的消息缓存
processedOffsets      = new Map();
toolCallIdToMessageId = new Map();
sessionConfigs        = new Map();
sessionModels         = new Map();
listenedSessionIds    = new Set();
currentActiveSessionId      = null;
currentActiveSessionPromise = null;  // 同一会话并发 load 复用同一个 promise（单飞）
```

并且在切换/清理路径上，**明确写明「不许删 messageCache」**：

```js
/**
 * 会话切换前处理指定会话的缓存
 *
 * 注意：不能在这里删除 messageCache。
 * automation 后台运行时，消息可能已进入…
 */
```

```js
/**
 * 清理 session 缓存
 * 注意：不清理 messageCache，因为：
 * 1. 消息缓存按 sessionId 隔离存储
 * 2. 切换会话时旧会话的消息缓存可能还需要（用于后台任务完成后的更新）
 * 3. 消息缓存在 archiveSession/destroy 时会被清理
 */
```

只有登出 / 切用户才 `resetAllCaches()` 全清（并一次性清掉 9 张表）。

**要点**：切回刚看过的会话，几乎必然命中 `messageCache` —— 连"重新解析消息"这一步都省了。这是「切来切去都很快」的直接原因。

### L2 数据层：链表 + 终态纯函数

`message-linked-list-Bn_EIUBF.js`（包内路径 `packages/agent-ui/src/modules/collab/task-chat/utils/message-linked-list.ts`）：

```js
MessageLinkedList = class MessageLinkedList {
  head = { next: null, kind: "system", time: 0 };  // 虚拟头节点，简化边界处理
  tail = this.head;                                 // 尾指针，O(1) append
  lastUserNode = null;                              // 最后一个 UserNode，用于快速挂 assistant
  _size = 0;
  appendUser(message) { /* 尾部追加，节点内聚 turnState */ }
}
```

每个 user 节点自带 turn 状态机：`completedBeforeEndTurn / failedBeforeEndTurn / endTurnReceived / onTurnCompletedFired`。

终态判定被抽成**两个语义明确的纯函数**，并在注释里写清了「为什么不能混用」：

- `isTurnTerminated(state)`：并集（含启发式的 `fromCliResume`），用于「历史回放末轮」判断
- `isAuthoritativeTurnTerminal(state)`：**只认权威信号**，因为它要写入一个粘性标记（一旦为 true 只有显式 false 才能清除）——若把启发式算进去，正在跑的轮次会被永久钉死为「已完成」

**要点**：数据结构层面保证「增量追加」是 O(1)，语义层面保证「这轮完了没」只算一次、且不会误判。

### L3 渲染层：虚拟化 + 流式绕过 React

**消息列表虚拟化**（lib-chat-ui，`@tanstack/react-virtual`，注意包路径是 fork 版本 `@tanstack+react-virtual@3.1_…`）：

```js
useVirtualizer({
  count: childIds.length,
  getScrollElement: () => viewport?.scrollerRef.current ?? null,
  getItemKey: getFrameKey,
  estimateSize: getFrameEstimate,
  measureElement: directDomUpdates ? void 0 : measureFrameElement,
  anchorTo: resolveVirtualAnchorTo(directDomUpdates, suppressEndAnchorForUserExpand),
  directDomUpdates,
  scrollEndThreshold: directDomUpdates
});
```

**工具 diff 按行虚拟化**：

```js
useVirtualizer({
  count: lines.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ESTIMATED_LINE_HEIGHT,
  overscan: VIRTUAL_OVERSCAN,
  initialRect: { width: 0, height: 260 }
});
```

**定制补丁：`directDomUpdates`**（这是 fork 掉 tanstack 的原因）：

```js
function useVirtualizerBase({ useFlushSync = true, directDomUpdates = false, directDomUpdatesMode = "transform", ...options }) {
  const rerender = useReducer((x) => x + 1, 0)[1];
  const directRef = useRef({ enabled: directDomUpdates, mode: directDomUpdatesMode,
    container: null, lastSize: null, lastPositions: new WeakMap(), prevRange: null });
  const applyContainerSize = (instance) => { /* 直写 DOM，不进 React 状态 */ };
  ...
}
```

配套还有 `useCachedMeasurements`（测量结果缓存）、`scrollWithAdjustments`（滚动补偿，iOS 惯性滚动兼容）。

**要点**：流式输出时，元素位置更新走 **transform 直写 + WeakMap 缓存上次位置**，不触发 React 重渲；只有区间（可视范围）变化才走 React。这就是"出字时页面像没动过"的原因。

### L4 React 层与调度

- React **18.3.1**（包内 `node_modules/.pnpm/react@18.3.1`）
- `memo(` / `useMemo(` 全量 367 处，其中 `lib-chat-ui` 117 处
- rAF / `requestIdleCallback` 全量 596 处（`lib-chat-ui` 98 处、`ui-docs-viewer` 100 处）
- 骨架屏相关标识 1131 处（`lib-chat-ui` 358）

对照：本项目是 React 19 + Vite 8，具备同等能力，但**用得远比它稀疏**。

### L5 冷启动：内联 IIFE 吃掉 2.6 秒

`renderer/index.html` 头部内联脚本（注释即设计说明）：

```html
<!--
  首屏 account snapshot 早期消费（inline IIFE，parse 即执行）：
  - 主进程 loadFile 通过 ?accountSnapshot=<encoded> 注入上一次登录快照
  - 这里立即解出并挂到 window.__initialAccount，供 main.tsx 顶部同步调用
    accountService.setAccount(...)，让骨架屏拆除逻辑跳过等 daemon getAccount(≈2.6s) 的窗口
  - 契约来自 packages/workbuddy-app/src/shared/account-snapshot.ts；
    为压体积不 import，query key / window key / version 硬编码，改契约时**必须**同步
-->
```

另有多处结构化启动埋点：

```js
writeRendererLog("startup-perf", "info",
  `loadAllConversation done in ${(performance.now() - startTime).toFixed(0)}ms`);
```

**要点**：性能是**可观测**的（结构化日志带 elapsedMs），不是"感觉快了"。

### L6 CSS

桌面端 89 个 CSS（9.2MB）统计：

| 属性 | 数量 |
|---|---|
| `contain: content/strict/layout/paint/size` | 108 |
| `will-change` | 55 |
| `transform` | 2496 |
| `opacity` | 3396 |
| `transition` | 3258 |
| `overflow-anchor` | 2 |

**没有** `content-visibility`（JS 里那几处命中是 CSS 属性名白名单数组，不是实际使用——这点我核对过，避免误判）。

**要点**：用 `contain` 切断布局/绘制影响域，动画只动 `transform`/`opacity`（合成器线程），不碰 layout 属性。

---

## 三、对照：Codex Harness 的差距在哪

> ⚠️ 本节已于 2026-09-14 修订过一次：初版凭印象写了「全量渲染消息列表 / 每个 turn/completed 打一发 thread/list」，逐行核对代码后**证实不成立**（我们已有回合窗口化、侧栏刷新已 debounce 600ms）。下表是核对后的准确版本。**结论：我们的短板比初版说的窄得多，只剩 4 个真缺口。**

| 维度 | WorkBuddy | Codex Harness 现状（已核实） |
|---|---|---|
| 打开会话 | 命中 `messageCache` 直接渲染 | **已有**：`threadCacheRef` 秒开（先渲染缓存再后台对齐）+ `recentResumeAtRef` 30s 快路径 + `resumeThreadLight`（`excludeTurns` + 最新一页）+ `switchSeqRef` 序号丢弃陈旧响应（App.tsx:12963-13017）。**缺口**：首开（无缓存）仍要等 `thread/resume`（含 worker 内的 rollout enrich，`main.ts:2904`） |
| 翻历史 | 可视区虚拟化 | **已有**：回合窗口化 `TURN_WINDOW` + 分页游标增量续拉（App.tsx:13875-13887）。**缺口**：窗口内仍全量挂载——`content-visibility` 只省绘制，省不掉建元素与 Markdown 解析 |
| 大 diff / 长代码块 | **行级虚拟化**（`count: lines.length` + `overscan`） | 全量挂载（一个几千行的 diff 会真建几千个行节点） |
| 流式出字 | **`directDomUpdates`**：transform 直写 DOM，绕开 React 重渲 | 每个 delta 走 React state → 组件重渲 |
| 事件分发 | 按会话隔离 + `detach()` 摘监听 | 主进程**全广播**（`broadcastCodexEvent`，main.ts:317）。**注意**：`filterForRenderer`（main.ts:116）已写好按会话裁剪逻辑，因 09-12 一次「过滤与渲染层 activeThreadId 不同步 → 会话永久转圈」事故**临时回退为放行**，当前只累计 `rendererDroppedEventCount` 记账 |
| 会话列表刷新 | 增量 | **已有**：增量 `setThreads(map)` 为主 + 后台会话变化时 debounce 600ms 刷新（App.tsx:9826-9832） |
| 切回旧会话 | 缓存保住窗口与滚动位置 | **缺口**：`openThread` 把该会话 `turnWindow` 重置回 `TURN_WINDOW`（App.tsx:12897）——成本恒定（这是优点），但"内容变少、位置丢失"是体验代价 |
| 性能可观测 | `startup-perf` 结构化埋点（带 elapsedMs） | **缺口**：渲染层无切换耗时埋点，"卡"无法量化 |

### 3.1 一句话总结差距

我们的**数据层已经做对了**（缓存、快路径、轻量水合、序号丢弃），真正剩下的是**渲染层的两个半问题**：

1. 窗口内 / 大块内容不做可视区虚拟化（同一屏外的东西也在建 DOM、跑 Markdown）
2. 流式出字把 React 拖进了每一帧
3. 事件全广播（半成品：代码就绪，缺的是安全启用与量化验证）


---

## 四、建议落地清单（按性价比排序）

**P0（收益最大，改动可控）**

1. **打开会话改为乐观渲染 + 陈旧响应丢弃**
   - 现状：`thread/resume`（含 enrich）返回后才更新界面
   - 改法：先切到「目标会话的空骨架 + 缓存消息（如有）」，`resume` 结果回来再补齐；用 epoch token 丢弃过期响应（WorkBuddy 的 `t.current.begin/isCurrent` 模式，见其 `switchSession`）
   - 验收：连点 5 个会话不出现"错会话内容"，且首帧 < 100ms（e2e 打点断言）

2. **渲染层加会话级消息缓存 + 单飞**
   - 改法：`Map<threadId, Turn[]>`，切回已知会话直接渲染缓存；`Map<threadId, Promise>` 做单飞防重复 resume
   - 参照：`AgentNewAdapter.messageCache` + `currentActiveSessionPromise`
   - 验收：切回 A→B→A，第二次 A 不触发 `thread/resume`（断言 IPC 调用次数）

3. **主进程事件按会话过滤后再发**
   - 改法：`codex:event` 在 `sendToWindow` 之前按 threadId 过滤（保留生命周期白名单，否则侧栏转圈会失效——这条我们记忆里已记录）
   - 收益：切会话时的 IPC 序列化成本从 O(N 会话) 降到 O(1)

**P1（需要一点渲染层改造）**

4. **消息列表虚拟化**：TanStack Virtual（或自研 windowing）+ 稳定 `getItemKey`；先只对"非当前正在流式的历史消息"启用
5. **流式绕过 React**：当前 delta 只更新「最后一条消息」的文本节点，用 ref 直写 `textContent`，每 N ms 或 rAF 同步一次 React 状态（保证一致性）
6. **相邻会话预取**：切到 A 时后台 `resume` 侧栏里紧接着的 1~2 个会话（idle 回调里做，失败静默）

**P2（工程习惯，长期收益）**

7. **结构化性能埋点**：复用我们已有的 `codex:*` 主进程打点风格，渲染层对 `openThread / switchTab / firstPaintAfterSwitch` 打 `elapsedMs` 到 `renderer-perf.log`，让"卡"可复现、可对比
8. **冷启动快路径**：把"账号/配置/模型"快照由主进程注入首帧（我们现在是启动后 IPC 拉），减少一次首屏空窗

---

## 五、不能照抄的地方（风险提示）

1. **它的缓存模型依赖单机内存**：`messageCache` 按会话隔离常驻内存，长会话久了内存会涨（他们靠 `archiveSession/destroy` 释放）。我们若照抄，需要加 LRU 上限（例如最多缓存 8 个会话 / 单会话最多 200 条）。
2. **`directDomUpdates` 是 fork 的 tanstack 补丁**：自己维护虚拟化 + 直改 DOM，一致性风险高（滚动位置、测量缓存、React 状态三方要对齐）。建议我们先上「只读历史虚拟化」，流式路径暂时保留 React。
3. **协议侧它有服务端配合**（`historyEndOffset`、sandbox 冷恢复重试）：我们是 stdio JSON-RPC + 磁盘 rollout，**历史/实时边界要自己在宿主侧算**（我们已有 `turn-fold.ts` 纯函数，可复用为边界判据）。
4. **它是「单活动会话 + 多缓存」模型**，而我们支持多会话并行执行（侧栏多个转圈）。多会话并发时"缓存 + 单飞"要按 threadId 分片，别做成全局单飞。

---

## 六、复现方法（可自行验证）

```bash
# 1) 拆包（asar 路径要用 listPackage 返回的原样格式：去掉开头的分隔符，保留反斜杠）
node -e "const a=require('./node_modules/@electron/asar');
const P='<WorkBuddy>/resources/app.asar';
a.listPackage(P).filter(x=>x.includes('renderer')).slice(0,20).forEach(console.log)"

# 2) 提取桌面渲染层主 chunk（977 个 js，含 lib-chat-ui-*.js 10MB 核心）
#    注意：extractFile 不接受以 / 开头的路径，也不接受正斜杠
# 3) 关键检索词
#    messageCache / currentActiveSessionPromise   → 适配层缓存与单飞
#    directDomUpdates / useVirtualizer            → 渲染层虚拟化与直改 DOM
#    MessageLinkedList / isAuthoritativeTurnTerminal → 数据层
#    historyEndOffset / session.detach            → 协议层
#    startup-perf                                 → 启动埋点
```

**本报告的证据快照**（提取产物）保存在本地 `.workbuddy/wb-desktop/`，可直接 grep 复核。

---

## 七、方法学备注（诚实声明）

- 本报告是**静态逆向**结论：能证明"他们写成了什么结构"，不能直接证明"线上每一帧都这样跑"。要拿到帧率/耗时硬数据，需要对我们自己的应用做 CDP 基线测量（我们有 `electron-cdp-ui-e2e` 能力，可加一个 `switch-perf` 场景：连续切换 10 个会话，记录 `openThread 请求 → 首帧可交互` 的分布）。
- 未做：WorkBuddy 的运行时 profiling（无其调试端口）、网络/后端侧分析（daemon、sandbox-proxy 内部实现）。
- 已做的反证：`content-visibility` 在 JS 里命中 7 处曾看似"用了"，核对后确认是 **CSS 属性名白名单数组**，非真实使用——已从结论中剔除，避免编造。
