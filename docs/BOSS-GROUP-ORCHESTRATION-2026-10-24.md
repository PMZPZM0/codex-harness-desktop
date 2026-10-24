# 创世 Boss · 群聊编排方案（2026-10-24）

> 目标：一个「老板会话」（boss），能**自己建团队、拉群、派活、盯进度、审不过就打回重做**。
> 本文只出方案，不动代码。落地前先看 §0 的三条硬约束——它们决定了架构长什么样。

---

## 0 先说结论（以及三条不能绕的硬约束）

**能做，而且不用改引擎。** 关键是三件事想清楚：

1. **群不是一条 thread，是一个「聚合视图」**。
   引擎里一个 thread = 一个 agent 的会话，多 agent 共写一条时间线在引擎层不存在。
   ⇒ 群 = boss 的一条主 thread（唯一可对话入口）+ 每个成员各自的隐藏 thread（执行体），
   由**宿主**把三边事件按时间合流渲染成一条消息流。
   （DS Bot 的群也是这个形态：成员在群里各自有隐藏 session，界面才是一条流。）
2. **派活必须是异步的**。
   现有 `runDelegatedTask` 是**同步阻塞**（建会话 → 跑完一个 turn → 返回最终文本，上限 12000 字）。
   一个 boss 串行等 3 个成员 = 卡死。⇒ 群内派活改成「建/复用成员会话 + 发一条 turn 就返回」，
   结果靠已有的**后台回投通道**（`delegate-report`：往任意会话投消息、不打断在跑的回合）送回。
3. **「自动监督」必须由宿主驱动，不能写在提示词里让模型自觉**。
   仓库里已有前车之鉴：第 6 条「优先让新鲜上下文的评审看一眼」写了很久，实际只是建议——没有状态位、没有阻断、没有回退。
   ⇒ 监督 = 宿主的双账本循环（§4），模型只在三个决策点被叫醒。

其余两条边界（现状实证，先接受再设计）：

- **`MAX_DEPTH = 1`**：boss → 成员只有一跳，成员**不能再对外派人**（专家/团队/被委派会话一律 restricted）。
  所以「boss → 组长 → 组员」这种三层结构现在做不了，本方案不碰这条闸。
- **`dynamicTools` 只在 `thread/start` 冻死**：成员会话建的时候挂什么工具就是什么，中途加不了。
  ⇒ 成员的职责/工具必须在**建会话那一刻**定下来（这也正好逼出"先设计岗位再开工"）。

---

## 1 调研：别人怎么做的（GitHub 实证）

### 1.1 Fei2411/DeepSeek-Bot（就是你说的那个，★3.4k / Apache-2.0 / JS）

DSH（DeepSeek Harness）的插件，本质和我们是同一类东西——**把 harness 的 session 变成"有名字、有分工、有记忆"的 bot**。

| 机制 | 它怎么做 | 对我们的价值 |
|---|---|---|
| Bot = Session | 每个 bot 是一个 DSH session，可单独选模型、单独管理记忆、有详情页 | 我们已经是这个形态，`teams:*-session` 就是现成的 |
| Main Bot (Chief) | 高管权：创建/修改其它 bot、管理群聊；首次打开由它带你配置 | 抄「boss 也是被建出来的、且能改自己的团队」 |
| 群聊路由 | **一次只有一人说话**；说话前先读最新消息；`@Name` 把发言权交给某人；没话说回 `[PASS]` 保持沉默 | 抄。这是"不烧钱 + 不刷屏"的关键 |
| 群的隔离 | 每个成员在**每个群**各一个隐藏 session；群读不到 bot 的私聊 | 抄。我们已有 `(teamId, memberId) → threadId` 映射，加个 groupId 维度即可 |
| 记忆 | Markdown 一行一条（AgentMemoryRepo 格式），**三作用域**：bot / group / team；有 `remember/forget/recall` 工具、journal、快照、条数上限；**记忆复核**每轮自动跑（用 admin 的模型） | 我们已有统一记忆（private/team/project），加一个 `group` 作用域即可 |
| 上下文治理 | `checkRatio` 到 0.8 触发 steward：工作中→压成 checkpoint；已停顿→写 handoff、开新 part | 我们已有自动压缩，够用，**不抄** |
| 工具挂载 | Capabilities = MCP/skills/packs 共享库，按 bot 挂；本地 MCP 命令要审批 | 我们已有能力网关 `harness_tools`，按成员勾选即可 |
| 进度展示 | Bot 自己聊天里可 `show_view` 画卡（含 progress/表格/确认）；侧栏图标；用量按 bot/模型统计 | 抄「卡片式进度」，但**不抄百分比**（见 §6） |

**它没有的东西**：没有任何「审查 → 打回 → 重做」的闭环。它的 "review" 是**记忆复核**和**上下文 steward**，
跟"活干得对不对"无关。⇒ 你要的那条最硬的诉求，得我们自己加。

### 1.2 Grok Bot（xAI，闭源产品，只作参照）

主 Bot 当 CEO：你对主 Bot 说话，它把活分给专门 Bot；**拉群 2–6 个 Bot**，群里 `@` 某人或让它自己判断谁接；
每个 Bot 有名字/岗位/描述、自己的云电脑、定时任务、资料库。它明确说「群聊里不出现审批请求」——
即**它把审批让位给一对一**，群只负责协作。这条值得抄：**群里不做危险操作，审批回落到 boss 私聊**。

### 1.3 审查/打回：三个可抄的机制

- **ChatDev（清华 OpenBMB，★25k）**：Reviewer、Tester 是**流程里的阶段**，不是建议。Tester 测试不过 ⇒ 代码送回修，直到通过。
  ⇒ 审查必须是**状态机里的一态**，不是一句提示词。
- **Magentic-One（微软，AutoGen）**：双账本。**Task Ledger**（已知事实/待查/待推算/猜测 + 分步计划）与
  **Progress Ledger**（每轮五问：完成了吗 / 是否在打转 / 有进展吗 / 下一个谁 / 给他什么指令），
  外加 **stall 计数器**（>2 就跳出内循环、回外循环重规划）。⇒ 这就是"自动监督进度"的工业级答案。
- **reviewer-protocol（ElBruno.MagenticUI 的 skill）**：**作者锁（author lockout）**——
  被打回的稿子，**原作者不得参与返工**（含共同署名/顾问），必须换人或新建一个专长的 agent；
  全队都被锁死则**升级给用户**，绝不重新放行被锁的作者。
  ⇒ 这条直接解决"AI 自己改自己的活，改两遍还是错"的死结。

### 1.4 AutoGen GroupChat（作为反面参照）

`GroupChatManager` 管共享上下文 + 选发言人（round_robin / auto / manual / 自定义函数），
每轮都要 manager 的 LLM 决策。**我们不用全员群聊 + LLM 选人**：一轮一个 LLM 选人调用，
5 个成员聊 10 轮 = 10 次额外调用，而且"大家随便聊"很容易跑题烧钱。
⇒ 我们的发言权**只由 boss 显式授予**（派活/追问），成员之间不自由对话。

---

## 2 概念模型（5 个名词，别再加）

| 名词 | 是什么 | 不是什么 |
|---|---|---|
| **Boss** | 一个普通会话，但被标记为某群的 `bossThreadId`；它持有建群/派活/审查工具 | 不是"超级 agent"，没有绕过权限的能力 |
| **Group** | 一个编排单元：1 个 boss + N 个成员 + 1 个任务账本 + 1 份群记忆 | 不是一条引擎 thread |
| **Member** | 一个成员 = (groupId, memberId) 对应的一条**常驻复用**会话 + 岗位说明 + 模型/权限 | 不是一次性子智能体（那是一次性 `runDelegatedTask`） |
| **Task** | 一条可派、可审、可打回的工作单元，带 attempts 与预算 | 不是 `task_add` 那份全局待办（那份是给人看的步骤条） |
| **Review** | 任务的一个阶段，有 verdict（approved / rejected）+ 理由 + 打回计数 | 不是模型"我觉得可以了" |

> ⚠️ 任务清单有两份，必须分清：`task_add/task_update` 是**输入框上方那个「步骤 N/M」胶囊**（全局单份、无归属）；
> 本方案的 Task 是**群编排账本**（按群、按成员、有 attempts）。两者不合并，UI 上也不放一起。

---

## 3 数据模型（落 `userData/boss-groups.json` + 每群目录）

```jsonc
// userData/boss-groups.json  ← 单一真相源，宿主独占写（渲染层只读 + 发指令）
{
  "version": 1,
  "groups": {
    "g_7f3a": {
      "id": "g_7f3a",
      "name": "落地页上线",
      "createdAt": 1761400000000,
      "workspace": "D:/proj/landing",
      "bossThreadId": "01a1…",            // boss 主 thread（可对话入口）
      "policy": {
        "maxRejects": 2,                   // 打回上限（Magentic 的 stall ≤2）
        "stallMs": 90000,                  // 成员多久没动静算卡住
        "reviewer": "fresh",               // fresh | member:<id> | boss | user
        "budget": { "tokens": 400000, "minutes": 40 }   // 超了就叫停，不静默烧钱
      },
      "members": [
        {
          "id": "m_writer", "name": "写手", "role": "文案",
          "systemPrompt": "…",             // 建会话时用，之后只读
          "model": "glm-5.3-flash", "effort": "medium",
          "sandbox": "workspace-write", "approvalPolicy": "on-request",
          "threadId": "01a1…",             // 常驻复用；空 = 还没开工
          "status": "idle"                 // idle | busy | reviewing | locked
        }
      ]
    }
  },
  "tasks": {
    "t_91bd": {
      "id": "t_91bd", "groupId": "g_7f3a",
      "title": "首页文案 + 三屏结构",
      "brief": "…（含验收标准，必填）",
      "assignee": "m_writer",
      "status": "running",                 // 见 §5 状态机
      "attempts": [
        { "n": 1, "memberId": "m_writer", "threadId": "01a1…", "startedAt": 0, "endedAt": 0,
          "output": "…（截断存）",
          "review": { "by": "fresh", "verdict": "rejected", "reasons": ["没有给出可验收的成品", "缺 CTA"], "at": 0 } }
      ],
      "rejects": 1,
      "lockedAuthors": ["m_writer"],       // ⛔ 作者锁：被打回的人不许再碰这条
      "createdAt": 0, "endedAt": 0
    }
  },
  "events": [ /* 群消息流：见 §7，追加写、按群保留最近 N 条 */ ]
}
```

**为什么全放一个 JSON 而不是 sqlite**：群规模是个位数、任务是几十条量级；现有 `delegate-threads.json`、
`team-threads.json` 都是这个路子（120ms 合并写）。真到上千条再迁 sqlite，别提前上。

---

## 4 运行时：宿主的双账本循环（核心）

```
                 ┌──────────────────── 外循环（任务账本 Task Ledger）────────────────────┐
                 │  目标 / 已知事实 / 待查 / 分步计划 / 谁最适合干哪步                        │
                 │  触发：用户新指令 · 停滞 > stallMs · 打回超限 · 成员交活后计划失效        │
                 └───────────────┬──────────────────────────────────────────────────────┘
                                 │ 生成/修改任务 → 派活（写 Task.attempts，发 turn）
                 ┌───────────────▼──────────────────────────────────────────────────────┐
                 │  内循环（进度账本 Progress Ledger）—— 宿主 tick，默认 5s，不叫模型       │
                 │  ① 成员有新 token？→ 刷新 lastActivityAt / 已产字节                     │
                 │  ② 成员交活？→ 进 Review 通道（§6）                                     │
                 │  ③ 成员超 stallMs 无动静？→ 标 stalled，算一次"无进展"                  │
                 │  ④ 同一任务连续 2 次无进展？→ 跳出内循环，回外循环重规划                 │
                 │  ⑤ 预算烧到 80%？→ 提醒 boss；100% → 暂停全群                            │
                 └──────────────────────────────────────────────────────────────────────┘
```

**模型只在三个决策点被叫醒**（这是跟 Magentic/GroupChat 的关键取舍）：

1. **拆解**：用户给目标 → boss 出任务清单（谁干、验收标准）。
2. **打回决策**：reviewer 给出 rejected + 理由 → boss 决定「换人 / 换策略重做 / 放宽标准 / 升级给用户」。
3. **重规划**：停滞或预算告警 → boss 改计划（可能加人、拆更细、或直接找用户）。

日常 tick、心跳、进度刷新**全部是宿主算的**，不花 token。
（Magentic 每轮都问一次 manager，5 问 × 几十轮很贵；我们只在需要"判断"时付这个钱。）

**为什么监督不能写在提示词里**：本仓已经证明过一次——第 6 条"优先让新鲜上下文评审"写了很久，
真实行为是"模型想起来才做"。监督必须是**状态 + 定时器 + 硬闸**。（见 `docs/ARCHITECTURE-RULES.md` §2.2：
新能力一律独立板块 + 留拓展接口。）

---

## 5 任务状态机（含打回环）

```
 queued ──派活──▶ assigned ──turn 开跑──▶ running
                                          │
                          成员交活（turn 完成）│
                                          ▼
                                      submitted ──▶ reviewing
                                                       │
                             ┌──── approved ────────────┴──────── rejected
                             ▼                                      │
                           done                          rejects < maxRejects ?
                                                       │yes              │no
                                                       ▼                 ▼
                                                  reassigned         escalated
                                            （换人 + 作者锁）      （交用户决策）
                                                       │
                                                       └─▶ running（attempts+1）
```

规则（每条都要有断言）：

- **交活 = turn 正常结束**。`turn` 超时 ≠ 失败（现有语义：保持 running + `pendingReport`），宿主把它当"仍在跑"，**不算 attempt**。
- **打回必带理由**，理由必须引用验收标准里的一条（空理由不许打回，防止"我不满意"式空转）。
- **作者锁**：`rejected` 之后把 attempt 的 `memberId` 写进 `lockedAuthors`；重派只能选**不在锁名单**的成员。
  全员被锁 ⇒ 直接 `escalated`，**不许把被锁的人放回来**（reviewer-protocol 的死锁处理）。
- **打回上限 = 2**（可配）。第 3 次不再自动重派。
- **escalated 只给三个选项**：换模型重做 / 放宽验收标准（写进决策记录）/ 我来接手。不许静默继续。
- **产物归属**：每次 attempt 有独立 `threadId`，群里那条「提交」消息可点开回到该 attempt 的完整轨迹
  （复用现有"点成员进会话"的能力）。

---

## 6 审查门禁（三档，按成本从低到高）

| 档 | 谁审 | 什么时候用 | 成本 |
|---|---|---|---|
| ① 自检 | 执行成员（交活前自填 checklist） | 永远 | 0 额外调用（同一 turn 内） |
| ② 独立评审 | 内置子智能体 `评审（新鲜上下文）`（看不到执行过程的会话）或指定成员 | 默认档 | 1 次调用（可配小模型） |
| ③ boss 终审 | boss 按 rubric 打分 | ②有分歧、或任务标记 `critical` | 1 次调用 |

**rubric 从哪来**：派活时把「验收标准」写进 `brief`，reviewer 拿到的是
`brief + 成品 + 验收标准`，**不给**执行过程（新鲜上下文的全部意义就在这）。
verdict 必须是结构化输出（`pass` + `reasons[]`），空 reasons 视为无效、按 rejected 处理。

**群里的审批边界**（抄 Grok Bot 的取舍）：涉及写权限升级、密钥、支付、发外部消息的动作，
**群聊里不弹审批**，一律回落到 boss 私聊的审批流；群消息里只显示「需要批准」并给跳转。

---

## 7 群时间线与 UI（独立板块，不塞进团队域）

### 7.1 消息流（宿主合成，按 `events[]` 顺序渲染）

```
[Boss]  这活分两步：文案 → 建站。写手先出首页文案和三屏结构，标准是「有主标题/副标题/CTA，且能直接贴进页面」。
[写手]  已交活 · 尝试 1/3 · 4 分 12 秒 · [看轨迹]
        └─ 审查（新鲜上下文）：打回 ×1 — 缺 CTA；三屏结构只有两屏。
[Boss]  打回：换文案二组重做（写手本轮不参与）。补一句：CTA 必须给两种措辞。
[文案二组] 正在做 · 第 2/4 步「三屏结构」 · 18 秒前有进展
```

- 成员发言**永远带角色标签 + 当前步骤 + 最后活动时间**（进度的诚实形态，见下）。
- 一键 `@` 某人 = 让 boss 把话转给他（不是直接开一条新对话）。
- `[PASS]` 语义保留：成员没新内容就不发言（默认只有被派活/被 @ 才动，避免全员刷屏烧钱）。

### 7.2 进度怎么显示（不撒谎）

**不做百分比**。百分比在没有明确定义的步骤时会变成装饰品。改三件确定的东西：

1. **阶段**：queued / 正在做 / 已交活 / 审查中 / 被打回 / 完成；
2. **最近一步**：模型工具卡上的 `step` 参数（`src/lib/step-note.mjs`）——现有工具已带，直接透传；
3. **心跳**：`最后活动 N 秒前` + 停滞计数（`无进展 ×1`）。

> 落地代价：`TeamMemberRunRecord` / `DelegateRecordEntry` 目前只有 `status/output/startedAt/endedAt`，
> 要加 `phase / lastStep / lastActivityAt / stallCount` 四个字段，并让 `team-run` / `delegate-run` 广播带上。
> 办公室视图（`TeamOfficePreview` 目前靠 `output.length` 猜 phase）会同时受益。

### 7.3 界面位置

- **侧栏**：群是一个条目（不是每个成员都占一行）；成员会话折叠在群下面，点开才看。
- **群会话页**：消息流 + 右侧任务看板（Task Ledger 的 UI）+ 成员状态栏（忙/闲/审查中/被锁）。
- **办公室**：群 = 一张工位图，成员按 state 显示（现有办公室视图复用，补 stalled/reviewing 两个状态）。

---

## 8 与现有能力的关系（复用 / 新增，别重复造）

| 需要的能力 | 现状 | 本方案 |
|---|---|---|
| 建/复用成员会话 | ✅ `teams:start-session` / `teams:member-session` / `teamRunStore.memberThreadOf` | 复用，映射键从 `teamId|memberId` 扩成 `groupId|memberId` |
| 派一条任务给成员 | ✅ `invokeTeamMemberCore`（一次 turn、同步等完、线程复用） | 复用其"线程复用 + turn/start"，但**不 await**，改为事件结束 |
| 结果回投 | ✅ `delegate-report`（任意会话投消息、不打断回合、带 15 分钟/3 次防循环配额） | 复用，作为群事件总线的一条腿 |
| 委派记录 | ✅ `delegate-threads.json`（status startedAt endedAt output） | 复用存储层，**加字段**（phase/lastStep/stallCount） |
| 深度闸 | ✅ `MAX_DEPTH=1` | 不动。成员之间不互相派活 |
| 独立评审 | ✅ 内置子智能体 `评审（新鲜上下文）` | 复用它的 prompt，但**由宿主调用**，不由模型自觉 |
| 任务账本 | ❌（`task_add` 是全局步骤条，无归属） | 新增 `boss-groups.json` 的 `tasks` |
| 作者锁 / 打回 | ❌ 全仓无 reject 状态位 | 新增 |
| 群记忆 | ⚠️ 记忆只有 private/team/project | 加 `group` 作用域（沿用 fabric 的 `session__/project__` 命名法，加 `group__<gid>`） |

**新增的 agent 工具**（挂在 boss 会话的 `dynamicTools`，建会话时定死）：

| 工具 | 作用 | 硬闸 |
|---|---|---|
| `group_create` | 建群 + 声明成员岗位 | 需用户确认（会消耗额度） |
| `group_assign` | 派任务给成员（异步，立即返回任务 id） | 必须带验收标准；同任务不可重复派给被锁成员 |
| `group_status` | 读任务账本 + 成员状态（给 boss 自己看，也给用户看） | 只读 |
| `group_review` | 对某次交活出 verdict（通常由 reviewer 会话调，boss 也能调） | 必须给理由；理由须命中验收标准 |
| `group_escalate` | 打回超限时把决定权交用户（出选项） | 最多一次/任务 |

> 这些是**boss 专用**：成员会话不挂（成员只能干活，不能拉人/审人），符合现有 restricted 语义。

---

## 9 成本与失控防护（群聊最容易翻车的地方）

1. **默认"不发言"**：只有被派活、被 @、被打回的人才跑。没有"大家自由讨论"。
2. **并发上限**：同群同时跑的成员 ≤ 3（可配）；超了排队，不并发烧。
3. **单群预算**：tokens / 分钟双闸；80% 提醒 boss，100% 暂停全群并要求用户决定。
4. **打回上限 2** + 作者锁：防止"改—审—改"死循环。
5. **写入沙箱**：成员默认 `workspace-write`，需求变更才升级；群内不弹审批（回落私聊）。
6. **用量归属**：按成员/任务记账，写进现有用量统计（云管理侧的团队积分将来可对接 `task.cost`）。

---

## 10 分阶段落地

### P0 · 最小闭环（先证明"能派活、能打回"）

- 数据层 `boss-groups.json` + 状态机 + 作者锁；
- boss 工具 4 个：`group_create` / `group_assign` / `group_status` / `group_review`；
- 异步派活（复用 member thread + turn/start，不 await）+ `delegate-report` 回投事件；
- 群视图：一条合成时间线 + 任务看板 + 成员状态；
- 审查只做 ②独立评审（`fresh-review`），rubric = brief 里的验收标准；
- 打回 1 次换人重做，第 2 次打回升级给用户。

**P0 的验收（可执行）**：
① 对 boss 说"建个群：写手 + 前端，做首页文案和三屏"，3 个成员会话各自建出来且模型/岗位正确；
② 派一条任务，成员会话真跑起来；交活后群里出现「已交活（尝试 1/3）」并可点回轨迹；
③ 交一份明显不合格的活，verify：verdict=rejected、理由非空、`lockedAuthors` 含原作者；
④ 重派时**无法**再派给原作者（工具层拒绝并回一句可读原因）；
⑤ 第二次打回后状态变 `escalated`，boss 收到三选项；
⑥ 成员卡住 90 秒 → 状态 `stalled`、群里出现「无进展 ×1」，不触发重派；
⑦ 预算 100% → 全群暂停且不再自动派活。

### P1 · 自动监督与重规划

- Progress Ledger tick（5s，宿主算，不叫模型）；
- 停滞 → 外循环重规划（boss 模型）；
- 群记忆作用域 `group__<gid>` + 群内 `remember/recall`；
- 办公室视图补 stalled / reviewing 两态；成员栏显示最近一步。

### P2 · 生态

- 群模板（"软件交付群 / 内容生产群 / 调研群"）——就是现有专家团的 `sop` 换个壳；
- 人类多成员（同事加入群、批注、认领任务）；
- 群知识库接线（现有 WeKnora / MemHub 通道）；
- 团队积分对接（云管理 `teamConsume`：成员一次 attempt = 一条 charge）。

---

## 11 明确不做的事（以及为什么）

| 不做 | 理由 |
|---|---|
| 成员之间自由对话（群聊全员轮询） | 每轮要一次选人调用 + 全员发言 = 成本翻几倍且跑题；DS Bot 也是"一次一人 + 只看最新消息" |
| 「完成度 67%」这种百分比 | 没有真实分母，是装饰品；改阶段 + 最近一步 + 心跳 |
| 三层组织（boss → 组长 → 组员） | 要动 `MAX_DEPTH=1` 硬闸，风险大于收益；先用"boss + 多成员"跑通 |
| 群内弹审批 / 密钥 / 支付 | 抄 Grok Bot 的取舍：一律回落 boss 私聊审批 |
| 让模型自己决定要不要审、要不要打回 | 本仓已经证明"提示词层的自觉"不可靠，必须宿主状态机 |
| 把成员做成一次性子智能体 | 一次性没法"打回重做"，必须常驻复用（`(groupId, memberId)` → threadId） |

---

## 12 风险清单

| 风险 | 表现 | 处置 |
|---|---|---|
| 群会话爆炸 | 每个成员每群一条 thread，token/磁盘涨 | 成员会话按 `(gid, mid)` 复用；群删除时归档成员 thread |
| 事件回投把 boss 叫醒过频 | 每交一次活就一次模型调用 | 事件合并：同一 tick 内多条事件合成一次唤醒 |
| 审查形同虚设 | reviewer 总说"通过" | rubric 必填 + 随机抽检（用户点「我来审」）+ 记录 verdict 分布（长期看通过率 100% 就是失效） |
| 打回后没人能接 | 全员被锁 → 死锁 | 直接 escalated，不擅自放行（reviewer-protocol 的硬规则） |
| 与现有团队域打架 | 两套"成员/会话"概念 | 新域 `boss-groups`，**不改** `expert-teams` 数据；成员会话映射表共用一套 |
| 渲染层要造第二条时间线 | 群视图与真实会话不一致 | 群视图**只读** `events[]` + 各 thread 的公开事件，绝不自己编状态 |

---

## 13 一句话总结

**抄 DS Bot 的"bot=session + 群=隐藏会话 + 一次一人 + 三域记忆"，抄 Magentic 的双账本做监督，
抄 reviewer-protocol 的作者锁做打回，其余（全员群聊、百分比进度、三层组织）都不做。**
P0 只做一件最硬的事：**派活能跑、交活能审、打回能换人、超限能升级**。
