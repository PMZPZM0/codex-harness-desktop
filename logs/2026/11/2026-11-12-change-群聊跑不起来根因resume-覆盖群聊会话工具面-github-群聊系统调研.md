---
id: 2026-11-12-change-群聊跑不起来根因resume-覆盖群聊会话工具面-github-群聊系统调研
date: 2026-11-12
kind: change
area: team-chat
title: 群聊跑不起来根因：resume 覆盖群聊会话工具面 + GitHub 群聊系统调研
tags: [team-chat, tool-surface, rollout, three-repos, bugfix]
commits: []
files: [electron/features/codex-ipc.ts, electron/features/group-talk/01-channel.ts, scripts/guards/12be-team-chat-ux.mjs]
importance: high
---

# 群聊跑不起来根因：resume 覆盖群聊会话工具面 + GitHub 群聊系统调研

## 结论

用户 18:27 追报「群聊压根运行不起来」。判定为**工具面被覆盖**导致的架构级故障，不是模型偷懒、
也不是缺一个群聊框架。修掉两处后，群聊主理人重新拿得到派活工具。

## 硬证据（rollout 首行 `session_meta.dynamic_tools`）

| 会话 | 首行工具数 | `team_member_invoke` | 说明 |
|---|---:|---|---|
| 15:43 刚建的群聊会话 | 8 | 有 | 正确的群聊工具面 |
| 17:15 群聊会话（用户投诉截图里的「failed 空壳」） | 0 | 无 | 已丢 |
| 17:16 群聊会话 | 95 | 无 | 被宿主工具面整份覆盖 |

启动日志同时出现 `[tool-surface] resume 升级 01a1cf0b → 95 个（宿主 39 + 主进程 56）`，
与 17:16 那条会话 id 一致 ⇒ **覆盖者就是通用 `thread/resume` 工具面升级**。

## 根因链

1. 引擎只在 spawn 时定死工具面，来源是 rollout 首行；`thread/resume` / `fork` 传
   `dynamicTools` 会被整份忽略（附录 Z 已记）。
2. 群聊伙伴会话是 `group-talk` 的独立长期会话，正确工具面由 `ensureTalkThread` /
   `peekTalkThread` 在 resume **之前**用 `syncToolSurfaceAsync` 写回首行（团群主理人额外挂
   `team_member_invoke` / `team_phase_invoke` / `team_plan` / `team_status`）。
3. 但这些会话同时出现在侧栏（「伙伴·X@群名」）。宿主通用 `thread/resume` 不区分身份，
   把渲染层 39 个 + 主进程 56 个工具**整份**写回首行 ⇒ 群聊专属工具全被抹掉。
4. 之后 `runTalkTurn` 走 `options.threadId` 快捷路径，不再 ensure/resume，升级没机会执行
   ⇒ 主理人永久没有调人的工具，只能把「已派出 / 进度到第二环」用文字编出来。

⛔ 这也是 11-12 早些时候「进度是编的」「群里废物来一个」的直接原因，与
`harness-dispatch` MCP 握手失败**不是同一条**（那条影响对外 agent_invoke 的 MCP 孪生，
宿主 dynamicTools 仍注册了 agent_invoke）。

## 修法（两处，都是根因）

- `electron/features/codex-ipc.ts`：`thread/resume` 升级分支用 `lookupGroupThread(id)` 判身份，
  群聊伙伴会话**早退**，工具面只由 group-talk 管（动态 import 避开加载环）。
- `electron/features/group-talk/01-channel.ts`：`ensureTalkThread` / `peekTalkThread` 的
  `surface` 恒带 `buildGroupTalkTools()` + `extraTools`，不再在 extraTools 为空时留 undefined
  ⇒ 已被污染的老会话在下次群聊发言时**自动写回**，自愈。

守卫 12be 新增两条（通用 resume 早退 / 两处恒写回），390/390；全链 `npm run check` 0 红。
离线真跑（临时副本，⛔ 不碰用户数据）：17:16 那条首行 95 个工具 → 写回
`group_say,group_read,group_members`，`patched:true`，自愈链成立。

## GitHub 调研（用户令「去看看有没有成熟的群聊系统」）

查了官方仓库现状（2026-11-12）：

- `microsoft/autogen` **已归档、不再维护**（README 2026-10-16 明确 archived，新项目建议转
  Microsoft Agent Framework）。它的 GroupChat / SelectorGroupChat 思想仍值得参考。
- `crewAIInc/crewAI`（MIT，活跃）：Crews 做角色自治协作、Flows 做事件驱动的确定性控制。
- `FoundationAgents/MetaGPT`（MIT，活跃度放缓）：`Code = SOP(Team)`，Environment 共享消息池
  + Role 按订阅消费，动作执行与消息发布分离。
- `langchain-ai/langgraph`：状态机 + checkpoint，生产可控性最强。

**结论**：这些是 Python 框架/运行时，与本项目（Electron + Codex app-server、自有会话/记忆/
权限/UI）不是可替换关系；引入会带来跨进程、重写 UI、丢掉既有隔离体系，且不解决当前根因。
真正值得抄的是三条机制，其中第 ① 条正是本次故障：

1. **执行与汇报分离**：轮次推进、完成判定由宿主/环境负责，模型不许自报进度
   （我们已靠 team_status / 群事件回投，但工具面被抹掉时模型就会退回编造）；
2. **共享消息总线 + 显式发言权选择**（群成员按订阅消费，不靠模型自觉 @）；
3. **终止条件由宿主判定**（chainBudget / ranCount，不靠模型说「做完了」）。

## 追加（11-12 21:00）：首版判据漏了一张台账，已按会话类型重锚

**现象**：修完后重启，启动日志仍出现 `[tool-surface] resume 升级 01a1cf0b → 95 个（宿主 39 + 主进程 56）`，
且没有「跳过」那一行 —— 说明早退没生效，用户会觉得「修了还是跑不起来」。

**取证**：
- `01a1cf0b` 不在 group-talk 台账（`group-talk-threads.json` 只有 `grp_mwcx1h0s` 的 4 个成员），
  但它在 `boss-groups.json` 的 `g_mwdc1m` 成员表里 —— **两套群台账并存**（`grp_*` 工作伙伴群 /
  `g_*` BOSS 群）。
- 首版早退判据只查 `lookupGroupThread`（group-talk 台账）⇒ BOSS 群成员被判成普通会话，
  每次启动都被通用 resume 整份改写回首行 95 个宿主工具 ⇒ 刚自愈的会话又污染回去。

**改法（消除第二套判据）**：
- `src/lib/session-kind.mjs` 新增 `ownsHostToolSurface(kind)`：只有 `normal` / `hub` 的宿主工具面
  归宿主，四类派生会话（专家团 / 专家 / 工作伙伴 / 被调度）由各自域负责。
- `electron/features/dispatch-core.ts` 新增 `sessionOwnsHostToolSurface(threadId)`：走
  `threadKindFacts → sessionKindOf`（读全部台账），⛔ 不在 resume 侧另写判断。
- `electron/features/codex-ipc.ts` resume 分支改调它；派生会话早退并留日志
  `是派生会话 ⇒ 跳过宿主工具面升级`。判定失败按宿主负责（升级是锦上添花，⛔ 不许挡住 resume）。

**判据**：
- 12be **397/397**（新增真跑：`ownsHostToolSurface` 对六类 + 原型链键的实际返回；负向禁止
  resume 里再出现 `lookupGroupThread(resumeThreadId)`）；全链 `npm run check` 0 红；预检 0 硬失败。
- 真机：重启后日志 `resume 01a1cf0b 是派生会话 ⇒ 跳过…`、`UPGRADE=0`（改前同一会话每次都被升）。

**遗留（如实记）**：`01a1cf0b` 那条 rollout 首行的 95 个宿主工具是**历史污染**，本轮只阻止继续污染，
没有回写修复 —— BOSS 群成员建线程时 `thread/start` 本就不带 dynamicTools（= 0 个），
要不要把历史污染会话回写成空工具面需单独评估（专家团成员的工具面来源不同，⛔ 不能一刀切清空）。

---

## 第三层根因（21:49 用户第三轮：「开始还可以，现在又废了」）

**症状**：主理人「拔节」在群里写「这一轮派给：显影」+ 一整段任务书，显影**没有任何回合**，
连派活工具调用卡都没有 —— 说完就停，成员形同虚设。

**取证（三级证据链，不靠读代码猜）**：
1. 群台账 `group-talk-threads.json`：`grp_mwdlqz10::tgt:expert:marketing-growth-team:marketing-growth-team-lead`
   → thread `01a1d003`。
2. 该 rollout **首行** `session_meta.dynamic_tools` 只有 **3 个**：`group_say / group_read / group_members`
   —— 没有任何派活工具。汇总整份 rollout，三次用户发言里**只调过一次 `group_members`**。
3. 群档案 `harness-teams.json` 的 `grp_mwdlqz10` 成员表：**没有整团槽**（`targetKind === "team"`），
   而是逐个拉进来的 `member`（析毫/察势/显影属数据团、执棋属增长团）+ `expert`（拔节＝增长团主理人）。

**根因**：`isTeamGroup` / `groupTeam` 的判定只认**整团槽**。
`const isTeamGroup = group.members.some(m => m.targetKind === "team")` ⇒ 逐个拉人建的群恒为 false
⇒ `groupTeam = null` ⇒ `leadDispatchTools = []` ⇒ 主理人工具面只剩 3 个群聊工具；
连带 `mustHandBack` / `isLeadSelf` 催办 / `handoffTo` / 收口**全部以 `isTeamGroup` 为门** ⇒ 整套编排不激活。
模型只能把任务书写进正文 —— 它写了「派给：显影」，但一个 `to` 都没填，没人被叫醒。

**为什么"开始还可以"**：@ 整团建的群有整团槽（走原路径）；用户后来改成逐个拉人建群 ⇒ 掉出判据。

**改法**：
1. `src/lib/group-orchestration.mjs` 新增 `resolveGroupTeamSeat`（单一真相源，可离线真跑）：
   ① 整团槽 ② `adminId` 指向的 expert 座位（`targetKey = "<teamId>:<leadId>"`，校验 `team.lead.id`）
   ③ 群里唯一的团主理人座位；判不准（两个主理人都不是主持人 / 普通群）返回 `null`（⛔ 不猜）。
2. `harness-team-ipc.ts` 发言链路与 `upgradeGroupLeadSurfaces` **两处**都用它；`teamSlot` 改为
   「承枢那一行」（整团槽或主理人座位两种形态），`adminId` / `isLeadSeat` / `sameSeat` / `handoffTo` 跟着同源。
3. 跨团成员（`team_member_invoke` 只能派本团，执行端按 teamId 校验）：SOP 与 `group_say` 描述统一改写 ——
   填 `to=名字` **= 真的把活交给他**（relay 送进他的会话、他跑完整回合、产出以他的署名发进群），
   并把旧文案「这是沟通，不是派任务」删掉（那句话等于当场否掉派活语义）。

**"催办会不会重复回复"（用户追问三连）**：会 —— 催办注入 `[系统]` 让主理人再跑一回合 ⇒ 再落一条消息。
**不用文本相似度兜**（阈值边界会漏、换个说法就绕过去），改**事实判据**：
催办回合若一个派活工具都没调 ⇒ 视为复述，**不落群**（只留日志 + 记失败）；真调了工具才落正文。
落点 `echoedNudge`，`okFlag` 同轮扣掉，⛔ 不当成功。

**判据**（全部真跑）：
- 纯函数六形态：整团槽 / 主持人座位 / 唯一主理人 / 两个主理人无主持人 → null / leadId 不匹配 → null / 普通群 → null。
- 守卫 12be **399/399**（新增 ④ 两条：座位解析真跑 + 接线含 `echoedNudge`）；11f 185/185；12ah 250/250；预检通过。
- **真机**：重启后该 rollout 首行 `dynamic_tools` 由 **3 → 8**
  （`group_say / group_read / group_members / team_member_invoke / team_phase_invoke / team_plan / team_status / harness_tools`），
  存量会话当场自愈，⛔ 不需要重建群。`[group-tools] 启动预升级` 走 `admin-seat` 分支。

**遗留（如实记）**：
- 跨团成员仍只能走 `group_say(to=)`（`team_member_invoke` 的执行端按 teamId 硬校验，跨团派活本轮不做）。
- 主理人拿到工具后若仍不调、宿主催办也不动 ⇒ 现在只是「不重复」+ 记失败，没有再上一层强制投递。

---

## 第四层：派活终于跑通了，但同一件活被派三次（22:39 用户截图「唉这个弄不好吗」）

**这一轮是**好**消息**：主理人第一次真调 `team_member_invoke`（memberId=`growth-analyst`），
返回「[已派单]」，成员真跑完并把产出落回群 —— 前面三层修的就是这个。剩下三个瑕疵：

**① 同一件活被派三次**
群日志里三条 `team-dispatch:run-*` 派单回执，正文几乎一样；成员自己回「**这次是第三次收到同一任务**」。
根因：`dispatchSignature(teamId, memberId, query)` 取 query **原文**前 240 字 ⇒ 主理人重派时
改个标点、多加半句，签名就变 ⇒ 10 分钟幂等形同虚设。
修：签名先归一化（去全部空白与标点）再取前 120 字。

**② 真派活后仍甩「本轮没有实际派活…不可核实」**
`evaluateMemberOutput({...})` 调用处**没传 `toolCalls`** ⇒ `verifyProgressClaim` 收到的
toolCalls 恒为空 ⇒ evidence 只来自「本回合其他成员产出」（那一刻还没有）⇒ 每条真派活后面都跟一条假回执。
修：`teamToolUsedSince` 从「只存最近一次时刻」改为**逐次记录 `{at, name}`**，新增
`teamToolsUsedSince(threadId, since)` 按回合取真实工具名，传给 `evaluateMemberOutput`；
派活类仍由纯函数自己筛（`team_status` 不算派活）。

**③ 回喂文案没禁止重派**
`mustHandBack` 的 `[系统]` 消息只说「继续下一阶段」⇒ 只有一件活时主理人不知道怎么办，就重派。
修：文案加「⛔ 同一件活不要重派（他刚交回的就是这一环的结果）」+「没有下一阶段就直接写「收口」」。

**附带确认**：`AsyncRunPanel` 卡在「0/1 已交回」是 ① 的连带 —— 三批 `leadThreadId` 相同，
第一批完成时后两批还在跑 ⇒ `stillRunning` 为真 ⇒ `settled` 事件不发。①修好后只剩一批，事件正常。

**判据**：12be **401/401**（新增 ⑤ 两条：签名归一化 + 派活证据按回合取工具名）；预检通过；
三仓各自 build + 守卫 + 预检。

---

## 第五层：我的防重复判据把「验收结论」吞了（22:56 用户「效果也不对」）

**这是我上一轮引入的回归**，不是老问题。

真机：成员交回后宿主回喂主理人（ask = `[系统] 这一批 1 件：交回 1 件…`），主理人调
`exec_command` 核验产物、写了「**验收通过 ✅** …」，但群里 22:39 之后再无任何消息 —— 被
`echoedNudge` 判成「没调派活工具 = 复述」直接不落盘。

根因：判据原来是 `nudgedTurn = /^\[系统\]/`（**所有**系统注入都算催办）。但 `[系统]` 有两类：
- **催办**：目的就是逼它派活（`你这一轮没有派任何成员` / `你这一轮已经调过团队工具`）——
  没派活 ⇒ 确实是在复述 ⇒ 拦是对的；
- **回喂 / 定时任务**：正文本身就是验收结论（`交回了这一环的产出` / `这一批 1 件：交回 1 件`）——
  拦掉等于把结论吞了，群里看起来「没反应」。

修：`nudgeAsk` 只匹配那两种催办 ask，回喂/定时任务一律落群。判据真跑五例（2 催办 / 3 非催办）。

**教训（写进纪律）**：「用事实判据代替文本相似度」是对的，但**事实判据的适用范围必须先界定**——
`[系统]` 这种宽前缀不能直接当语义标签，要先分清它到底在要求什么。

**判据**：12be **402/402**（新增一条：防重复只在催办类 ask 生效）；预检通过；三仓 build + 守卫 + 预检。
