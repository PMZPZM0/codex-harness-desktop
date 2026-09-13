# 多会话丝滑不卡 — 引擎层设计与宿主改造方案

> 起因：用户反馈「多会话并行跑，应用很卡」。
> 本文基于：① Codex 引擎（`@openai/codex` **0.153.4**）的实测协议面与 CLI 能力；② 本项目宿主（`electron/` + `src/App.tsx`）的只读性能审计；③ DSH Desktop 2.0.9 的对照实现（报告见 `.workbuddy/reference/DSH-多会话并发设计分析报告.md`）。
> 日期：2026-09-12。**本文只做设计，未改任何源码。**

---

## 一、结论先行

**引擎本身没问题，而且天生就是为多会话设计的。卡是我们宿主层把它用成了单会话。**

三句话：

1. **引擎侧**：一个 app-server 进程内多 thread 真并行，事件按 `threadId` 精确归属，官方还提供**常驻 daemon** 与**多种传输**。引擎不含任何「每会话一进程」的设计 —— 我们也不需要。
2. **宿主侧**：真正的瓶颈是**在请求路径上做同步磁盘 I/O**（`thread/list` 每次全量扫 rollout、`thread/resume` 每次全量重解析），以及**事件全广播不过滤**。前者是 O(N²) 且阻塞事件循环，后者是无谓的 N 倍 IPC。
3. **渲染侧**：流式合帧与回合 memo 已经做对了；问题在**未被 memo 的 App 级计算**与**几个纯浪费的定时器/依赖**（每秒空转的 `nowTick`、把 `tokenUsage` 灌给全部 40 个回合）。

---

## 二、引擎能力实测（决定设计边界）

### 2.1 一个进程承载多会话，是官方形态

```
codex app-server --listen <URL>
    Supported: stdio:// (默认) | unix:// | unix://PATH | ws://IP:PORT | off

codex app-server daemon start|stop|restart|version        ← 常驻 daemon
codex app-server proxy                                    ← 转发到运行中的控制 socket
codex remote-control start|stop|pair                      ← 带远程控制的 daemon
codex agents                                              ← 浏览「共享本地 app-server daemon」上的全部会话
```

要点：
- **`ws://IP:PORT` 是一等公民**（还带 `--ws-auth capability-token|signed-bearer-token`、`--ws-token-file`、JWT 校验参数）→ 引擎原生支持**多客户端连同一个 app-server**。
- `daemon` 提供进程级生命周期管理（`version` 还能对比 CLI 与运行中 daemon 的版本）。
- 我们目前用的是 `stdio://` + 每应用实例 spawn 一个。**这没有问题**（一个实例一个引擎是对的），但意味着：**绝不能在会话操作路径上重启引擎**（见 4.3）。

### 2.2 协议面：99 个客户端方法 / 81 个引擎通知

**语义完备的会话原语**（客户端 → 引擎，节选）：

| 类别 | 方法 |
|---|---|
| 线程生命周期 | `thread/start` `thread/resume` `thread/fork` `thread/archive` `thread/unarchive` `thread/delete` `thread/rollback` `thread/revert` |
| 读取（**分层，可低成本**） | `thread/list` `thread/loaded/list` `thread/read` `thread/items/list` `thread/turns/list` |
| 运行控制 | `thread/compact/start` `thread/inject_items` `thread/shellCommand` `review/start` |
| 目标/元数据 | `thread/goal/set|get|clear` `thread/metadata/update` `thread/name/set` `thread/section/move` |

**引擎通知全部带 `threadId` 归属**（引擎 → 客户端，节选）：

| 类别 | 通知 |
|---|---|
| 生命周期（**轻量**） | `thread/started` `thread/closed` `thread/status/changed` `thread/name/updated` `thread/settings/updated` `thread/queue/changed` |
| 回合（**轻量**） | `turn/started` `turn/completed` `turn/plan/updated` `turn/diff/updated` |
| 流式（**高频/大 payload**） | `item/agentMessage/delta` `item/reasoning/textDelta` `item/reasoning/summaryTextDelta` `item/plan/delta` |
| 大 payload 大户（**最危险**） | `item/commandExecution/outputDelta` `item/fileChange/outputDelta` `item/fileChange/patchUpdated` `process/outputDelta` `command/exec/outputDelta` `mcpServer/event/stream/notification` |
| 结构事件（**单次、含全文**） | `item/started` `item/completed` |

👉 **设计含义**：引擎已经把「按会话精确归属」做完了。**过滤应该发生在主进程转发给渲染层的那一刻**，而不是让渲染层收到再丢。

### 2.3 两个容易误用的协议点（实测澄清）

- **`steer` 不是通用插话**：schema 里的 `MisalignmentSteer`（`codex_app_server_protocol.v2.schemas.json:10927`）描述是 *"Instruction to submit as the next turn's user input **if continuation is confirmed**"* —— 它是**模型跑偏时的续跑补救**，不是「回合中插话」的用户功能。别拿它当 steering 用。
- **`thread/inject_items` 才是注入**：需要往会话里塞内容时用它，而不是伪造 `turn/start`。

---

## 三、瓶颈定位（宿主侧，实测证据）

### P0 ─ `thread/list` 每次触发全量同步 rollout 扫描 → O(N²) + 阻塞事件循环 🔴

```ts
// electron/main.ts:2467-2472   —— 无缓存、无开关，每次必扫
if (method === "thread/list") {
  const indexed = Array.isArray(response?.data) ? response.data : [];
  const fallback = listRolloutThreads(codexHome);     // ← 同步全量扫
  result = { ...response, data: mergeThreadList(indexed, fallback, ...) };
}
```
```ts
// electron/session-tools.ts:222-250 —— 遍历目录树 + 逐文件全文同步读 + 逐行 JSON.parse
export function listRolloutThreads(codexHome: string) {
  const roots = [join(codexHome, "sessions"), join(codexHome, "archived_sessions")];
  ...
  const stat = statSync(full);
  for (const line of readFileSync(full, "utf8").split(/\r?\n/)) { ... JSON.parse(line) ... }
```
调用侧（渲染层）：`src/App.tsx:10017` 每个 `turn/completed` 打一发 `refreshThreads()`；`src/App.tsx:9849-9851` 后台会话完成时再打一发（600ms 去抖）。

**放大模型**：调用次数 ∝ 完成回合数（∝ N），每次仍扫全部 N 份历史 ⇒ **严格 O(N²)**。
**为什么「同时跑多个会话」才明显**：全是 `*Sync`，扫描期间**同一 JS 线程上的 `codex:event` 转发全部停摆** → 所有会话一起卡。单会话时 N 小、感知不到。

> 注：函数注释说它是「app-server 索引尚未完成迁移时的兜底」。**兜底不该无条件每次跑。**

### P1 ─ 后台会话状态事件触发 App 级重渲染，且 App 有未 memo 的重量级计算 🟠

- `src/App.tsx:9837-9845`：非当前会话的 `thread/status/changed` → `setThreads(全量 map)` + 无条件 `markThreadRunning`。
- `src/App.tsx:6375-6383`：`markThreadRunning` **永远换新 Set 引用**（即使 id 已在集合里）→ React 必定重渲染，没有「值未变则跳过」短路。
- 未 memo 的渲染期计算：`src/App.tsx:12793-12820`（`paletteSections` IIFE，每次渲染过滤 threads + 整棵项目树）、`12824`（`completedTurns` O(回合) 新数组）、`12831`（`turns.some` O(回合)）、`4846-4861`（`userMarksKey` O(全历史) 字符串拼接，被 `MemoMessageRuler` comparator 调用 → **流式每帧两次**）。

### P2 ─ IPC 全量广播、无过滤无裁剪 🟠

```ts
// electron/main.ts:1821-1825
server.on("event", (event) => {
  sendToWindow("codex:event", event);      // 全量序列化，不分会话
  channelBot.handleCodexEvent(event);
  voiceService.handleCodexEvent(event);
  ...
});
```
渲染层在 `src/App.tsx:9853` 对非当前会话直接 `return` —— **序列化 + 反序列化的成本已经付了却丢掉**。

### P3 ─ `tokenUsage` 灌给窗口内全部回合 🟡

`src/App.tsx:10031-10034` `setTokenUsage` → `13098` 把同一个对象传给**每个** `MemoTurnView` → comparator（`5322-5333`、`5247-5255`）显式比较 `tokenUsage` ⇒ **一次用量更新击穿窗口内全部 40 回合 + 其下所有 item 视图**。

### P4 ─ `channel-bot` 对所有会话累积正文 🟡

`electron/channel-bot.ts:100-106`：**既不检查是否启用、也不按 threadId 过滤**，对每条 `item/agentMessage/delta` 做 `+` 字符串拼接（O(n) 拷贝 → 长回复 O(n²)），只在 `finishTurn:211` 清理。未配机器人时纯浪费，随会话数线性增长。

### P5 ─ 每秒空转的 App 级定时器（纯浪费）🟡

`src/App.tsx:7930` 定义 `nowTick`，`9104-9108` 每秒 `setNowTick(Date.now())`；**而 App 侧从来没有读取它**（grep 全部命中：3175/3206、3344/3555/3607 都是**其它组件各自的** state；7930 是唯一写入点）。

⇒ 只要当前会话有回合在跑，**每秒强制 App 全量重渲染一次**，而 App 是 1.1 MB / 15,743 行的单组件，渲染体内还叠着 P1 的全部未 memo 计算。多会话时 `workStartedAt` 几乎长期非空 ⇒ 常驻。

### P6 ─ 切会话：主进程每次都全量重解析 rollout 🟡

`electron/main.ts:2480-2481`：`thread/resume` 无条件 `enrichThreadWithRolloutTools`；`electron/session-tools.ts:83-97` 的 `parseRollout` 虽有 mtime 缓存，但**正在跑的会话持续追加 → mtime 变 → 每次都重解析全文**；随后 `168-183` 还有 `for (const [candidateKey, candidate] of recordGroups)` 二层循环。

### P7 ─ 揭示动画：每项一个 16ms 定时器 + 无合帧的全局事件 🟡

`src/App.tsx:4955-4961`（正文）/`5055-5061`（思考）各 `setInterval(..., 16)` 并 `dispatchEvent(new Event("codex:packet-reveal"))`；`8831-8842` 的监听端**每次事件各排一个 rAF**，回调里读 `scrollHeight`（强制同步布局）。k 个并发揭示 → 每帧 k 次强制布局 + k 次滚动写；软件渲染（本机 `gpu_compositing: disabled_software`）下被放大。

---

## 四、设计：保证多会话丝滑的四道闸门

> 这四条对应 DSH 已验证的四道闸门（详见对照报告），但按**我们的协议与代码结构**重新落地。

### 闸门 1 ─ 请求路径上零同步 I/O（最高优先）

**原则**：`ipcMain.handle("codex:request")` 的处理链上**只允许内存操作与 `await` 异步 I/O**。任何 `*Sync` 都不许进这条路径。

- `listRolloutThreads`：降级为**真正的兜底**——仅当 `indexed.length === 0` 时才扫；扫描结果按根目录 + 最高 mtime **做进程内增量缓存**（只重解析 mtime 变化的文件，其余复用）。
- `enrichThreadWithRolloutTools`：加「本会话已 enrich 且 rollout 大小/mtime 未变 → 直接返回」短路；`parseRollout` 改**增量解析**（记住上次 offset，只 parse 追加行）。
- 兜底兜不住时：把扫描挪到 `setImmediate` / `worker_threads`，**永不阻塞事件循环**。

### 闸门 2 ─ 按会话投递，而不是全广播

**原则**：主进程知道渲染层「正在看哪个 thread」，只发它需要的。

```
渲染层新增：codex:set-active-thread(threadId)      // 切换会话时上报
主进程维护：activeThreadId

转发规则（sendToWindow("codex:event", e) 之前）：
  ├─ 事件属于 activeThreadId            → 原样全量转发
  ├─ 轻量生命周期/状态类（白名单）        → 转发（不论属于哪个会话）
  │    thread/started · thread/status/changed · thread/name/updated
  │    thread/closed · thread/archived · thread/queue/changed
  │    turn/started · turn/completed      ← 侧栏转圈与运行状态靠它们
  └─ 其余（delta / item/* / *outputDelta） → 非当前会话则**丢弃**
```

收益：消掉 P2 的 N 倍 IPC；同时天然消掉 P1 里「后台 delta 引起的无用 setState」。
注意：**必须保留轻量白名单**，否则侧栏运行状态会失效（`markThreadRunning` 依赖它们）。

### 闸门 3 ─ React 侧只让「真正变了的东西」重渲染

1. `markThreadRunning/Stopped` 先判值：集合里有/没有该 id 且 turnId 相同时 **直接 return**（不换新 Set 引用）。
2. `tokenUsage` 不当作 prop 灌给每个回合——改成 React context 或只在 `ContextRing`/`ContextUsageBadge` 订阅（P3）。
3. `paletteSections` / `completedTurns` / `runningInThread` 收进 `useMemo`（P1）。
4. `userMarksKey` 改为基于 `turn.id + item.id` 的稳定签名，避免流式期间 O(全历史) 拼接（P1）。
5. 删掉 App 里那个**只写不读**的 `nowTick` 定时器（P5）。
6. 揭示动画的 `packet-reveal` 加「本帧已排」标志合帧；理想是把揭示交给单一 rAF 驱动（P7）。

### 闸门 4 ─ 高频与大 payload 分开治

| 事件类型 | 处置 |
|---|---|
| `item/agentMessage/delta`、`item/reasoning/*Delta` | 已在渲染层 24ms + rAF 合帧 ✅ 保留；主进程按闸门 2 过滤 |
| `item/commandExecution/outputDelta`、`item/fileChange/outputDelta`、`process/outputDelta` | **按字节/条数节流后再转发**（例如 50ms 合并或累积到阈值），并给单条设上限 |
| `item/completed`、`turn/completed`（含整回合 items 全文） | 非当前会话时**只发摘要**（id/status），不透传 `turn.items` |
| `kind:"log"`（引擎 stderr） | 渲染层直接丢（`src/App.tsx:9825`）→ **主进程干脆别转发**；`debugLog` 的 `statSync + appendFileSync` 改批量异步（`electron/codex-server.ts:160,191-199`） |

---

## 五、落地顺序与验收

| 阶段 | 改动 | 触及文件 | 与并行 agent 冲突 |
|---|---|---|---|
| **S1** | 删 `nowTick` 空转定时器；`markThread*` 加值判短路；`paletteSections`/`completedTurns` 收 `useMemo`；`tokenUsage` 改 context | `src/App.tsx` | ⚠️ 同文件，需等其修完 |
| **S2** | 闸门 1：`thread/list` 兜底化 + 增量缓存；`enrichThreadWithRolloutTools` 短路 + `parseRollout` 增量 | `electron/main.ts`、`electron/session-tools.ts` | ✅ 无冲突，可先做 |
| **S3** | 闸门 2：`codex:set-active-thread` + 主进程按会话过滤/裁剪 | `electron/main.ts`、`electron/preload.ts`、`src/vite-env.d.ts`、`src/App.tsx` | ⚠️ 含 App.tsx |
| **S4** | 闸门 4：大 payload 节流 + 日志批量异步；`channel-bot` 启用/绑定短路 | `electron/main.ts`、`electron/codex-server.ts`、`electron/channel-bot.ts` | ✅ 无冲突 |

**验收（按项目铁律）**：
- 新增 e2e 场景 `multi-session-smooth.mjs`：真起引擎、开 **3 个会话**同时发消息，断言：
  1. 三个会话都真跑起来（读各自 rollout 的 `turn_context.model`）；
  2. 后台会话的 delta **没有**进入渲染层（对 `codex:event` 打点计数）；
  3. 主进程 `thread/list` 的同步扫描次数 = 0（或仅在 `indexed` 为空时 1 次）——给 `listRolloutThreads` 加调用计数供断言读；
  4. 全程渲染层无 console.error，且 `App` 在 1 秒内的重渲染次数有上限（可注入计数器）。
- **断言必须反证一次**（把过滤关掉 → 断言 2 必须红；把兜底改回无条件 → 断言 3 必须红）。
- 发版前 `npm run e2e -- --all` 全量。

---

## 六、明确不做（避免过度设计）

- ❌ **不做「每会话一引擎进程」**：引擎协议与官方 daemon 模型都是单进程多 thread，多进程只会把内存翻 N 倍（本机现在只剩 1.8 GB 可用）。
- ❌ **不做自有 IPC 多路复用/自定义传输**：我们与引擎是同机 stdio，`JSON.parse` 一条行的成本可忽略；瓶颈在同步磁盘 I/O，不在管道。
- ❌ **不引入 react-virtual 重写时间线**：已有 `content-visibility: auto` + `TURN_WINDOW=40` 窗口化，收益低于风险。
- ❌ **不用 `steer` 做插话**：它是模型跑偏补救，不是用户功能（见 2.3）。

---

## 七、遗留未知（需实测才能定量）

1. `thread/status/changed` 与 `thread/tokenUsage/updated` 的**真实发射频率**（引擎 Rust 侧行为，仓库内无定义）→ 决定 P1/P3 量级。建议先加**只计数不改逻辑**的打点。
2. `item/commandExecution/outputDelta` 的单条与累计字节量级 → 决定闸门 4 的节流阈值。
3. 本机是软件渲染 + 只剩 1.8 GB 可用内存，**任何优化都会被打折**；压测应在关掉其它 Electron 应用后进行。

---

## 附：证据索引

| 结论 | 证据 |
|---|---|
| 引擎支持 daemon / ws / 多传输 | `codex app-server --help`、`codex app-server daemon --help`、`codex agents --help` |
| 协议 99 方法 / 81 通知 | `.tmp/codex-schema-new/{ClientRequest,ServerNotification}.json`（由 `codex app-server generate-json-schema` 生成） |
| `steer` 是误配补救 | `codex_app_server_protocol.v2.schemas.json:10927`（`MisalignmentSteer`） |
| P0 同步扫描 | `electron/main.ts:2467-2472`、`electron/session-tools.ts:222-250` |
| P1 未 memo 计算 | `src/App.tsx:6375-6383, 9837-9845, 12793-12831, 4846-4861` |
| P2 全广播 | `electron/main.ts:1821-1825`、`src/App.tsx:9853` |
| P3 tokenUsage 穿透 | `src/App.tsx:10031-10034, 13098, 5322-5333, 5247-5255` |
| P4 channel-bot 无过滤 | `electron/channel-bot.ts:100-106, 211` |
| P5 nowTick 空转 | `src/App.tsx:7930, 9104-9108` |
| P6 resume 全量解析 | `electron/main.ts:2480-2481`、`electron/session-tools.ts:83-97, 168-183` |
| P7 揭示无合帧 | `src/App.tsx:4955-4961, 5055-5061, 8831-8842` |
| 已排除项（勿重复排查） | `src/App.tsx:9858-9898`（delta 合帧有效）、`5322-5333`+`7994-8012`（memo 有效）、`electron/voice/voice-service.ts:367-371`（空闲零成本）、`electron/codex-server.ts` 无深拷贝、`src/styles.css:1555-1582`（content-visibility 真实生效） |
