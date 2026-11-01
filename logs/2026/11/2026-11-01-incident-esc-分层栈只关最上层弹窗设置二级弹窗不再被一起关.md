---
id: 2026-11-01-incident-esc-分层栈只关最上层弹窗设置二级弹窗不再被一起关
date: 2026-11-01
kind: incident
area: ui
title: ESC 分层栈：只关最上层弹窗（设置二级弹窗不再被一起关）
tags: [esc, dialog, settings, keyboard]
commits: []
files: [src/lib/escape-layer.mjs, src/hooks/useEscapeLayer.ts, scripts/guards/12aq-escape-layer.mjs]
importance: normal
---

# ESC 分层栈：只关最上层弹窗

## 背景
用户实测：设置页里打开二级弹窗后按 Esc，二级弹窗和设置弹窗一起关掉；要求「esc 只关闭最上面的」。

## 结论
根因：每个弹窗各自 `window/document.addEventListener("keydown")`，同一个 Esc 会被**所有打开的层**收到。此前几处用「捕获阶段 + stopPropagation」互相躲，但 `stopPropagation` 拦不住**同一 target** 上的其它监听 ⇒ 仍然叠着一起关。

修法：新增全局 **ESC 分层栈** ——
- `src/lib/escape-layer.mjs`：所有层按挂载顺序入栈；一个 window keydown（bubble 阶段）只让**最上层**消费；handler 返回 `false` 表示本层不消费（继续下一层）；只有栈非空时才拦截，元素级（输入框/下拉框）的 Esc 仍先执行。
- `src/hooks/useEscapeLayer.ts`：组件挂载注册、卸载移除；用 ref 持有最新 handler，避免闭包过期。
- 已迁移 **30 个弹窗/浮层**（设置弹窗、帮助、关闭确认、语音确认、新增页、新建项目、登录管理、侧栏教程、密码本、云同步两弹窗、模型编辑、工具报错、应用锁、技能池、头像浮层、力度选择、标签编辑、文件卡菜单、记忆项目菜单、顶部菜单/历史面板、登录页浮层、专家团帮助、侧栏面板、调度菜单、播报面板、新手引导、灯箱等）—— 不限于两级：栈按挂载顺序支持**任意层数**，一次 Esc 只关最上层。
- 守卫 12aq：真跑验证「只关最上层 / false 回落 / 栈清空」，并静态钉住这 30 个弹窗/浮层必须走栈、不许再自己监听 Esc。

## 依据
- 守卫输出：`【esc】6/6 通过`（三仓均通过）。
- 真跑：push A、push B → Esc 只调用 B；移除 B → 再 Esc 调用 A；空栈不再拦截。
- 迁移后这些组件内不再有 `key === "Escape"` 的 window/document 监听。

## 影响面
- 设置/二级弹窗的 Esc 行为：一次只关一层；提交中/忙碌中的弹窗会消费 Esc 但不关闭（不会误触外层）。
- 其它未迁移的浮层（编辑器菜单、画布等）在**没有**已迁移弹窗时行为不变；后续如出现同类叠加问题，按同一 hook 迁移即可。

## 回滚
回退对应提交；或把组件改回各自监听（不推荐，会复发本次问题）。
