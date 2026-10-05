---
id: 2026-10-05-change-手机前端ui改名界面草图-一键预览-工具改-mobile-ui
date: 2026-10-05
kind: change
area: ui-sketch
title: 手机前端UI：改名（界面草图→）+ 一键预览 + 工具改 mobile_ui_*
tags: [ui-sketch, rename, preview, mobile-ui]
commits: []
files: [scripts/sketch-bridge.js, src/features/ui-sketch, src/features/app-state/parts/part05, src/features/app-state/parts/part08, electron/developer-instructions.ts, scripts/guards/11h-ui-sketch.mjs, scripts/accept.mjs, scripts/build-sketch-bundle.mjs, AGENTS.md]
importance: normal
---

# 手机前端UI：改名（界面草图→）+ 一键预览 + 工具改 mobile_ui_*

## 背景
- 用户（10-05 夜）三点要求：①「界面草图名字改一下叫手机前端UI」；②「配套工具内容也要改，Codex 要知道用这个，涉及手机前端开发能主动调用这个工具」；③「加一个对话框预览这个UI界面功能组件，联动做好」。
- 两项拍板：预览形态选「**弹窗内一键预览**」（触发上游自带的交互预览，不重造预览层）；工具名选「**改成 mobile_ui_\***」。

## 结论
- **展示名全量改**：侧栏入口 / 弹窗标题与状态条 / 工具与分发文案 / 注释与文档（AGENTS.md、ARCHITECTURE-RULES.md）。域 id、类名前缀、`sketch://` 协议、存储键 `m3e:doc` **一律不动**（改名不搬内部标识，守卫的协议/枚举对账照旧）。
- **工具改名**：`sketch_get_doc/sketch_apply_doc` → `mobile_ui_get_doc/mobile_ui_apply_doc`，描述重写为「做手机端界面时主动调用、先读再改」。⚠️ 旧会话要**切走再切回**才出现新名字（dynamicTools 只在 thread/start 与 resume 注入）；旧名不留在分发里（改名留双门 = 两条真相，负向断言钉着）。
- **常驻指令第 13 条**（`MOBILE_UI_INSTRUCTIONS`）：与工具同在、条件式（`mobile_ui_apply_doc` 不在工具表里就明说别猜画布内容）——工具在表里模型未必主动用，与第 12 条 Uiverse 同款纪律。
- **一键预览**：弹窗头部「预览」按钮 → 桥**代点上游工具栏的 play_arrow 键**（图标 ligature 是语言无关锚，跳过 disabled / 隐藏键）→ 上游自带的交互预览（点按跳转 / 滑动返回 / ESC 退出）在弹窗内全屏播放；桥回 `preview-result` 回执、宿主状态条同步。预览界面是**上游渲染的**，宿主不造第二层；预览路径不碰存储。

## 依据
- 守卫【283】**131 → 149 条**：预览三处字面量对账（弹窗按钮 ↔ 桥 ↔ 回执）+ VM 用例 D（preview 真跑：只点可用可见键 / 找不到如实报 ok:false / 不碰 setItem）+ 指令块**切片**断言（接线 + 块内点名两工具 + 「手机前端UI」叫法）。
- **13 处变异全部被抓**：12 守卫级（工具名双端 / 弹窗 post 与回执与就绪门 / 桥图标字面量与 disabled 跳过与回执 / 指令接线与点名 / 侧栏标签，含两处变异**反向暴露弱断言**当场加强：五项文案改锚 `<strong>` 标签本体；指令名字改按块切片）+ 1 accept 级（模态回执分支改坏 → 真实产物上 ⑫ 转红 11/12、exit 1）。
- 验收项 `ui-sketch` **12/12**（含 ⑫ 真跑：真实产物里找到上游播放键并点到、receipt ok:true、状态条「预览已开始」）；截图拍到手机样机预览（返回/屏名/关闭工具条 + 验收屏内容）。
- 顺带修两处验收基建（都是本轮实测挖出的根因）：① ⑫ 排在**还原之前**（趁探针文档还在、1 屏可预览；空画布上游没什么可预览）；② **Chromium localStorage 惰性提交（约 5s 落盘）**——还原写入后 accept 立刻关应用会把它丢掉，profile 在「探针 ↔ 原文档」间反复漂移；还原后捞 6s 再关，两次连跑验证稳定。

## 影响面
- 渲染层 `src/features/ui-sketch/`、part05/02-request、part08/01-seg、01-sidebar-shell、AppView、`26-ui-sketch.css`；桥 `scripts/sketch-bridge.js`（+ 重跑 `--bridge-only` 内联）；指令 `electron/developer-instructions.ts`；守卫 `11h`；验收 `accept.mjs`；文档 AGENTS.md / ARCHITECTURE-RULES.md。
- ⛔ 组件库面板保持删除（负向断言未动）；⛔ 桥从不写 localStorage（含新的预览路径，VM 负向钉住）。

## 回滚
- 改名可逐点还原（纯字符串，无逻辑）；预览 = 桥里一个分支 + 弹窗一枚按钮 + 两条守卫断言，删掉即回只读态，不动写回通道。
