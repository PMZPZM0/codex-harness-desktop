---
id: 2026-10-05-decision-能力网关把引擎-0157-隐藏的-19-个能力接回模型收成-1-个-harness-tools不
date: 2026-10-05
kind: decision
area: dispatch
title: 能力网关：把引擎 0.157 隐藏的 19 个能力接回模型（收成 1 个 harness_tools，不补 19 个 dynamicTools）
tags: [gateway, dynamicTools, mcp, dispatch, security]
commits: [4c83438]
files: [electron/features/dispatch-rpc.ts, electron/features/agents-ipc.ts, src/features/app-state/parts/part08/01-seg.tsx]
importance: high
---

# 能力网关：把引擎 0.157 隐藏的 19 个能力接回模型（收成 1 个 harness_tools，不补 19 个 dynamicTools）

# 能力网关：把引擎 0.157 隐藏起来的 19 个能力接回模型（`4c83438`）

## 背景
10-04 修了「调度工具用不了」（引擎把内置 MCP 工具整批延迟暴露 ⇒ `agent_invoke` / `expert_list`
一律 `unsupported call`），当时只补了 `agent_invoke` + `agent_archive_sessions` 两个 dynamicTool，
并把「其余 19 个工具仍不可达」记成欠账。10-05 用户令「遗留问题全部处理完毕」。

## 结论：收成**一个**网关工具，不是补 19 个 dynamicTools
宿主注册 1 个 `harness_tools`，模型传 `name` + `args` 调它；主进程原样转给 `dispatchRpcCall`
（同一套实现、同一套闸）。`name="list"` 返回全部能力 + 参数 schema。

**为什么不是 19 个独立工具**（这是本条最值得留档的判断）：
1. 工具面**每次请求**都要带上 —— 19 份 schema 是常驻 token 成本，还会挤掉真正重要的工具；
2. 主进程以后新增 MCP 工具时，渲染层**不用改**；
3. 参数说明按需取（`name="list"`），不占常驻提示词。

**为什么排除 `agent_invoke` / `agent_archive_sessions` / `image_generate`**：它们已有专用
dynamicTool。同一能力挂两个名字，模型只会用最直白的那个、另一套被绕过 —— 项目**踩过一次**
（`subagent_invoke` 与 `agent_invoke` 并存 ⇒ 专家/专家团永远被绕过，最后整体删除）。
⇒ 这条沉淀成通则：**新增动态工具前先查有没有同能力的旧入口，宁可加进网关也不并列第二个名字。**

## 身份：两条路径都必须是「引擎事实」
- 网关：`item/tool/call` 的 `params.threadId`（引擎下发，模型伪造不了），缺它 **fail-closed**；
- 内置 MCP：`dispatchProbes` 旁证（`item/started` 的参数指纹）—— 10-05 给 `dispatchRpcCall` 加了
  可选第三参 `explicitCallerThreadId`，给了就跳过最多 10 秒的旁证等待，MCP 侧行为**不变**。
- ⛔ 归档判据同步改了：`threadIds` 是模型可控参数，原来只要「登记表里有」就归档 ⇒ 能归档别的会话
  派出的委托。现在 MCP 侧比对 `callerThreadId`（旁证认定），⛔ 不用模型自填的 `args.originThreadId`。

## 同批补齐的另外三件（都是"方法写好了但没人调 / 没人清"）
- **幽灵委托记录**：`DelegateRegistry` 此前没有任何遗忘路径 ⇒ 删了会话，办公室还留着一个点不开的
  人。新增 `forget` / `forgetDeleted`，接到**两条**删除入口（boot 的 `thread/deleted` 事件分支 +
  codex-ipc 的 finally），启动再按墓碑集合对账。⛔ 归档**不清**（归档是"收起"，记录要留着防重复询问）。
- **`prune()` 从未被调用**（7 天保留期是空话）⇒ 登记表只增不减。现在启动时跑。
- **「关于」示范插件**改默认停用：10-04 声明式插件的 6 个示范件里唯独它 `enabled: true`，
  一直挂在用户侧栏（用户 10-05 报「这个关于怎么又出来了」）。新增守卫 `11j`：
  内置示范件**一律**默认停用，且**空目录判红**（防恒真过）。

## 影响面
- 老会话需要**切走再切回**（dynamicTools 只在 `thread/start` / `resume` 生效）。
- 新增 IPC `agents:dispatch-call`（manifest 413 → 414，域计数 10 → 11），已跑 `npm run gen:ipc`
  同步 preload / vite-env.d.ts / `IPC_CHANNEL_COUNT` / `harness-api` 能力清单。
- 守卫：新增 `11i-capability-gateway.mjs`（17 条，含「渲染层描述必须列全主进程的能力清单」
  —— 防新增能力静默不可见）；`11f` 新增组 G（登记表生命周期 5 条）。
- ⚠️ 本轮沙箱在 harness 层封了 `spawnSync`（EBUSY）⇒ 全量预检有 19 条**环境类**失败
  （before-pack / 【28】tomllib / Node type-stripping），都在本轮没碰的域；末尾三闸已手动补跑全绿。

## 附带修掉的一个假红陷阱（值得单记）
`06-app-behavior.mjs`【29】防线二原来用**固定 900 字符窗口**找事件分支里的清理调用。往那个分支
加几行注释就假红 —— 本轮连踩两次：① 加委托清理；② 改按"下一个分支"切边界时，边界撞上分支体里
**嵌套**的 `if (event.method === "thread/deleted")`（10 空格 vs 同级 6 空格），切片只剩 297 字符。
⇒ 两条通则：**窗口类判据一律按结构边界切**（此处 = 同级缩进的下一个分支）；**切片后必须有一条
"切片确实跨到了目标代码"的前置断言**，否则边界写错时后面那条恒假而无人察觉。
另外本文件的 `ok/fail` 是**单参**（消息）版，写 `ok(cond, msg)` 会把 cond 当消息打印、**恒判通过** ——
我也踩了，已在文件里留警告。
