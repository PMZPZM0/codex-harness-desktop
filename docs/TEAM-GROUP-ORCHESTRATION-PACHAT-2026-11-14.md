# 工作伙伴群编排改造（抄 Pachat）· 2026-11-14

> 用户令：「工作伙伴群聊借鉴 Pachat 的运作逻辑，当然我们是本地的」。
> 本文是**工作伙伴群**成员协作的现行设计与取舍。代码入口：
> `electron/features/harness-team-ipc.ts`、`electron/features/group-talk/`、`src/features/harness-team/`。
> ⛔ 改这块之前先读完本文与「不变量」；守卫 `11f` / `12be` / `09` 会逐条拦。

## 背景：为什么要改

Pachat 是「多个 AI agent 的群聊」：每个 agent 各自记「读到哪」，只在**被 @ / 被回复 / 有未读**时被唤醒，
先读完别人的话再开口。我们的工作伙伴群原来是「推送接力 + 自由催办」：主理人回完，宿主按行首 `@` 派活，
还会在「主理人没派活 / 刚答完信息」时**强催它再跑一轮**（`leadSelfNudges`）。这套启发式正是
「同一个问题回两条」「回得断断续续」的根因 —— 前几轮一直在打补丁。

⇒ 改成 Pachat 式的**确定性编排**，分三期落地。

## Phase 1：先读再说 + 去自由催办

### 先读再说（每成员已读游标）
- 新模块 `electron/group-read-cursors.ts`：键 `群::发言身份 speakerId`（主理人整团槽 / 合成 id 已归一，
  否则同一张椅子两个 id 会把游标拆成两份、互相从 0 重算）、**只前移不回退**、落 `<userData>/group-read-cursors.json`。
- 每轮开跑前：`unreadTalkHistory(limit, speakerId, readUpTo)` 只取「(游标, readUpTo] 且不是自己发的」的消息，
  喂进 `buildTalkInput`（第五个参数 `history`）。**拼输入之前**快照 `readUpTo`，拼输入期间新到的留作下轮未读
  （关掉「拼完→标记」之间丢消息的窗口）。`buildTalkInput` 之后 `markGroupRead(group.id, speakerId, readUpTo)`。
- `group_read` 工具仍读「最近 N 条」（`readGroupHistory`）—— **与主链故意不同**：主链给"你漏看的"，
  工具给模型主动"再看更多"。⛔ 别把主链改回 `readGroupHistory`（会退化成每轮灌最近 N 条）。
- 游标=0（新成员/首次）⇒ 拿最近的群上下文（受 `TALK_HISTORY_LIMIT` 与字符预算约束）。

### 去自由催办（移除宿主强催）
- ⛔ `leadSelfNudges` / `leadTurnTaskLike` / `isInfoRequest` **整体移除**（连同 `team-collab.mjs` 里的 `isInfoRequest`）。
  宿主**不再**在「主理人没派活 / 刚答完信息」时强催它再跑一轮。
- 链路改由**确定性信号**驱动：用户消息 → 派给主理人 / @ 到的人；成员产出的行首 @ / 工具结果（`mustHandBack`）→ 回交主理人；
  主理人自己决定下一步派谁或写「收口」。团群走真调度工具（`team_member_invoke` / `team_phase_invoke`），不受影响。
- **代价（Pachat 同样接受）**：主理人若既不 @ 人、也不调工具、也不写「收口」，这一轮就到此为止。

## Phase 2：持久预算 + 失败重试

- `electron/group-run-budget.ts`：**每成员每天最多跑 100 次**（跨轮 / 跨多条用户消息的失控保护；
  与单轮的 `canRun` / `chainBudget` 是**两套**）。落 `<userData>/group-run-budget.json`，按天归零，超限跳过本轮（main log 留痕）。
- **失败隔 5 分钟只重试 1 次**（`runOne` 的 catch 里排 `setTimeout`）：每成员最多 1 次**直到它成功才重置**（不无限重试）；
  新消息开跑会**作废旧的重试**（避免拿旧正文重放）；fire 时复核「群还在 / 群没被清空（`groupClearedAt <= startedAt`）」；
  `unref` + in-memory、**重启即丢**（Pachat 的 listener 重启同样重置）。

## Phase 3：群治理

- **活跃度**：`src/lib/group-activity.mjs`（纯函数 `groupActivity(rows, now)` → `{messagesToday, activeToday}`），
  接在**群列表卡副行** `今日 N 人活跃`。⛔ **不进群头**——11-08 用户把群头「N 位成员 · 项目…」副标题当赘述删过。
- **群规矩**：`rules` 字段（`createGroup` 归一 / `MAX_GROUP_RULES_CHARS=2000`），`buildTalkInput` 每轮作为
  【这个群的规矩 · 必须遵守】**独立一段**注入（与「简介 memory」「记忆 memoryNotes」分开，⛔ 别混成一段说明）。
  设置页新增「群规矩」输入框；通道 `harness-team:set-rules`（manifest + registry + `gen:ipc`）。
- **成员治理**：设管理员（`set-admin`）/ 移除伙伴（`remove-partner`）本已具备，无需新做。
- **群模板**（本地版「公开群可复用」）：`src/lib/team-templates.mjs`，存**渲染层 localStorage**（`team-group-templates-v1`，
  ⛔ 无 IPC 通道 / 不重生成 preload —— 避免并发覆盖生成物）。群「···」菜单「存为模板」（`saveTemplate(templateFromGroup(群))`，
  同名 upsert，含 成员 / 简介 / 规矩 / 项目地址）；建群弹窗「从模板新建」直接套用建群、可 × 删除。
  ⛔ 成员按 id 存：换机器若那些专家/团不存在，`createGroup` 会过滤掉（尽力复用、不报错）；localStorage 不跨设备。

## 关键文件

- `electron/group-read-cursors.ts`（读游标）、`electron/group-run-budget.ts`（每日预算）
- `electron/features/harness-team-ipc.ts`（`talkOptions.rules`、`unreadTalkHistory`、`markGroupRead`、失败重试、`set-rules` 处理、预算闸）
- `electron/features/group-talk/03-talk.ts`（`GroupTalkOptions.rules` + 注入段）
- `src/lib/group-activity.mjs`（活跃度）、`src/lib/team-templates.mjs`（模板）
- `src/features/harness-team/{01-team-types,02-team-store,03-team-settings,04-team-group-view,index,12-team-create}.tsx`

## 不变量（改前必读）

1. 读游标键 = **`speakerId`（发言身份）**，不是裸 id / 群成员目录 id；只前移。主链喂「未读」，`group_read` 读「最近」，两者不合并。
2. 快照 `readUpTo` 必须在 `buildTalkInput` **之前**取；`markGroupRead` 用同一个 `readUpTo`。
3. ⛔ 不许再加回「自由催办」（`leadSelfNudges` 类）—— 守卫 `11f`/`12be` 负向断言会红。
4. 每日预算与单轮 `canRun`/`chainBudget` **两套都在**，别互相替代。
5. 失败重试：每成员最多 1 次直到成功；群清空 / 删除 / 重启都清；⛔ 不无限重试。
6. 活跃度只放列表卡，⛔ 不进群头；群模板走 localStorage，⛔ 不新增 IPC 通道。

## 判据（守卫）

- `11f`（协作判据真值表；先读再说接线 `unreadTalkHistory(...,speakerId,readUpTo)` + `markGroupRead(...readUpTo)` + 读游标模块不变量；
  去催办负向；每日预算闸 + 失败重试 + 成功重置；活跃度真值表；群规矩全链路；群模板真值表 + 接线）。
- `12be`（催办移除负向；主链喂未读、`group_read` 读最近「故意不同」）。
- `09` 棘轮：`harness-team-ipc` / `04-team-group-view` / `03-team-settings` 净行按各仓实测记（多文件 >1000 行棘轮）。

## 已知取舍 / 边界

- 没跑「真多 agent 一轮完整对话」的 e2e（要真模型/引擎，成本高且 flaky）；靠 tsc + 守卫 + `verify:runtime` + 变异。
- 去催办后，主理人「只写方案不派活也不收口」会导致该轮终止（确定性 > 主动催，Pachat 同取舍）。
- 每日预算 100 是安全阀，正常用不到；超限只跳过并留 main log，群里不会刷提示。
