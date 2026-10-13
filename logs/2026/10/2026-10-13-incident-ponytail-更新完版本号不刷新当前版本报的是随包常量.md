---
id: 2026-10-13-incident-ponytail-更新完版本号不刷新当前版本报的是随包常量
date: 2026-10-13
kind: incident
area: update
title: ponytail 更新完版本号不刷新：当前版本报的是随包常量
tags: [auto-update, ponytail, version, guard]
commits: []
files: []
importance: high
---

# ponytail 更新完版本号不刷新：当前版本报的是随包常量

# ponytail 更新完版本号不刷新：报的「当前版本」是随包常量

## 现象
用户实测（截图）：设置 → 控制台「组件更新」里那一行显示
`ponytail 写代码模式（技能 + 钩子）  4.9.0 → v5.2.0（有可用更新）`；
点「更新」后 toast 明确说「ponytail 写代码模式（技能 + 钩子）：已更新」，
但**版本号与「有更新」徽标一直不动**。用户第一判断是「更新后没刷新」。

## 误判与真因
第一直觉会去查渲染层的刷新链（是不是更新完没重新检测）。**那条链是对的**：
`AutoUpdateCard.updateOne()` 的 `finally` 里就有 `void scan()`，更新后确实会重新拉一遍清单。
所以「没刷新」这个描述是**误导**——不是没刷新，是**每次刷新都得到同一个错答案**。

真因在主进程的检测分支报错了「当前版本」：

```
current: PONYTAIL_VERSION,                 // electron/update-backends.ts（旧）
hasUpdate: latest.replace(/^v/,"") !== PONYTAIL_VERSION.replace(/^v/,"")
```

`PONYTAIL_VERSION` 是 `electron/ponytail-plugin.ts` 里写死的 **`"4.9.0"`**（随包版本），
而在线更新把新版本装进的是**按标签命名**的目录：
`<codexHome>/plugins/cache/ponytail/ponytail/5.2.0`。两者不同名。
⇒ 更新其实**成功了**，但检测每次都拿随包常量去和远端 tag 比 ⇒ `hasUpdate` 恒为 true、
文案永远停在「4.9.0 → v5.2.0（有可用更新）」。同一个错也让「更新前」分支的 before 恒为 4.9.0，
于是点第二次会**又下载一遍**。

## 依据
- 用户机器实测（独立测量，不是读代码推断）：
  `…/AppData/Roaming/Codex Harness Desktop/codex-home/plugins/cache/ponytail/ponytail/`
  下**只有 `5.2.0`**，且其中 `plugin.yaml` 写着 `version: 5.2.0` —— 更新确实落地了。
- 随包版本另有出处可对账：`scripts/lib/tools-versions.cjs` 的 `TOOLS_VERSIONS.ponytail = "v4.9.0"`
  与 `resources/tools/ponytail-plugin/plugin.yaml` 的 `version: 4.9.0` 一致 ⇒ 常量本身没错，
  **错在拿"随包的是什么"去回答"装的是什么"**。
- 修复后用编译产物在真实落点上复跑：`listInstalledPonytailVersions(<userData>/codex-home)`
  → `["5.2.0"]`；`compareVersions("v5.2.0","5.2.0") === 0` ⇒ `hasUpdate=false`、文案「5.2.0（已是最新）」。
- 提交：桌面版 `3146188`（PPcode `f7316a6`、云助手 `f1238aa`）。

## 结论
1. 「当前版本」**必须从引擎安装落点实读**：`electron/ponytail-plugin.ts` 新增
   `ponytailCacheRoot()` 与 `listInstalledPonytailVersions()`（优先读 `plugin.yaml` 的 `version`，
   缺失/损坏时退回目录名 —— 目录名就是版本，引擎按它装）。
2. 取**最高**版本作为当前版本；**一个版本目录都没有**时才回落随包常量
   （沿用旧语义，避免未安装时文案变空）。两个分支（检测 / 更新前）共用
   `installedPonytailVersion()`，不各写一份。
3. 「有没有新版」「要不要装」改用 `electron/updates.ts` 的 `compareVersions`
   —— ⛔ 不再用字符串不等（那会把**更旧的** tag 也报成有更新，【144】已经在检查链上钉过同款坑）。
4. 守卫 `12l` 新增第 ⑪ 节（38 → 47 项）：静态钉「两个分支都读实装版本、不许出现
   `current: PONYTAIL_VERSION`」，并用**夹具 + 编译产物里的真函数**做行为断言
   （放两版目录 ⇒ 读到两版；落点不存在 ⇒ 空数组）。

## 影响面
- 控制台「组件更新」里 ponytail 那一行：更新成功后徽标消失、版本号就地变成新版本（不再骗人）。
- 后台自动更新循环里 ponytail 那一行同理：修好后「已经是最新版」才真的会返回 `unchanged`，
  不再每次周期重装一遍（**这同时省掉了一份无谓的下载与重注册**）。
- ⛔ 同型风险：任何「版本号来自编译期常量」的检测项都会犯同一个错。判据很简单 ——
  **当前版本必须能在用户的磁盘上找到对应物**，找不到就说明报的是打包时的值。

## 回滚
把 `current` / `before` 换回 `PONYTAIL_VERSION`、`hasUpdate` 换回字符串不等即可；
`listInstalledPonytailVersions` 可保留（无副作用）。⛔ 回滚会同时把「更新完不刷新」的 bug 带回。
