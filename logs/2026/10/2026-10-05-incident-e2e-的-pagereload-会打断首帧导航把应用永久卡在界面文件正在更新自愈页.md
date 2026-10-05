---
id: 2026-10-05-incident-e2e-的-pagereload-会打断首帧导航把应用永久卡在界面文件正在更新自愈页
date: 2026-10-05
kind: incident
area: e2e
title: e2e 的 Page.reload 会打断首帧导航，把应用永久卡在「界面文件正在更新」自愈页
tags: [e2e, 白屏, 启动]
commits: []
files: [scripts/e2e/lib/harness.mjs, electron/features/window-factory.ts]
importance: normal
---

# e2e 的 Page.reload 会打断首帧导航，把应用永久卡在「界面文件正在更新」自愈页

## 背景
界面草图那轮改完渲染层，`scripts/accept.mjs --only ui-sketch` 连续几次在**启动阶段**就失败：
「等待超时：引导页或主界面（最后取值 false）」。症状长得像"我把应用改坏了"，而 `npm run build` 与
手工启动 `electron .` 都完全正常 —— 排查因此白绕了一圈。

## 结论
不是被测代码的问题，是**测试实例自己把应用打进自愈页、且那一页出不来**：

1. `ElectronHarness.launch()` 在灌完 `localStorage.workspace` 后会无条件 `Page.reload`（为了让注入脚本
   跑在页面脚本之前）。若此刻首帧导航还在飞，reload 会**打断**它 ⇒ 主框架 `did-fail-load(ERR_ABORTED)`。
2. `window-factory.ts` 的白屏自愈（10-03 为"构建期清空 dist"加的）据此 `loadURL(data:text/html,…)` 换到
   「界面文件正在更新，3 秒后自动重试…」页，并让**页面自己** `location.replace(file:///…/dist/index.html)`。
3. ⛔ 这一步在 Chromium 里走不通：**`data:` 是不透明源，不允许把顶层框架导航到 `file:`**
   ⇒ 每次 replace 又被拒 ⇒ 再触发 `did-fail-load` ⇒ 再渲染一次提示页，**永久循环**。
   实测：40 秒内 13 次重试没回来，全新 profile 也一样（与 dist 是否完好无关）。

## 依据
- 探针取证（CDP `/json` 只有一个 page target，URL 就是那段 data: 页；`document.body.innerText` =
  「界面文件正在更新，3 秒后自动重试…（构建完成即自动进入；错误：）」，**错误码是空的** ——
  `String(errorDescription ?? errorCode)` 在 description 为空串时不会退到码，所以页面上看不到原因）。
- 反证方向：同样的启动参数（`--no-sandbox` + `CODEX_HARNESS_IN_PROCESS_GPU=1` + 同样的 userData 目录形态）
  手工 `electron .` 起，22 秒后 target URL = `file:///…/dist/index.html`，界面正常 ⇒ 差异只在 CDP 那一次 reload。
- 自愈页的实现与它想解决的场景：`electron/features/window-factory.ts:172-186`（注释写明是给
  `clean-dist` 清空 dist 的窗口期兜底）。

## 影响面
- **测试面（已修）**：`scripts/e2e/lib/harness.mjs` 在 `Page.reload` 之前先 `waitFor(document.readyState === "complete")`。
  修完 `accept --only ui-sketch` 9/9、`npm run verify` 全绿（含共享 profile `main`）。
  这条 flake 会咬到**每一轮**验收：应用越重（首帧越慢）越容易中，本轮恰好因为草图板块变胖而稳定复现。
- **产品面（未改，等用户点头）**：真实用户如果在构建窗口期打开应用，也会**永久卡在提示页**，
  只能手动重启。改法是把重试从"页面自己跳"挪到**主进程定时器**（`contents.loadFile(appIndex)` 每 3 秒一次，
  成功即停），并顺手把 `did-fail-load` 的错误码打进页面（现在为空串，等于没给线索）。
  ⛔ 这是启动链行为，按纪律没确认不动。

## 回滚
`scripts/e2e/lib/harness.mjs` 去掉那两行 `waitFor` 即回到旧行为（会重新出现这个 flake）。
本次不涉及任何被测代码的语义变化。

