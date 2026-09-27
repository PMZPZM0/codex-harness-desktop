---
id: 2026-09-27-change-技能池面板加项目切换器可切到其他项目管理其生效集复用-memory-project-picker
date: 2026-09-27
kind: change
area: ui
title: 技能池面板加项目切换器：可切到其他项目管理其生效集（复用 memory-project-picker）
tags: [skill-pool, project-picker, ui, guard173]
commits: []
files: [src/features/settings-skills/SkillPoolSection.tsx, src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 技能池面板加项目切换器：可切到其他项目管理其生效集（复用 memory-project-picker）

技能池面板加项目切换器（用户需求「项目地址加一个项目切换功能，方便快速切换其他项目进行技能禁用」）：

- SkillPoolSection 复用记忆中心 memory-project-picker 组件类（同「当前管理项目」语义，零新 CSS）：
  管理对象默认 = 当前工作区，可切换到任何已知项目；切换只改管理目标、不改当前会话工作区
- 项目清单 = 当前工作区 ∪ bag.projectGroups（由 settings-registry 穿 props，免自建 IPC；
  bag-types 已有 projectGroups 字段无需再生）
- 修正一个交互缺陷：初版把选择器放在「已选项目」分支内 ⇒ 没开工作区时反而选不了项目；
  现在展开即见选择器，选中后才有卡片网格
- 守卫【173】⑧同步（挂载断言穿 projects）
- 视觉验收按 DESIGN.md「先渲染出来看」：组件级探针（vite+Edge 同进程 spawn）截
  展开态与菜单展开态两图确认（管理项目条 / 当前标记 / 勾选态 / 徽标全部正常）
