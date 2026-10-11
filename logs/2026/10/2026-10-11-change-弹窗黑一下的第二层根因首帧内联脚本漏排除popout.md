---
id: 2026-10-11-change-弹窗黑一下的第二层根因首帧内联脚本漏排除popout
date: 2026-10-11
kind: change
area: appearance
title: 弹窗黑一下的第二层根因首帧内联脚本漏排除popout
tags: [boot-intro, popout, first-frame, bugfix]
commits: []
files: [index.html, scripts/guards/20-boot-intro.mjs]
importance: high
---

# 弹窗黑一下的第二层根因首帧内联脚本漏排除popout

# 「点独立弹窗还会黑一下」的第二层根因：首帧内联脚本

用户复报：「我点击对话框的独立弹窗现在还是会黑一下，之前都不会的，都是直接出来的，是不是那个动画还是在」。
上一轮只改了 **React 闸门**（`BootIntroGate` / `shouldPlayBootIntro`）—— 那是**必要但不充分**的。

## 真根因：首帧那一笔比 React 早

`index.html` 的内联脚本（首帧之前跑）里自己写着「判定与 `shouldPlayBootIntro` 一致」，但它当时只挡了
**关闭档 / 减弱动效 / 宠物浮窗** 三条，**漏了独立会话弹窗**：

```js
if (bi !== "off" && !reduced && !isPet) document.documentElement.setAttribute("data-boot-intro", "1");
```

而 CSS 里 `html[data-boot-intro="1"] .boot-splash { background: #050403; }`
⇒ 弹窗**首帧就被涂成动画底色纯黑**，随后 React 才挂载、闸门才判"不播"。
于是症状是"黑一下"（首帧黑 → 内容上来）。⛔ React 那侧改得再对也救不回来：它比内联脚本晚。

上一轮之所以没修净：**只看了 React 那一层**，没顺着"首帧"往上追到 `index.html`
（该项目在 550C 那批里专门为首帧加了内联脚本，它自己就是**第二处**判定点）。

## 改法

- `index.html` 内联脚本：加 `var isPopout = new URLSearchParams(location.search).has("popout");`
  并把条件改成 `bi !== "off" && !reduced && !isPet && !isPopout`；注释里写明"必须与 `shouldPlayBootIntro` 逐条一致"
  以及漏掉它的后果（首帧黑一下）。
- ⛔ 与 `BootIntroGate` 同口径：**只认参数在不在** —— `?popout=`（会话 id 缺省）也是分出去的窗口。

## 判据

- 守卫 `20-boot-intro` **36 → 37/37**：新增「首帧判定也排除独立会话弹窗」，
  ⛔ 打在**代码形态**上（`!isPet && !isPopout` 这个合取式 + `has("popout")`），只查"出现过 popout"会命中注释；
- 变异测试：把首帧的 popout 排除去掉 ⇒ 红 ✓；
- **产物级验证**：`dist/index.html`（构建产物，即随包 HTML）里确认三条都在 ——
  `var isPopout = ...has("popout")` / `!isPet && !isPopout` / `background: #050403`。
  ⛔ 想做"起 Electron 读首帧属性"的端到端探针，但本宿主里 Electron 跑不起来（与项目文档记录的环境限制一致，
  探针已删除）；**能确证到产物这一层**：修复真的进了随包 HTML，而不是只改了源码。
- `npm run check` 退出码 0。

## 生效方式（重要）

独立弹窗是**每次打开时**才 `loadFile(<appPath>/dist/index.html)` 的 ⇒ 产物已重建
**关掉旧弹窗、重新开一个**就会读到新 HTML；若你跑的是**安装版**，那份产物要等下次打包/装新版本才带上。

## 教训（写给下一个改这块的人）

同一个判定有**两处实现**（首帧内联脚本 + React 闸门），且内联脚本不能用 import ⇒ 只能靠**注释声明的同源契约** + 守卫
把两处的**条件形态**都钉住。加第三条、第四条不播判据时，⛔ 两处必须同轮一起改 ——
只改 React 那处会得到"看起来改好了、实际首帧已经画错"的假绿。
