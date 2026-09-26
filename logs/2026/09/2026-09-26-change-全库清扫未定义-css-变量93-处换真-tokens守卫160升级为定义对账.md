---
id: 2026-09-26-change-全库清扫未定义-css-变量93-处换真-tokens守卫160升级为定义对账
date: 2026-09-26
kind: change
area: ui
title: 全库清扫未定义 CSS 变量：93 处换真 tokens，守卫【160】升级为定义对账
tags: [theme, css, dark, guard, sweep]
commits: []
files: []
importance: high
---

# 全库清扫未定义 CSS 变量：93 处换真 tokens，守卫【160】升级为定义对账

## 背景

用户拍板全库清扫「引用了但从未定义」的 CSS 变量（09-26 欢迎页菜单事故的同族残留），要求仔细一个个扫。

## 结论

全量对账方法：`var(--x` 引用集合 − `--x:` 定义集合 − TSX 注入白名单 = 待清清单。结果 **93 处替换、14 个 CSS 文件、26 个未定义家族清零**：

| 家族 | 处数 | 去向 |
|---|---|---|
| `--blue`（fallback #3b82f6/#4a90e2 恒定不跟主题） | 26 | `--accent`（亮 #2f6bdd / 暗 #7cabf8） |
| `--amber`/`--amber2`（#d97706/#b7791f/#d99000） | 17 | `--orange`（含同块 2 处硬编码 #b7791f 闭环） |
| `--text-primary`/`--color-text-primary` | 6 | `--text` |
| `--text-secondary` | 5 | `--muted` |
| `--text-tertiary` | 1 | `--faint` |
| `--text-dim` | 5 | `--muted` |
| `--danger`（fallback 三种红） | 9 | `--red` |
| `--danger-bg` | 1 | `color-mix(--red 12%)` |
| `--border` | 3 | `--line` |
| `--color-background-primary` | 1 | `--bg` |
| 死变量（无定义无注入，恒落 fallback）：--bg-elevated/--bg-card/--ruler-gap/--ruler-pad/--sans-font-size/--orb-angle | 11 | 写死 fallback 值（渲染逐像素不变） |
| `--purple` | 5 | **补两主题定义**（亮 #8b5cf6 / 暗 #a78bfa），3 个徽章硬编码 rgba 一并 color-mix 化 |
| `--mono`（9 处 fallback 各不相同 ⇒ 字体长相不一致） | 9 | **补 --mono 定义**（Cascadia Code 栈，与既有代码块一致），统一 `var(--mono)` |

**合法保留**（白名单进守卫）：`--effort-color`/`--fill-color`（EffortPicker 内联注入）、`--t`/`--voice-level`（VoiceCallFloat）、`--submenu-top`（composer-form）、`--vscode-scrollbar-shadow`（xterm/VS Code 宿主约定）。⛔ 判读时踩过一个误报：字符串 `"danger"`（tone 属性）被脚本当成了 `--danger` 注入 —— 注入判定必须 grep `--danger` 全名。

## 防复发

守卫【160】升级为**全库定义对账**：`引用 − 定义 − 白名单 = 空`，剥块注释后跑（注释里解释事故会写出同名字串）。今后任何人引用任何未定义变量预检直接红，并点名变量名。

## 验证

- 终复查 0 未定义引用；tsc 0 错；预检 0 条真红（总账 19 条 = 已知五类沙箱假红）。
- 真机 CDP 双主题抽查：侧栏聚类展开按钮 toggleBg 亮 #ffffff / 暗 **#1b1b1a**（原恒白已修）；
  聚类头标题亮 #23231f / 暗 #ececea；供应商提示亮 #e8830c / 暗 #f0a35c（--orange 跟随）；
  紫徽章亮 #8b5cf6 / 暗 #a78bfa；mono 字体栈统一生效。
- 变异测试：塞 `var(--fake-undefined-x)` → 对账断言红并点名；还原后绿。

## 影响面

纯 CSS 变量替换 + 2 个新 token（--purple/--mono）。亮色主题视觉几乎不变（fallback 本来就是按亮色调的）；暗色主题下这批元素首次真正跟随主题。已知取舍：--border→--line、--danger→--red 在亮色下色值有轻微偏移（原本恒定的 fallback 换成了主题变量），属修复意图内。

## 回滚

git revert 单提交即可；守卫【160】对账断言随提交回滚。
