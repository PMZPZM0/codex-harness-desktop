---
id: 2026-10-27-change-openfilm-批次二studio-连接与配对-6-个模型工具-技能
date: 2026-10-27
kind: change
area: openfilm
title: OpenFilm 批次二：Studio 连接与配对 + 6 个模型工具 + 技能
tags: [openfilm, studio, tools, skill]
commits: [884dd1b6e]
files: [electron/openfilm/tools.ts, electron/openfilm/studio.ts, electron/builtin-skills/26-skill-openfilm.ts, src/features/openfilm/OpenfilmBridge.tsx]
importance: high
---

# OpenFilm 批次二：Studio 连接与配对 + 6 个模型工具 + 技能

# OpenFilm 对接批次二：Studio 连接与配对 + 6 个模型工具 + 技能（P2/P3）

用户令：让 Codex 在用户提出剪辑需求时自动完成下载 / 安装 / 连接 / 配对，并直接调用它剪片。

## 结论

整条链已经通了（工具面 → 主进程 spawn → Studio 开在内置浏览器），**唯一还没做的是桌面 App 形态**（P4）。

## 四条硬结论（读上游源码 + 实测得出，与设计稿的推测不同）

1. **`Studio <url>` 打在 stdout，不是 stderr**。`bin/openfilm.mjs` 里 `result.lines` 走 `console.log`；
   进度/告警走 `console.error`。同时 `project  <path>` 也在 stdout —— 没项目时那句是**人话**
   （`none yet: …`），直接当路径存会得到一个假目录（已做 `^none yet` 过滤）。
2. **Studio 的 pid 不在我们手上**。`open` 只 POST `/api/open` 就退出；Studio 由 `ensureStudio()`
   以 `detached + unref()` 拉起，真 pid 写在 `~/.openfilm/run.json`（还有 `supervisor`）。
   ⇒ 存活判据改为 `run.json` + `GET {origin}/api/health` 认 `product=openfilm-studio`
   （⛔ 不看 HTTP 200：端口上可能蹲着别的服务）。原方案"跟踪子进程 pid"是错的。
3. **不提供「关闭 Studio」**。机器级单实例，可能正被上游桌面 App 或另一个 agent 用着；
   杀它 = 丢用户没保存的手改。要重启用 `open` 幂等再连（上游自己在版本不符时替换）。
4. **`open <未存在路径>` 会建项目**：`openProject(path, {create:true})` 建目录 + `film.html` + `.film/`，
   并拒收 home / 盘根 / `~/.openfilm`（`refuse()`）—— 我们的目录闸与之同口径，另加"必须在会话工作区内"。

## 结构（为什么要拆六个文件）

`ipc ↔ studio` 互相 import 会成环（CJS 循环下 `plugin === undefined`，启动即崩）。按依赖方向分层：

- `paths.ts` 路径/设置 · `runner.ts` 唯一子进程出口（spawn args[]、超时、内置 node、toolchainEnv）
- `probe.ts` 状态 · `studio.ts` 打开与探活 · `tools.ts` 工具面+应答+目录闸 · `brand.ts` 声明常量

## 工具面（6 个，注册**不带安装条件**）

`status / make_film / check / render / get / skill`。没装时它们照样在工具面上 —— 第一个动作就是
"缺什么、让用户去卡片点安装"；工具隐藏 = 模型只会说自己没这个能力，用户永远装不上。

三条硬闸：命令白名单（无 `update`/`doctor`）、目录闸（工作区内 + 四禁区）、产物只回路径。
`boot.ts` 排在 `filterForRenderer` **之前**应答 ⇒ 前台会话与后台会话（专家/子智能体）同一条路。

## 顺带修掉的真 bug

`install` / `retry` / `studio-open` 的 `paramsImpl` 写成了必填 ⇒ 生成器算出 `minArgs=1`
⇒ 卡片上「下载并安装」（不传参）被 `ERR_MISSING_ARGS` 挡掉、**点了没反应**。已改可选。

## 判据

- `guards/23-openfilm` 82/82（域登记 9 通道 / 镜像两跳 / 卸载闸 / 版本单一真相源 / Studio / 工具 / 技能 / 卡片）
- `npm run check` 主仓全链 **EXIT=0**；`npm run build` 绿
- 真机：状态 `phase=absent` + 内置 node 24.19；`studio-open` 未装返回 `OF_E_NOT_READY`；
  编译产物里 6 个工具定义正确、非 `openfilm_` 前缀 `pass-through`；目录闸真值表 6 例
  （工作区内 ALLOW，home / 盘根 / `~/.openfilm` / 工作区外 DENY）；卡片 5 灯 + 声明链接

## 未做

P4 桌面 App 形态（`OpenFilm-Setup-x64.exe` / dmg 的下载、静默安装、macOS Gatekeeper 引导）。
