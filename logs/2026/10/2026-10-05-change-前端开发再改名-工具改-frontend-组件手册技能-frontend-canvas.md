---
id: 2026-10-05-change-前端开发再改名-工具改-frontend-组件手册技能-frontend-canvas
date: 2026-10-05
kind: change
area: ui-sketch
title: 前端开发：再改名（→）+ 工具改 frontend_* + 组件手册技能 frontend-canvas
tags: [ui-sketch, rename, frontend-canvas, mobile-ui]
commits: []
files: [electron/builtin-skills/20-skill-frontend-canvas.ts, electron/builtin-skills.ts, electron/developer-instructions.ts, src/features/ui-sketch, src/features/app-state/parts/part08, src/features/app-state/parts/part05, src/features/app-view/constants/01-notices-labels.tsx, scripts/guards/11h-ui-sketch.mjs, scripts/guards/_ctx.mjs, scripts/accept.mjs, AGENTS.md]
importance: normal
supersedes: 2026-10-05-change-手机前端ui改名界面草图-一键预览-工具改-mobile-ui
---

# 前端开发：再改名（→）+ 工具改 frontend_* + 组件手册技能 frontend-canvas

# 前端开发：再改名（手机前端UI→）+ 工具改 frontend_* + 组件手册技能

## 背景
- 用户（10-05 夜）：①「我刚刚发现了这个里面也有电脑版前端UI选项」；②「网页版也有选项也有工具内容也更新一下」；③「名字就叫前端开发」；④「把那个内置组件的，按照这个前端UI支持的展示和拓展效果更新进去」。
- 实测画布能力（从随包产物原文核对，非道听途说）：每屏可选**手机 / 电脑**（手机=412×892，电脑=显式 `w:1280,h:800`）；`platform` 选 **android / web**（web=在浏览器中运行的应用）；混合稿=同名屏两宽度、按响应式。⇒「前端开发」这个名字覆盖手机 / 电脑 / 网页三形态，成立。

## 结论
- **展示名三度更名**：界面草图 → 手机前端UI → **前端开发**（域 id / `sketch://` 协议 / `m3e:doc` 存储键一律不动）。侧栏入口、弹窗、全部文案、注释、文档、守卫/验收标签全量改。
- **工具改名**：`mobile_ui_get_doc/apply_doc` → **`frontend_get_doc/frontend_apply_doc`**；描述**列全 36 种 kind 名字**（此前只举 8 个例）并点名手机/电脑两种屏尺寸 + platform；旧名（sketch_* / mobile_ui_* 两代）负向断言禁止残留分发。旧会话要切走再切回才出现新名字（dynamicTools 只在会话建立时注入）。
- **常驻指令第 13 条**：`MOBILE_UI_INSTRUCTIONS` → **`FRONTEND_CANVAS_INSTRUCTIONS`**，覆盖手机/电脑/网页三形态，点名组件手册技能。
- **组件手册技能 `frontend-canvas`**（新增内置技能 + 中文导读 + # 面板保底名单三处同步）：36 种组件字段速查（含上游 agent.md 漏写的 `bottomSheet` / `datePicker` / `timePicker` / `carousel`，字段与默认尺寸逐一从产物原文核出）、手机/电脑/网页三形态矩阵、导航/主题/坐标/自查清单。⛔ 画布本体是随包产物、**组件面板加不了新控件**（"照原样嵌"纪律）——"组件更丰富"落在**让 Codex 把现有 36 种用全**：名字进每一轮的描述、字段进按需读的技能。
- 顺带修正两处被并行线改坏的**闸门数字**（与本次功能无关但挡预检）：`_ctx.mjs` EXPECTED_CHECKS 又被把独立守卫条数加进来（壁纸 +13、办公室 +29+15）→ 回填实测 **3204**（三棵树一致，铁律重申）；`01-notices-labels.tsx` 的 # 面板保底名单补 `frontend-canvas`（守卫【229】抓出来的真实漏项）。
- **验收项 `ui-sketch` 按用户令「验收的脚本重新写，不要老是验收旧的」整段重写**（10-06 轮）：探针从单屏升级为**三形态**（手机屏 412×892 + 电脑屏 1280×800 + `platform: "web"` + 桌面组件 navRail），检查编号改成执行顺序（旧版 ⑧ 垫底是历史编号），全项 11 条；轮次升 10-06、`LATEST_ROUND = "10-06"` ⇒ **默认验收只跑这一项新项**，message-feedback 等留作历史回归证据（`--all` 才全跑）。

## 依据
- 守卫【283】**149 → 158 条**（+9：写工具描述 36 种 kind 全覆盖（词界正则，防 `fab`/`extendedFab` 子串假绿）/ 屏尺寸点名 / 指令块点名技能与尺寸 / 技能注册 / 技能内容 36 种全覆盖 / 技能点名工具 / 三形态字段 / 中文导读条目）。
- **11 处变异全部被抓**（工具名双端 / 描述删一个 kind 名 / 描述删屏尺寸 / 指令接线 / 指令丢技能名 / 指令丢工具名 / 技能注册改名 / 技能表删一个 kind / 导读 key 改名 / 侧栏标签回改名）。
- **验收真跑**：重写后的 `ui-sketch` **11/11**（⑦真实上游收分享哈希 ok:true / ⑧摘要变「2 屏 / 2 部件」= 手机屏+电脑屏+platform web 全被上游收下 / ⑨预览点真键 / ⑩原样还原）；**accept 级变异**（探针 `platform: 'web'` 改坏 → ⑦⑧ 转红 9/11、exit 1 ⇒ 断言非恒真，且证明上游真的在校验 platform）；重写前旧版 12/12 + 全轮 26/26。
- **npm run check = 0**（全链全绿，含并行线的守卫）；tsc 双侧 0；预检的 229 与守卫自检两处红已修（修后实测 3204 全跑满、无环境类失败）。⚠️ 提交时点的两处预检红（产物过期 + 【233】坐姿锚点）= 并行线办公室在制品刚改完 OfficeCanvas/office-sim，与本轮无关。

## 影响面
- 渲染层 `src/features/ui-sketch/`、part05/02-request、part08/01-seg、01-sidebar-shell、AppView、part02 注释、`constants/01-notices-labels.tsx`（保底名单）；`electron/developer-instructions.ts`、`builtin-skills.ts`、`00-skill-zh-notes.ts`、**新文件 `20-skill-frontend-canvas.ts`**；`scripts/guards/11h-ui-sketch.mjs`、`_ctx.mjs`；`scripts/accept.mjs`；AGENTS.md / ARCHITECTURE-RULES.md。
- ⛔ 组件库面板保持删除（负向断言未动）；⛔ 桥与写回通道一行未动（预览/写回机制沿用上一轮）。

## 回滚
- 改名与描述均为字符串级改动；技能可整文件删除 + 从 entries/导读/保底名单三处摘名（【229】会提醒漏摘）；`_ctx.mjs` 数字改回前值需附实测依据（别凭记忆）。
