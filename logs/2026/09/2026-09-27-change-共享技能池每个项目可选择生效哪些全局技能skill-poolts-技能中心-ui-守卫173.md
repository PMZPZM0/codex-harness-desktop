---
id: 2026-09-27-change-共享技能池每个项目可选择生效哪些全局技能skill-poolts-技能中心-ui-守卫173
date: 2026-09-27
kind: change
area: engine
title: 共享技能池：每个项目可选择生效哪些全局技能（skill-pool.ts + 技能中心 UI + 守卫【173】）
tags: [skill-pool, per-project, skills, ipc, ui]
commits: []
files: [electron/skill-pool.ts, electron/project-conventions.ts, src/features/settings-skills/SkillPoolSection.tsx, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 共享技能池：每个项目可选择生效哪些全局技能（skill-pool.ts + 技能中心 UI + 守卫【173】）

用户需求：技能界面加「共享技能池」管理 UI，每个项目可选择生效哪些全局技能。

【模型】两个配置真相源 + 一个磁盘投影：
- 全局停用集 codex-home/skill-global-disabled.json（跨项目停用，迁移自原 .disabled 改名）
- 项目禁用集 <项目>/.codex-harness/skill-pool.json（随项目走）
- 实际生效 = 全局启用 ∩ 非本项目禁用；syncSkillPool(cwd) 投影到磁盘改名（SKILL.md ⇄ SKILL.md.pool-disabled）
- 投影挂在 ensureProjectAgentsMd（【171】的同一收口）→ 12 处 thread/start 调用点自动继承

【⛔ 设计关键——投影形态竞态（变异实测抓出来的）】初版投影直接用引擎旧形态
SKILL.md.disabled，导致「迁移保底」把**上一次投影产生的停用态**误判为用户遗留停用而
收编进全局集（实测：解除项目禁用后又被停回去）。修法：投影用专属形态 .pool-disabled，
与用户遗留 .disabled 可区分；.disabled 只被收编一次（记入全局停用集并转 .pool-disabled）。
联动技能 memory-mcp-backend 排除在池管理外（由 builtin-skills 的记忆后端切换维护，避免打架）。

【实现】electron/skill-pool.ts（sync/describe/set 三件套，codexHome 取 runtime-refs 单例）；
IPC 走 manifest 流程（skills:pool-describe / skills:pool-set → gen:ipc → ipc-registry skills 域
count 8→10）；UI 新组件 SkillPoolSection（自取数据不经 bag，避开【92】顺序契约），挂在技能
中心「我的技能」视图顶部；每技能一行：全局停用 badge + 本项目生效开关，改动即点即生效。

【验收】功能单测 16/16（临时目录隔离跑 dist 产物：迁移收编/项目禁用/恢复/幂等/describe
/不存在技能报错）；守卫【173】8 条全绿；tsc 双 0；vite build；预检我的域 48 绿。
tsc 的 TS1131 中间态是我用正则改签名把别名插进了返回类型里——回读手工修复，教训：
⛔ 多处结构改动不用正则改代码，用 Edit 逐处或整文件重写。
