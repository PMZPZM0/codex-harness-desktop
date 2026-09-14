# 会话切换丝滑化改造清单（学 WorkBuddy）

> 依据：`docs/2026-09-14-workbuddy-session-switch-report.md`（WorkBuddy 桌面端 asar 逆向）
> 原则：**先量基线，再做改动；每项都要有能变红的断言，且不牺牲正确性换取流畅**

---

## ✅ 实施结果（2026-09-14 已落地并实测，commit 02ccecd）

| 项 | 状态 | 说明 |
|---|---|---|
| P2-1 基线埋点 | ✅ 完成 | `__adbg` 记录补 `mode(cached/fresh)` + 回合数；新增 `window.__switchPerfStats()`；`accept switch-speed` 扩展为**按组**断言 |
| P0-1 diff 行级虚拟化 | ✅ 完成 | `VirtualDiffLines`（overscan 40、行高 20px 与 CSS 严格一致、`contain: content`），仅 diff 且 > 400 行且未折行且非流式追字时启用 |
| P0-2 按会话裁剪事件 | ✅ 完成 | 从「只记账放行」改为**真的裁**；每窗口独立记 active thread（修掉弹窗/主窗共用全局变量互相覆盖的隐患）+ 30s 新鲜度 + 弹窗豁免 + null 判空 + `HARNESS_EVENT_FILTER=off` 逃生阀 |
| P1-1 窗口/位置记忆 | ✅ 完成 | 命中缓存的切换保留已展开窗口；离开记「距底偏移」、切回还原；两者 8 条 LRU |
| P1-2 冷加载骨架 | ✅ 完成（骨架） | 遮罩里先画出目标会话的名称/预览；**空闲预取未做**——`resume` 会带会话级作用域下发与动态工具注册等副作用，需单独一轮验证，不做半成品 |
| P0-3 流式直写 DOM | ⛔ 不实施 | 核查发现**我们早已按 rAF 合帧** delta（`pendingDeltaRef` + 首字即时路径，App.tsx:10734-10741）——WorkBuddy 那条收益我们已拿到；再做 DOM 直写只增一致性风险。其 `directDomUpdates` 是自维护 fork，不照抄 |

### 实测数据（`accept --only switch-speed`，23 个真实历史会话的持久 profile）

```
命中缓存（cached）: P50 20ms  · P95 182ms · max 182ms
冷加载  （fresh） : P50 206ms · P95 623ms · max 623ms
主进程事件裁剪   : 实测真的裁掉 38 条无关会话事件（droppedForInactiveSession=38）
resume 侧        : 均值 100ms / 最大 211ms，其中 rollout 增强均值仅 12ms
```

安全反证（`accept --only switch-running`，20 条断言）：切走期间正文 1230 → 1500 继续产出、切回非空白、仍在运行 —— 证明**启用事件裁剪没有打断任何会话的流式**。

> P1-1 的窗口记忆断言在本轮 profile 上被跳过（当前会话没有更早消息可展开 → 无前置条件时不产生假绿），已在场景里显式打印跳过原因。

---

## 0. 先说结论：我们缺的比想象中少

逐行核对代码后确认，**数据层我们已经做对了**：`threadCacheRef` 秒开、`recentResumeAtRef` 30s 快路径、`resumeThreadLight` 轻量水合、`switchSeqRef` 序号丢弃陈旧响应、回合窗口化 + 分页续拉、侧栏刷新 debounce 600ms。

真正剩下的是**渲染层的两个半问题** + 一个半成品开关：

| 编号 | 事项 | 类型 | 预期收益 | 风险 | 建议顺序 |
|---|---|---|---|---|---|
| P0-1 | 大 diff / 长代码块**行级虚拟化** | 渲染 | 高（长 diff 场景直接少建几千 DOM） | 低（纯展示组件） | ① 先做 |
| P0-2 | **启用按会话裁剪事件**（半成品启用） | 主进程 | 高（多会话并发时 IPC/序列化成本显著下降） | 中（曾出过事故，需双保险） | ② |
| P0-3 | 流式出字**直写 DOM**（窄方案） | 渲染 | 中高（长回复出字不再逐帧 diff） | 中高（一致性） | ④ |
| P1-1 | 窗口与滚动位置**按会话记忆** | 渲染 | 中（切回长会话不再"内容变少"） | 低 | ③ |
| P1-2 | 首开骨架 + 相邻会话**空闲预取** | 渲染+主进程 | 中（首开空窗变短） | 低 | ⑤ |
| P2-1 | **切换性能埋点 + 验收场景**（基线） | 工程 | —（基线，其他项都靠它证明） | 极低 | ⓪ 先做 |

> ⓪ **P2-1 应该第一个做**：没有基线，后面所有"变快了"都是感觉。它同时也是所有优化项的公共断言载体。

---

## P2-1（先做）切换性能基线：埋点 + 验收场景

**学谁**：WorkBuddy 用 `writeRendererLog("startup-perf", "info", \`loadAllConversation done in ${ms}ms\`)` 把性能写成**结构化日志**；`recordHistoryUiRendered()` 把"历史首次渲染完成"打点。

**我们现状**：渲染层无切换埋点。主进程侧已有打点习惯（`main.ts:63` 注释里的 `thread/resume 总耗时 / enrich 耗时`、`resumeEnrichMs`），可以对齐风格。

**改法**
1. `electron/main.ts`：`resumeCount/resumeEnrichMs/resumeMaxMs` 已有 → 加一条 IPC `perf:switch-stats` 返回均值/最大值，或写入 `userData/renderer-perf.log`。
2. `src/App.tsx`：在 `openThread(id)` 入口记 `t0`，在「缓存首帧提交完成」（`requestAnimationFrame` 之后）与「resume 补齐后再次提交完成」两处记 `t1/t2`，输出 `switch-perf { threadId, cachedPaintMs, settledMs, turns, items }`。
3. `scripts/accept.mjs` 新增场景 `switch-perf`：连续切换 10 个会话（含 1 个长会话），采集两组数值，断言 `P95(cachedPaintMs) < 150ms` 且 `P95(settledMs) < 1500ms`（阈值先按现状测出的基线 ×1.2 定，避免假绿）。

**验收/反证**：故意在 `openThread` 里插一段 `for(1e7)` 空转 → 断言必须变红。

---

## P0-1 大 diff / 长代码块行级虚拟化（性价比最高）

**学谁**（证据）：
```js
// WorkBuddy lib-chat-ui：工具 diff 按行虚拟化
useVirtualizer({
  count: lines.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ESTIMATED_LINE_HEIGHT,
  overscan: VIRTUAL_OVERSCAN,
  initialRect: { width: 0, height: 260 }
});
```

**我们现状**：回合窗口化已经限制了**回合数**，但窗口内每个 item 全量挂载；一个 3000 行 diff 就会真建 3000 个行节点 + 语法高亮。

**改法**
1. 抽一个 `VirtualLines` 组件（`src/components/`）：固定行高（`ESTIMATED_LINE_HEIGHT`）+ `overscan` + 容器 `height` 约束（`max-h-*` 已有），行渲染函数透传。
2. 接入点：diff 视图、超长代码块（> N 行，N 取 200）、终端/日志类只读面板。
3. 保留「全文复制/全屏查看」入口（虚拟化后 DOM 不全，复制要读数据源而非 DOM——**这条是常见 bug 源**，必须显式处理）。

**预期收益**：长 diff 场景首帧 DOM 数从 O(行数) 降到 O(可视行数)。

**风险**：① 复制/查找行为（Ctrl+F 只能命中已挂载行）→ 文档里写清，或对 < 500 行的块不虚拟化；② 行高变化（换行折行）→ 先只对 `white-space: pre` 不折行的块启用。

**验收**：accept 场景渲染一个 3000 行 diff，断言 `document.querySelectorAll('.diff-line').length < 120`，同时断言「复制全文」得到 3000 行。

---

## P0-2 启用按会话裁剪事件（半成品收尾）

**学谁**：WorkBuddy 的 `AgentNewAdapter` 用 `listenedSessionIds` + `session.detach()` 让「监听」严格跟当前会话走，切走就摘。

**我们现状**（证据）：`electron/main.ts:116` 的 `filterForRenderer` **已实现完整裁剪逻辑**，但 09-12 因「过滤与渲染层 `activeThreadId` 上报不同步 → 某个会话收不到自己事件 → 永久转圈」而**临时放行**，只累计 `rendererDroppedEventCount`。代码注释写明了启用方式：`return null`。

**改法（三步，都不改行为语义）**
1. **先量化**：跑一轮多会话 accept（3 个会话同时跑），读 `rendererDroppedEventCount` 与 `rendererActiveThreadId`，确认裁剪量级与上报时机。
2. **双保险裁剪**：
   - 保留 `RENDERER_CROSS_SESSION_METHODS` 白名单（生命周期类）**永不放行裁剪**；
   - 追加三条放行：① 该 threadId 属于**本窗口 popout 锁定会话**；② 该 threadId 处于 **running** 集合（主进程侧 `engineActiveTurnIds` 已有）；③ `rendererActiveThreadId` **为空或超过 N 秒未上报**（视为不可信 → 放行）。
   - 裁剪命中后再落一次 `rendererDroppedEventCount` 便于回滚判断。
3. **回退开关**：环境变量 `HARNESS_EVENT_FILTER=off` 一键回到放行态（不依赖改代码）。

**预期收益**：多会话并发时，渲染层收到的无关事件量下降接近 O(会话数) 倍；IPC 序列化 + 渲染层解析成本同步下降。

**风险**：这是**唯一曾经出过线上事故**的项 → 必须有 ② 的三条放行 + ③ 的回退开关，且验收里要有「三个会话同时跑，逐一会话断言各自仍在出字、不转圈」。

**验收（必须反证）**：
- 正例：3 会话并发跑，切换其间 A 会话持续出字、B/C 不中断。
- 反例：把放行条件②去掉（模拟不同步）→ 断言必须能抓到"某会话卡在 running"。

---

## P0-3 流式出字直写 DOM（窄方案，不 fork 虚拟化）

**学谁**：WorkBuddy fork 了 `@tanstack/react-virtual` 加 `directDomUpdates`（`mode: "transform"` + `WeakMap lastPositions`），流式期间直接改 DOM 位置，不走 React。

**我们现状**：每个 `item/agentMessage/delta` 都进 React state → 整条消息组件重渲（我们 09-12 已做过一轮优化：不再 stringify 整段正文，但**仍是 React 渲染**）。

**改法（比他们保守，只拿收益最大的那一小块）**
1. 只对**正在流式的那一条** agentMessage 的文本节点做直写：`ref` 持有 `<div>`，delta 到达时 `node.textContent += delta`（或按 rAF 合批），React 状态每 **200ms** 或回合结束时同步一次。
2. 直写期间给容器加一个 `data-streaming` 标记；React 提交时**以状态为准整体覆盖**（避免两边文本打架）。
3. Markdown 增量解析保持现状（它们也只在稳定后做完整渲染）——即"流式期间显示 raw 文本/简化渲染，结束后再上 Markdown"，这本身也是省 CPU 的关键。

**风险**：① React 与手写文本不一致（用第 2 条覆盖 + 结束同步兜住）；② 滚动锚定需在直写后手动触发一次贴底（我们现在靠 `switchJumpRef`/`jumpToBottom`）。

**验收**：accept 场景统计「一次长回复（>2000 字）期间，消息组件的 React 提交次数」——现有基线 vs 改后，断言下降 ≥80%；同时断言最终渲染文本与引擎 rollout 完全一致（防丢字/重字）。

---

## P1-1 切回旧会话：窗口与位置记忆

**学谁**：WorkBuddy 的 `messageCache` 按 `sessionId` 隔离常驻，切回时"窗口与位置都在"（他们只在 `archiveSession/destroy` 时清理）。

**我们现状**（证据）：`App.tsx:12897` 打开会话时把该会话 `turnWindow` 重置为 `TURN_WINDOW`——**成本恒定是有意设计**（注释写明），但用户切回刚看过的长会话会发现"刚才往下翻的内容没了"。

**改法**：把 `turnWindow[id]` 与「距底滚动位置」存进 `threadCacheRef` 的会话缓存（已存在），切回时若命中缓存则恢复窗口与位置、未命中才重置。加 LRU 上限（建议 8 个会话）防止内存无限涨。

**验收**：切到长会话 → 展开到 3×TURN_WINDOW → 切走 → 切回 → 断言窗口数仍为 3×TURN_WINDOW 且滚动位置差 < 50px；再切 9 个不同会话后断言最早的已被淘汰（LRU 生效）。

---

## P1-2 首开骨架 + 相邻会话空闲预取

**学谁**：WorkBuddy 的骨架优先（`skeleton` 标识 1131 处）+ 主进程把账号快照注入首帧跳过 2.6s 等待。

**我们现状**：无缓存首开要等 `thread/resume`（含 worker 内 rollout enrich）。已有 `switchingMeta` 兜住标题，但正文空窗。

**改法**：① 首开时立刻渲染「回合骨架」（按 `threads` 列表里的 `preview` 先画一条用户消息，避免全白）；② `requestIdleCallback` 里预取侧栏相邻 1~2 个会话（`resumeThreadLight`，失败静默、不写缓存以外的副作用）。

**验收**：打开无缓存会话，断言首帧 < 100ms 内有骨架节点；预取断言：切到相邻会话时命中缓存（即 `cachedPaintMs` 显著小于 `settledMs`）。

---

## 不建议照抄的部分（重要）

1. **不要自己 fork 虚拟化库**：WorkBuddy 的 `directDomUpdates` 是自维护补丁（测量缓存 + 滚动补偿 + React 状态三方对齐），维护成本高。我们用 P0-1（行级）+ P0-3（文本直写）这两个**窄方案**就能拿到大部分收益。
2. **缓存必须有 LRU 上限**：他们是"单活动会话 + 内存缓存"，长会话久开内存会涨。我们 `threadCacheRef` 同样要设上限（建议 8 会话 / 单会话最多 200 回合）。
3. **不要用流畅换取正确性**：任何"跳过 resume/跳过校验"的快路径，都要有「引擎侧真值兜底」的断言（我们踩过：只断言 UI/localStorage 在真 bug 下照样绿）。判据一律读引擎侧（rollout / `turn_context`）。
4. **虚拟化后 Ctrl+F / 复制语义会变**：必须同时提供"按数据源复制/搜索"的入口。

---

## 实施顺序（建议）

```
P2-1 基线埋点 + accept switch-perf        ← 先做，其他项都要它证明
  ↓
P0-1 diff/代码块行级虚拟化（独立、低风险）  ← 收益最快
  ↓
P0-2 事件裁剪启用（需要一轮并发验证）
  ↓
P1-1 窗口与位置记忆（低风险，体验感知强）
  ↓
P0-3 流式直写 DOM（最高风险，最后做）
  ↓
P1-2 骨架 + 预取（收尾）
```

每项落地时按项目铁律走：`README/AGENTS 同步 → accept 补断言（含反证）→ git 提交`。
