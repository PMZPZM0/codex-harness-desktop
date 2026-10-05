# 统一记忆架构（Unified Memory Fabric）

> 状态：**10-05 实施中** —— 本文件是记忆系统的**架构真相源**。
> 实现落点：`electron/memory-fabric.ts`（内核）、`electron/memory-fabric-tool.ts`（写入面）、
> `electron/delegate-memory.ts`（委派侧读）、`electron/features/memory-ipc.ts`（渲染层读）。
> 守卫：`scripts/guards/11l-memory-fabric.mjs`。⛔ 改架构先改本文件，再改代码。
> 与既有文档的关系：L0–L7 分层的事实源仍是 `electron/memory-layers.ts`（**未改动**），
> 本文件描述的是**在它之上新增的统一寻址与条目模型**。

---

## 0. 为什么要改造（改造前的实测现状）

10-05 改��前，全仓有**两套并行**的记忆实现，各自独立、互不知道对方存在：

| | 系统 A：L0–L7 分层 | 系统 B：角色私有记忆 |
|---|---|---|
| 实现 | `memory-layers.ts`（53KB）+ `memory-store.ts` 碎片池 | `role-memory.ts`（15KB） |
| 谁写 | **只有主会话**（`memory_save` 工具 → 分类） | **只有角色会话**（`role_memory_save`） |
| 存哪 | L1/L1.5 在 `<workspace>/.codex-harness/memory/`；碎片池在 `userData/memory.json`（**全局一个**） | `<workspace>/.codex-harness/memory/roles/<键>/MEMORY.md` |
| 读 | 全体（含被委派会话，经 `delegate-memory.ts` 补齐） | 仅该角色自己 |
| 条目形态 | **纯 Markdown 追加行** | **纯 Markdown 追加行** |

**四个真实缺陷**（都是查代码查出来的，不是推测）：

1. **主会话自己没有会话记忆**。你和我聊过的这个项目里，A 会话说过的话 B 会话读不到
   —— 项目记忆是"提炼后"的结论，不是过程。
2. **条目无元数据**。一行文本里没有：谁写的、哪个会话写的、什么时候写的、有多重要。
   ⇒ 无法按相关性排序、无法按会话过滤、无法做生命周期（归档/删除）裁决。
3. **两套写入面名字不同、语义不同**（`memory_save` vs `role_memory_save`），
   模型必须自己判断"我这次该用哪个"，是"两套同名能力"这类坑的变体。
4. **碎片池检索不过滤**。`memory-store.ts:175` 的 `search()` 对跨工作区只**降权到 0.5**、
   **不过滤** ⇒ 靠给它加字段永远拦不住串扰。

改造目标：**一个内核、一套写入面、两种作用域（会话隔离 / 项目共享）、条目结构化**。

---

## 1. 分层结构

⛔ **两个维度是正交的，不要混为一谈**：

- **维度 A · 内容层（这个信息有多稳定 / 属于哪类知识）** = 既有 L0–L7，**不动**
- **维度 B · 作用域（谁能看到）** = 本次新增，**只做两级**

### 维度 A · 内容层（既有，本次不改）

| 层 | 内容 | 作用域（改造前的实际） |
|---|---|---|
| L0 | 用户档案 | 跨项目（userData） |
| L1 | 项目背景 / 目标 | 项目 |
| L1.5 | 项目背景补充 | 项目 |
| L2 | 工作流 / SOP | 项目 |
| L3 | 任务经验 | 项目（召回式） |
| L4 | 近期工作日志 | 项目 |
| L5 | 踩坑与纪律 | 项目 |
| L6 | 归档 | 项目 |
| L7 | 蒸馏态 | 项目 |

### 维度 B · 作用域（本次新增）

```
MemoryScope = "session" | "project"
```

- **`session`（会话记忆）** —— 按 `threadId` 硬隔离。
  ⛔ **只允许本人读本人**：别的会话读不到、检索不到、也绝不会出现在注入里。
  生命周期跟随会话（见 §6）。
- **`project`（项目记忆）** —— 按 `workspace` 命名空间，**全局共享**：
  跨会话、跨角色（主会话 / 子智能体 / 专家 / 专家团主 / 团成员）**统一读写**。
  生命周期跟随**项目**（跟项目走、跟 git、跟迁移）。

**为什么只有两级**（用户要求就是这两个）：再加"角色级"就等于把上一轮的 `role` 概念
原样保留 —— 那会造成"同一个专家在两个会话里记忆不互通"，而用户这次明确要
**"被调度的专家智能体与主会话共用同一套记忆实现"**。⇒ 角色**不再是存储维度**，
只是**写入者身份**（`sourceAgent` 字段），它写进 `session` 或 `project` 由目标作用域决定。

> ⚠️ **迁移**：上一轮的 `roles/<键>/MEMORY.md`（四类角色私有记忆）**不删除**，
> 由 §7 的兼容读路径继续可读，但**新写入一律走统一内核**。理由：删了会让用户
> "专家记得的事"凭空消失；不删则零风险，且旧文件在 §7 里被当作 `project` 层的补充来源。

---

## 2. 命名空间与作用域边界

### 2.1 命名空间键

```
namespace = `${scope}__${ownerId}`       // 所有者
     例：session__01a1078e-...-9f2c
         project__D__11                 （路径规范化：分隔符与非法字符 → "_"）
```

⛔ **分隔符绝不能用 `:`** —— Windows 文件名非法字符，**实跑验证过**：
`mkdir` 直接 ENOENT，条目一个都写不进去，而纯文本守卫全绿（见 `role-memory.ts:64` 的踩坑记录）。
⛔ 所有者 id 里的路径分隔符 / 非法字符统一净化并**截断到 64 字符**。

### 2.2 作用域边界表（这张表是全部隔离规则的唯一出处）

| | `session` 作用域 | `project` 作用域 |
|---|---|---|
| 归属键 | `threadId` | 规范化后的 `workspace` |
| 主会话读 | ✅ 自己 | ✅ |
| 主会话写 | ✅ | ✅ |
| 角色会话读 | ✅ 仅**它自己那个** session | ✅ |
| 角色会话写 | ✅（仅它自己的） | ✅（由它自己的闸决定，见 §4.2） |
| **A 会话读 B 会话** | ❌ **结构上不可能**（键不同 = 另一个目录） | ✅ 允许（这是"共享"的定义） |
| 角色读别的角色 | ❌ 不可能 | ✅ 允许 |
| 跨项目 | ❌ | ❌（`workspace` 是键） |
| 生命周期 | 跟随会话（§6） | 跟随项目（永不自动删） |

**硬保证的实现方式**：隔离**不靠过滤，靠寻址**。`session__A` 与 `session__B`
是两个不同的目录，检索函数在物理上只能扫到调用方有句柄的那一个。
⛔ 不做"读全量再过滤"—— 那样一旦漏掉过滤条件就是串扰事故。

---

## 3. 记忆条目数据结构

每条记忆是一个 JSON 对象（落盘在 `entries.jsonl`，**一��一行、追加式**）。

```ts
type MemoryEntry = {
  /** 稳定 id：`<时间戳36进制>-<随机6位>`。⛔ 不做内容哈希（内容会变） */
  id: string;
  /** 内容正文（纯文本，⛔ 不存 Markdown 结构 ⇒ 注入时不用解析） */
  content: string;
  /** 作用域：决定存哪个命名空间、谁能读 */
  scope: "session" | "project";
  /** 所属会话（scope=session 时必填）/ 所属项目（两者都填） */
  sessionId: string | null;
  projectKey: string;
  /** 来源智能体：⛔ 角色是"谁写的"，不是"存在哪"（见 §1） */
  sourceAgent: {
    kind: "main" | "subagent" | "expert" | "team-lead" | "team-member" | "system";
    id: string;        // 稳定 id；主会话 = "main"
    label?: string;    // 显示名，仅供人读
  };
  /** 分类（对齐既有 memory_save 的五分类，⛔ 不新造词） */
  category: "用户偏好" | "项目背景" | "工作流/SOP" | "任务经验" | "临时上下文";
  /** 重要性权重 0..1（写入者可给，省略时按 category 取默认） */
  weight: number;
  pinned: boolean;          // 钉住：蒸馏/裁剪时永不删（对齐既有 pinned 语义）
  createdAt: number;        // epoch ms
  updatedAt: number;        // epoch ms（追加式不改 ⇒ 恒等于 createdAt；预留字段）
  lastUsedAt: number | null;// 最近被检索命中（做时间衰减 + LRU 裁剪）
  useCount: number;         // 被召回次数
};
```

**落盘格式**：`<workspace>/.codex-harness/memory/fabric/<namespace>/entries.jsonl`
⛔ 选 `.jsonl` 而非 `.md`：需要按条目做元数据过滤与排序，Markdown 行解析做不到
（上一轮的 `MEMORY.md` 只能整段注入，这是它"无法按相关性排序"的根因）。

**与既有 L0–L7 的关系**：`project` 作用域是**新增的一层**，不替代 L1–L5。
注入时 L5（踩坑）→ L0（档案）→ L1 → L1.5 → L2 → **fabric 的 project 条目** → L4（日志）
→ **fabric 的 session 条目**（最后，最贴近当前对话）。

---

## 4. 各智能体实例如何获取句柄 / 写入 / 检索

### 4.1 句柄（MemoryHandle）

**所有智能体（主会话与角色会话）拿的是同一种东西、同一个构造函数** —— 这是
"共用同一套记忆实现"的字面含义。

```ts
type MemoryHandle = {
  readonly scope: "session" | "project";
  readonly namespace: string;        // 该作用域的目录键
  readonly sessionId: string;        // 发起方会话（写 session 条目时用它）
  readonly projectKey: string;       // 规范化的 workspace
  readonly agent: MemoryHandle["agent"];
  /** 注入上下文用：一次拿齐 L 层 + fabric 两级，按预算钳制 + 如实告知截断 */
  buildContext(query?: string): Promise<MemoryContextSection>;
  /** 检索（硬隔离：session 作用域只扫自己那个命名空间） */
  recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>;
  /** 写一条 */
  write(input: WriteInput): Promise<{ id: string; written: boolean; reason?: string }>;
};
```

获取方式（三条路径，同一个工厂）：

```ts
// 主进程委派路径 / 主进程应答工具调用
getMemoryHandle({ sessionId, workspace, agent })          // → session 句柄 + project 句柄
// 渲染层（主会话发送 / 亲自与某角色对话）
await window.codex.memoryHandle({ threadId, workspace })   // IPC，返回可注入的上下文与检索结果
```

`getMemoryHandle` 内部**一次返回两个句柄**（`session` + `project`），
⛔ 调用方不能只要一个 —— "读得到项目记忆"是所有智能体的共同基线，
而"写项目记忆"要走 §4.2 的闸。

### 4.2 写入闸（谁能往 `project` 写）

| 写入者 | 写 `session` | 写 `project` |
|---|---|---|
| 主会话 | ✅ | ✅ |
| 被委派的子智能体 / 专家 / 团成员 | ✅ | ⛔ **默认拒**，需显式 `promote=true` 且**必须征得用户同意** |
| 系统（蒸馏 / 卫生 / 日志） | ❌ | ✅ |

理由：`project` 是**全局共享**的 —— 一个子智能体把它的中间结论写进项目记忆，
会污染主会话和所有其他角色。⛔ 因此角色写 project 时**不静默放行**：
返回拒绝 + 一句可执行的提示，让模型转达用户（"这段经验值得进项目记忆吗？"），
用户确认后才带 `promote=true` 重写。这与项目既有的"权限边界未经确认不动"纪律一致。

### 4.3 检索算法（打分）

```
带 query：先按相关性**过滤**（不相关的直接不返回），再按分数排序
  score = 权重 × 时间衰减 × 钉住加成
  时间衰减 = 1 / (1 + 天数 / 半衰期)         半衰期 = 14 天
  钉住     = pinned ? 1.5 : 1.0
空 query（常驻注入）：按重要度全给，⛔ 已归档条目一律排除
```

⛔ **相关性必须有命中率门槛**（`isRelevant`）：`tokenize` 出的是「逐字 + 双字 bigram」，
"蓝绿部署" 会拆出 `部`/`署`/`蓝绿`…，若"命中任意 token 就算相关"，
查一个项目里没有的词会召回一堆不相关条目（实跑抓到：6 条噪声）。
⇒ 长 token（≥3 字）命中即算；短 token 需命中 ≥ 34%。

⛔ **带 query 时不相关的条目一律不返回**（只把 score 排到后面**不够**：
`limit` 默认全量 ⇒ 它们照样出现在结果里。实跑抓过这个形态）。

⛔ **不引入 embedding**：项目已有 Laya 软增强（`laya-service.ts`）但那是知识库检索，
接进来会让记忆层依赖一个可选的外部服务 ⇒ 记忆的**基本可用性**不能挂在它上面。
留 `score` 的唯一注入点，将来要换检索器只改这一处。

### 4.4 使用记账（LRU 的输入）

`useCount` / `lastUsedAt` 在**召回命中后**更新（fire-and-forget，不阻塞读路径），
供 §6 的裁剪用 LRU 判据。

⛔ 记账**必须就地重写整份文件**，⛔ 绝不许 `appendFile` 追加残缺行 ——
`readNamespace` 会把残缺行原样返回，`rankEntries` 就拿到 `undefined` 字段
（第一版就是写成追加，被 review 当场抓出）。
⛔ 记账失败静默：裁剪有 `lastUsedAt ?? createdAt` 回退，最多退化成"按创建时间裁"，
**不会误裁重要条目**。

---

## 5. 数据流

### 5.1 读（注入）

```
智能体要干活
  │
  ├─ 主会话 / 用户亲自对话 ──► 渲染层 send 路径
  │     └─ window.codex.memoryHandle({threadId, workspace})
  │          └─ getMemoryHandle → buildContext
  │               └─ L0–L7 层（既有 context()）+ fabric: project 条目 + session 条目
  │                    └─ 按预算钳制，⛔ 截断必须如实告知
  │                         └─ 拼进 [Harness 常驻记忆 …] 之内（⛔ 标记不可自造）
  │
  └─ 被委派会话 ──► 主进程 buildDelegateMemory({role})
        └─ 同一个 getMemoryHandle（agent = 该角色）⇒ **同一条注入格式、同一预算口径**
```

⛔ 两条路**必须调用同一个 `buildContext`**：分两处拼装就会出现"派出去的专家拿不到
自己刚写的东西"这类只在部分路径复现的 bug。

### 5.2 写

```
模型调用写入工具
  │
  ├─ scope=session（默认、永远允许）
  │    └─ handle.write() → 落 session__<threadId>/entries.jsonl
  │
  └─ scope=project
       ├─ 主会话 ──────► 直接写
       └─ 角色会话 ────► ⛔ 拒（除非 promote=true 且用户已确认）
                          └─ 写后 broadcast 刷新 ⛔ 角色会话收不到渲染层事件
                             （被 filterForRenderer 裁掉）⇒ 不靠广播，靠各自下次读
```

**工具面**（⛔ 一个名字，不并列第二个）：
`memory_write({ scope, category, content, weight?, promote? })`
- 取代现有的 `memory_save`（主会话）与 `role_memory_save`（角色会话）。
- ⛔ 旧的 `role_memory_save` **保留一个别名期**（同一个 handler，不同名），
  避免"上一轮建的会话里模型还记着旧名 ⇒ 调不到 ⇒ 以为坏了"。

### 5.3 生命周期（见 §6）

### 5.4 检索（按需召回）

```
模型调 memory_recall({query})
  └─ 句柄.recall(query)
       ├─ session 命名空间：只有它自己的条目
       └─ project 命名空间：全项目共享条目
            └─ 打分排序 → 取 topN → 注入/返回
```

---

## 6. 生命周期与归属裁决（智能体结束后）

这是最容易出错的一块，故用**表**穷举，不靠叙述：

| 事件 | `session` 记忆 | `project` 记忆 | 归属裁决 |
|---|---|---|---|
| 角色跑完一个回合 | **保留** | 保留 | 记忆属于**角色**（`sourceAgent`），不因回合结束消失 |
| 角色会话被**归档** | **保留**（标记 `archivedAt`） | 保留 | ⛔ 归档 ≠ 失忆：归档是为了不占侧栏 |
| 角色会话被**删除** | **保留内容**，打 `archivedAt` + 清 `session→角色` 索引 | 保留 | 角色定义还在（专家没被删）⇒ 下次派出继续用它积累的记忆 |
| 角色**定义**被删（专家被移除） | 该角色的 session 条目**标记孤儿** | 保留 | 孤儿条目不自动删（可能是用户的手记），由设置页显式清理 |
| 项目记忆 | — | **永不自动删** | 跟项目走（进 git / 跟迁移） |
| 会话 `fork` | 新会话**不继承** session 记忆 | 继承 project | ⛔ session 是"这段对话的私事"，fork 出来的新会话是另一段对话 |
| 工作区被删 / 是 scratch | 随工作区消失 | 随工作区消失 | scratch 会话不落任何记忆（既有 `isScratchWorkspace` 口径） |
| L7 蒸馏 / 卫生清理 | ⛔ **不碰**（它们是 L 层的事） | ⛔ 不碰 | 独立生命周期，避免两个清理器互相踩 |

**归档必须有行为差异**：`archivedAt` 非空的条目**不参与召回、不进注入正文**
（`rankEntries` 默认过滤，`recall(…, { includeArchived: true })` 才读得到）。
⛔ 只打标记不过滤 = 那个字段是装饰（第一版就犯过，被 review 抓出）。

**关键裁决：`session` 记忆按"内容归属"而非"会话存活"决定去留。**
会话删了不等于记忆该删 —— 删的只是**寻址它的索引**（`threadId → 角色` 那条）
与**检索资格**（打归档标记）。

⛔ **任何清理器必须接到启动路径上，否则等于没写**（已接 `boot.ts` 启动流程：
`sweepFabric` 逐工作区归档 + 裁剪；⛔ 工作区来源是 `threadCwd` 的值，**不猜路径**）。

---

## 7. 兼容与迁移

| 旧资产 | 处置 | 理由 |
|---|---|---|
| `roles/<键>/MEMORY.md`（上一轮） | **保留可读**，作为 `project` 层的补充注入（排在 fabric 条目之后） | 删了会让用户已积累的专家记忆凭空消失 |
| `role_memory_save` 工具 | 保留别名，同一 handler | 老会话里模型记着旧名 |
| `userData/memory.json` 碎片池 | **不动**（继续做 L3 碎片召回） | `search()` 不过滤的问题依旧，但它是既有资产，不在本次范围 |
| `memory_save`（主会话） | 保留名字，实现改为转发 `memory_write` | 同上 |
| L0–L7 各层文件 | **不动** | 单一真相源是 `memory-layers.ts`，本次只加不改 |

---

## 8. 守卫要钉死的不变量

`scripts/guards/11l-memory-fabric.mjs`（每条都有实跑或变异背书）：

1. **作用域隔离**：session 条目检索结果里**永不出现**其他 `threadId` 的条目
2. **命名空间合法**：键不含 `:` 等 Windows 非法字符（实跑过 ENOENT）
3. **条目字段完整**：`sourceAgent` / `sessionId` / `projectKey` / `createdAt` / `weight` 均必填
4. **写入闸**：角色会话写 project 必须带 `promote` 闸；缺闸即红
5. **一条注入路径**：主会话与被委派会话都调 `buildContext`（不许分两处拼装）
6. **生命周期闭环**：删除会话会清索引；任何 `prune` 都有启动期调用点
7. **工具面唯一**：只有一个 `memory_write`（旧名只作别名，不得并列成两个语义）
8. **不静默截断**：注入被钳制时必须产出"截断了 N 字"的告知

---

## 9. 已知边界（如实声明）

- **检索是关键词式**，不是语义式。中文分词用"逐字双字 bigram"近似，
  召回质量不如 embedding，但零依赖、零延迟、完全离线。
  预留 `score` 唯一注入点（§4.3），将来可替换。
- **session 记忆不跨 fork**（§6），这是有意的隔离选择，不是缺陷。
- **角色写 project 记忆需要用户确认**，多一次交互。⛔ 这是权限边界，
  不为了方便而放松（10-03 用户已因擅自收紧/放宽 fs:write 表达过不满）。
- **`entries.jsonl` 不做并发写锁**。当前写入是单主进程串行（`fs.writeFile` 追加），
  若将来多进程写同一工作区需加锁。⛔ 已知限制，不是遗漏。
