---
id: 2026-10-29-change-cli-智能体板块分类搜索检测安装命令-kindcli-接入-与-agent-invoke
date: 2026-10-29
kind: change
area: cli-agents
title: CLI 智能体板块（分类/搜索/检测/安装命令）+ kind=cli 接入 @ 与 agent_invoke
tags: [cli-agents, dispatch, mention]
commits: [e0aa9a8a5]
files: [electron/cli-agents.ts, electron/features/cli-agents-ipc.ts, src/features/cli-agents/CliAgentsPanel.tsx, electron/dispatch.ts]
importance: high
---

# CLI 智能体板块（分类/搜索/检测/安装命令）+ kind=cli 接入 @ 与 agent_invoke

## 结论

开发工具里新增了「CLI 智能体」板块，并把 CLI 接成**第四类调度对象**（`agent_invoke(kind="cli")`），
与专家 / 子智能体 / 专家团共用同一条派活链路与同一套闸门。`@` 面板里能直接点名 CLI。

## 三段设计（对应上轮列出的三个前提）

1. **安装来源 —— 只给核实过的命令，⛔ 不假装能一键装。**
   `installCmd` 逐个核实：Claude Code `@anthropic-ai/claude-code`、Codex CLI `@openai/codex`、
   Gemini CLI `@google/gemini-cli`、Aider `pip install aider-chat`、OpenClaw `npm i -g openclaw`；
   **Harness CLI 没有公开包名 ⇒ 留空**，界面写「按你自己的分发」。用户复制一条装不上的命令，比不给更糟。
   安装动作一律不代跑：只「复制命令」+「检测是否已装」（`where`/`which` + `--version`）。
2. **`kind="cli"` —— 不塞进 subagent 冒充。**
   新域 `cliagents(4)` 只做管理面（list / detect / save / remove）；派活仍走唯一通道
   `agent_invoke` → `runDelegatedTask`，登记 / 工作区 / 记忆 / 产出回传全部复用。⛔ 没有第二条直连引擎的旁路
   （09-14 `subagents:invoke` 的教训）。
3. **分类口径 —— 用途三档**（coding 编码 / agent 通用智能体 / custom 自建），分类表由主进程下发，
   渲染层不复制第二份字面量。

## 派活时怎么"用它"

`buildCliRolePrompt` 生成的提示词写死四条：先 `--help` 自检 → 用合适参数跑 → 产出带「实际命令 + 关键输出」
→ **找不到命令就如实回报并附安装方式，不许假装跑过、不许换工具顶替**；且不许再转派（防套娃）。

## 本轮审查修掉的三个真问题

1. **`@` 根本没有触发入口**：上轮把 `@` 整体换成 `*`（引用上下文改触发符）时，把 `@` 的解析一起删了，
   `@ 点名` 只剩面板渲染 / 芯片 / 发送注入 —— 敲 @ 没反应，而交付说明写着「输入 @ 即弹候选」。
   现在按「最后出现的 @ 与 * 分工」，`@` 允许空格（对象名带空格），`*` 仍不许。
2. **芯片把 CLI 显示成「子智能体」**：三元 `expert ? 专家 : team ? 专家团 : 子智能体` 没有 cli 分支，
   落到 else。收成 `mentionKindLabel()` 单一映射（面板与芯片共读）。
3. **「新建子智能体」与既有候选同时出现**：输入 "Claude" 已匹配 Claude Code，下面还挂
   「新建子智能体「Claude」并 @」，点错就凭空多一个角色 ⇒ 只在**一条都没匹配到**时才提供。

## 判据

- `npm run check`：exit=0 / 0 条 ✗；新守卫 `12ah-cli-agents.mjs` 49 条（真跑 dist-electron 产物）。
- 真机：分类计数 6/4/1/1；「全部检测」逐条显示「未检测到」；
  `detectCliAgent({bin:"node"})` → `{installed:true, version:"v22.22.2"}`；
  `listDispatchCatalog` 里 CLI 6 条（total 18）；`@Claude` 弹候选 → 选中出芯片「@CLI Claude Code」、输入框清空。
- 三仓：主线 `e0aa9a8a5` / PPcode `ff16ab44` / 云助手 `63992d8d`（界面已部署，入口哈希一致）。

## 副本同步踩到的坑（写给下一次）

- ⛔ **不能整文件覆盖 `composition.json`**：云助手有 cloud-auth 等特有域、PPcode 有 html-video 的差异，
  覆盖会把它特有的配置删掉 ⇒ 只在 `clipboard` 前插 cliagents 一条，再各仓自跑 `gen:domains`。
- ⛔ **不能整文件覆盖 `styles.css`**：云助手有 `37-cloud-account` 分节。
- ⛔ **不能整文件覆盖 `gen-capability-skill.mjs`**：云助手有 limited-benefit / model-source 两条描述。
- ⛔ **不能整文件覆盖 `preload.ts` / `vite-env.d.ts` / manifest / registry**：副本有 relay / cloud 专属通道
  ⇒ 只往各自 manifest 加 4 条，再 `gen:ipc` 自产。
- 副本渲染层文件（02-composer-form.tsx）落后两轮且带云账户特有字段 ⇒ 用 `git format-patch` 的
  **两次提交补丁**逐次 apply，比自己重写整块 JSX 稳。
