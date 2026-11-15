---
id: 2026-11-15-change-laya-卡片改飞书-cli-同款-按需安装一律最新稳定版
date: 2026-11-15
kind: change
area: devtools
title: Laya 卡片改飞书 CLI 同款 + 按需安装一律最新稳定版
tags: [laya, feishu-cli, version, update, layout]
commits: [3306ca080, ee381273, 5b1a37e8]
files: [src/features/settings-devtools/LayaCard.tsx, electron/features/runtime-ipc.ts, src/styles/12-settings-skills.css]
importance: high
---

# Laya 卡片改飞书 CLI 同款 + 按需安装一律最新稳定版

## 现象与根因

用户 11-15 连续报三个问题：① Laya 安装失败后报错，整张卡「只剩一列」；② Laya 看不到更新功能；③ 按需下载的工具装的是旧版本；另外 OpenMAIC 也安装失败。

**布局根因**：LayaCard 旧版是**单行** `.runtime-row`（4 列 grid `22px / 1fr / auto / auto`），失败时展开的 `<details class="laya-install-log">` 是它的第 4 个子元素，CSS 又给 `width: 100%` ⇒ 第 4 列撑满、`1fr` 塌成一条。`flex-wrap: wrap` 是 flex 时代死规则，在 grid 上无效。用户因此既看不到报错，也以为没有更新入口。

**版本滞后根因**：`runtime:install` 直接吃 `scripts/lib/tools-versions.cjs` 固定值（feishuCli `1.0.98`、filee `2.2.0`）；GitHub 侧 `fetchGitHubLatestTag` 只查 `/releases/latest`，上游先打 tag 不发 Release 时拿不到或长期滞后。

## 修法

1. **LayaCard** 改成 FeishuCliCard 同款：`.laya-list` 三行（安装 / 更新 / 服务与权重，3 列 grid），日志与「上次失败」行一律放列表外；更新行始终独立存在。
2. **fetchGitHubLatestTag** 改 tags 列表 + releases/latest **双源都查**，`compareVersions` 取最大；**只认稳定版三段号**（实测 OpenMAIC `tags[0]=v1.5.0-rc.2` 而 `releases/latest=v1.4.2`，不排除 RC 会装预发布源码）。
3. **latestInstallVersion**：在线查最新，固定表只作离线兜底；filee / apkstart / openmaic / husk / husk-tipa 五条安装链接入。
4. **飞书 CLI** 安装先经 `fetchRegistryLatest`（国内镜像 + 官方源取最大）拿到具体版本再拼 `@larksuite/cli@<ver>`。
5. 守卫：`12s` 33/33（含「日志必须在 list 外」）、`12l` 68/68（双源/稳定版/禁固定表/CLI 最新版）、`12aj` 27/27（Filee 旧断言改锚）、`09` 棘轮 runtime-ipc 1220→1246。

## 判据

三仓 `npm run check` 均「预检通过（5 条既有告警）」；`npm run build` 通过。主仓启动验证：应用已更新到 v0.0.60（差分补丁生效，弹出新功能介绍），设置页可正常打开。Laya 卡片的失败态截图未在会话内取到（GUI 坐标缩放未对上），改由 `12s` 结构守卫 + CSS 规则钉死。

## 三仓

主仓 `3306ca080`、PPcode `ee381273`、云助手 `5b1a37e8`（界面已部署，哈希一致）+ 部署状态 `03b18769`。

## 未完成 / 下一步（如实记录）

1. **第三方卡片 UI 统一尚未做完**：Filee / ApkStart / OpenMAIC / Husk / 飞书 CLI 已是「列表 + 更新行」结构；**PhoneHarnessCard / MoeKoeCard / EgoLiteCard / OpenfilmCard** 仍是旧形态，需下一轮逐张改造成飞书 CLI 同款。
2. **Laya 与 OpenMAIC 安装失败的具体报错未定位**。已排除共同前置：随包 Python/pip 正常、Node/npm-cli 正常、D 盘可用 331GB、清华 pip 索引 200、codeload 直连 200。Laya 现在能看到完整日志了；OpenMAIC 卡片已有「安装失败 · 点开完整报错」入口。需要用户把那段完整报错发来，或下一轮真跑一次安装抓 stderr。
3. 版本判定已排除 RC，但 OpenMAIC 安装链里 `pkgVersion !== version` 的版本严格校验仍可能在tag 与 package.json 不一致时失败——需日志确认。
